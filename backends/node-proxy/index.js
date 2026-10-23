"use strict";

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

/**
 * Default configuration for the Gemini Enterprise (Vertex AI Discovery Engine) proxy.
 * Customers override these 4 values via environment variables (.env or Cloud Run)
 * without touching application code:
 *   - GCP_PROJECT_ID
 *   - GCP_LOCATION
 *   - GE_ENGINE_ID
 *   - GE_WIDGET_CONFIG_ID
 */
const DEFAULT_GEMINI_CONFIG = Object.freeze({
  projectId: "",
  location: "global",
  engineId: "",
  widgetConfigId: "",
  userPseudoId: ""
});

const MAX_QUERY_LENGTH = 4000;
const TOKEN_CACHE_TTL_MS = 45 * 60 * 1000;

let tokenCache = {
  token: "",
  expiresAt: 0
};

function isTruthyEnv(name) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function hashUserPseudoIdEnabled() {
  const raw = String(process.env.GE_HASH_USER_PSEUDO_ID ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function stsAudience() {
  return String(process.env.GE_STS_AUDIENCE || "").trim();
}

function impersonateUserEnabled() {
  return isTruthyEnv("GE_IMPERSONATE_USER");
}

function matchSessionUserPseudoIdEnabled() {
  const raw = String(
    process.env.GE_USER_PSEUDO_ID_MATCH_SESSION ?? "true"
  ).trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function slugNamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "");
}

function parseNamesFromDisplayName(displayName) {
  let normalized = String(displayName || "").trim();
  if (!normalized || normalized.includes("@")) {
    return { givenName: "", familyName: "" };
  }
  const paren = normalized.indexOf("(");
  if (paren > 0) {
    normalized = normalized.slice(0, paren).trim();
  }
  if (normalized.includes(",")) {
    const comma = normalized.split(",");
    if (comma.length >= 2) {
      return {
        givenName: slugNamePart(comma[1]),
        familyName: slugNamePart(comma[0])
      };
    }
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { givenName: "", familyName: "" };
  }
  return {
    givenName: slugNamePart(parts[0]),
    familyName: slugNamePart(parts[parts.length - 1])
  };
}

function getIdentityConfig(overrides = {}) {
  const rawStrategy = firstNonEmpty(
    overrides.strategy,
    process.env.GE_IDENTITY_STRATEGY,
    "passthrough"
  ).toLowerCase();
  const strategy =
    rawStrategy === "domain_rewrite" || rawStrategy === "claim_template"
      ? rawStrategy
      : "passthrough";
  const targetDomain = firstNonEmpty(
    overrides.targetDomain,
    process.env.GE_IDENTITY_DOMAIN,
    ""
  )
    .toLowerCase()
    .replace(/^@+/, "");
  const sourceDomain = firstNonEmpty(
    overrides.sourceDomain,
    process.env.GE_IDENTITY_SOURCE_DOMAIN,
    ""
  )
    .toLowerCase()
    .replace(/^@+/, "");
  const claimTemplate = firstNonEmpty(
    overrides.claimTemplate,
    process.env.GE_IDENTITY_TEMPLATE,
    "{given_name}.{family_name}@{domain}"
  );
  return { strategy, targetDomain, sourceDomain, claimTemplate };
}

/**
 * Customer-agnostic identity resolver supporting:
 *   1. "passthrough" (default): uses user@company.com directly
 *   2. "domain_rewrite": rewrites @corp.company.com -> @company.com (or given.family@company.com)
 *   3. "claim_template": formats "{given_name}.{family_name}@{domain}"
 */
function resolveCloudIdentityEmail(email, given, family, displayName, identityOverrides = {}) {
  const rawEmail = String(email || "").trim();
  let g = String(given || "").trim();
  let f = String(family || "").trim();
  const disp = String(displayName || "").trim();

  if ((!g || !f) && disp) {
    const parsedNames = parseNamesFromDisplayName(disp);
    g = g || parsedNames.givenName;
    f = f || parsedNames.familyName;
  }

  const cleanGiven = slugNamePart(g);
  const cleanFamily = slugNamePart(f);
  const atIndex = rawEmail.indexOf("@");
  const emailUser = atIndex > 0 ? rawEmail.slice(0, atIndex).trim().toLowerCase() : "";
  const emailDomain = atIndex > 0 ? rawEmail.slice(atIndex + 1).trim().toLowerCase() : "";

  const cfg = getIdentityConfig(identityOverrides);

  if (cfg.strategy === "claim_template") {
    const effectiveDomain = cfg.targetDomain || emailDomain;
    if (cleanGiven && cleanFamily && effectiveDomain) {
      return cfg.claimTemplate
        .replace(/\{given_name\}/gi, cleanGiven)
        .replace(/\{family_name\}/gi, cleanFamily)
        .replace(/\{username\}/gi, emailUser || `${cleanGiven}.${cleanFamily}`)
        .replace(/\{domain\}/gi, effectiveDomain)
        .toLowerCase();
    }
    if (rawEmail && atIndex > 0) {
      return rawEmail.toLowerCase();
    }
    return "";
  }

  if (cfg.strategy === "domain_rewrite") {
    const effectiveTarget = cfg.targetDomain || emailDomain;
    const isSourceMatch =
      !cfg.sourceDomain ||
      emailDomain === cfg.sourceDomain ||
      emailDomain.endsWith("." + cfg.sourceDomain);

    if (effectiveTarget && cleanGiven && cleanFamily && isSourceMatch) {
      return `${cleanGiven}.${cleanFamily}@${effectiveTarget}`;
    }
    if (emailUser && effectiveTarget && isSourceMatch) {
      return `${emailUser}@${effectiveTarget}`;
    }
    if (rawEmail && atIndex > 0) {
      return rawEmail.toLowerCase();
    }
    return "";
  }

  // Default: "passthrough"
  if (rawEmail && atIndex > 0) {
    if (
      cfg.sourceDomain &&
      cfg.targetDomain &&
      (emailDomain === cfg.sourceDomain || emailDomain.endsWith("." + cfg.sourceDomain))
    ) {
      if (cleanGiven && cleanFamily) {
        return `${cleanGiven}.${cleanFamily}@${cfg.targetDomain}`;
      }
      return `${emailUser}@${cfg.targetDomain}`;
    }
    return rawEmail.toLowerCase();
  }

  if (cleanGiven && cleanFamily && cfg.targetDomain) {
    return `${cleanGiven}.${cleanFamily}@${cfg.targetDomain}`;
  }

  return "";
}

function readJwtPayload(tokenOrBearer) {
  const raw = String(tokenOrBearer || "").trim();
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw;
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    try {
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = Buffer.from(padded, "base64").toString("utf8");
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
}

function jwtClaim(claims, ...keys) {
  if (!claims || typeof claims !== "object") {
    return "";
  }
  for (const key of keys) {
    const val = claims[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return "";
}

function headerValue(req, name) {
  if (!req || !req.headers) {
    return "";
  }
  const key = String(name || "").toLowerCase();
  const direct = req.headers[name] ?? req.headers[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  if (Array.isArray(direct) && direct[0]) {
    return String(direct[0]).trim();
  }
  return "";
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  const raw = String(cookieHeader || "").trim();
  if (!raw) {
    return out;
  }
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) {
      continue;
    }
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function stripIapPrefix(rawEmail) {
  const trimmed = String(rawEmail || "").trim();
  if (!trimmed) {
    return "";
  }
  const colon = trimmed.indexOf(":");
  if (colon >= 0 && /^accounts\.google\.com:/i.test(trimmed)) {
    return trimmed.slice(colon + 1).trim();
  }
  return trimmed;
}

function extractBearerToken(req) {
  const header = headerValue(req, "authorization");
  if (header && /^Bearer\s+/i.test(header)) {
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!/^ya29\./i.test(token)) {
      return token;
    }
  }
  const entraHeader = headerValue(req, "X-Entra-Id-Token") || headerValue(req, "X-Idp-Token");
  if (entraHeader) {
    return entraHeader;
  }
  const cookies = parseCookieHeader(headerValue(req, "cookie"));
  return firstNonEmpty(cookies.ge_id_token, cookies.id_token, cookies.access_token);
}

function extractGoogleAccessToken(req, body) {
  const headerToken = headerValue(req, "X-Google-Access-Token");
  if (headerToken) {
    return headerToken;
  }
  const bodyToken =
    body && typeof body.googleAccessToken === "string" ? body.googleAccessToken.trim() : "";
  if (bodyToken) {
    return bodyToken;
  }
  const cookies = parseCookieHeader(headerValue(req, "cookie"));
  const cookieToken = firstNonEmpty(cookies.ge_google_access_token);
  if (cookieToken) {
    return cookieToken;
  }
  const authHeader = headerValue(req, "authorization");
  if (authHeader && /^Bearer\s+ya29\./i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
}

function resolveSignedInUserEmail(req, body, identityOverrides = {}) {
  const iapOrEasyAuth = firstNonEmpty(
    stripIapPrefix(headerValue(req, "X-Goog-Authenticated-User-Email")),
    headerValue(req, "X-MS-CLIENT-PRINCIPAL-NAME"),
    headerValue(req, "X-Forwarded-Email")
  );
  if (iapOrEasyAuth) {
    const resolvedProxy = resolveCloudIdentityEmail(iapOrEasyAuth, null, null, null, identityOverrides);
    if (resolvedProxy) {
      return resolvedProxy;
    }
  }

  const bearer = extractBearerToken(req);
  const jwtClaims = readJwtPayload(bearer);
  const fromJwt = resolveCloudIdentityEmail(
    jwtClaim(jwtClaims, "email", "preferred_username", "upn", "unique_name"),
    jwtClaim(jwtClaims, "given_name"),
    jwtClaim(jwtClaims, "family_name"),
    jwtClaim(jwtClaims, "name"),
    identityOverrides
  );
  if (fromJwt) {
    return fromJwt;
  }

  const headerEmail = headerValue(req, "X-User-Email");
  if (headerEmail) {
    const resolved = resolveCloudIdentityEmail(headerEmail, null, null, null, identityOverrides);
    if (resolved) {
      return resolved;
    }
  }

  const cookies = parseCookieHeader(headerValue(req, "cookie"));
  const cookieEmail = firstNonEmpty(cookies.ge_user_email, cookies.user_email);
  if (cookieEmail) {
    const fromCookie = resolveCloudIdentityEmail(cookieEmail, null, null, null, identityOverrides);
    if (fromCookie) {
      return fromCookie;
    }
  }

  const bodyPseudo = body && typeof body.userPseudoId === "string" ? body.userPseudoId.trim() : "";
  if (bodyPseudo.includes("@")) {
    const fromBody = resolveCloudIdentityEmail(bodyPseudo, null, null, null, identityOverrides);
    if (fromBody) {
      return fromBody;
    }
  }

  const bodyEmail = body && typeof body.userEmail === "string" ? body.userEmail.trim() : "";
  if (bodyEmail.includes("@")) {
    const fromBodyEmail = resolveCloudIdentityEmail(bodyEmail, null, null, null, identityOverrides);
    if (fromBodyEmail) {
      return fromBodyEmail;
    }
  }

  const defaultEnvEmail = firstNonEmpty(
    process.env.GE_DEFAULT_USER_EMAIL,
    process.env.DEFAULT_USER_EMAIL
  );
  if (defaultEnvEmail && defaultEnvEmail.includes("@")) {
    const fromEnv = resolveCloudIdentityEmail(defaultEnvEmail, null, null, null, identityOverrides);
    if (fromEnv) {
      return fromEnv;
    }
  }

  return "";
}

function resolveUserPseudoIdForStorage(cloudIdentityEmail, fromRequest) {
  const hash = hashUserPseudoIdEnabled();
  const normalized =
    normalizeUserPseudoId(cloudIdentityEmail, hash) ||
    normalizeUserPseudoId(fromRequest, hash);
  return normalized || "";
}

function normalizeUserPseudoId(value, hashEmails) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const hash = typeof hashEmails === "boolean" ? hashEmails : hashUserPseudoIdEnabled();
  if (!trimmed.includes("@")) {
    return trimmed.length <= 128 ? trimmed : trimmed.slice(0, 128);
  }
  const email = trimmed.toLowerCase();
  if (!hash) {
    return email.length <= 128 ? email : email.slice(0, 128);
  }
  const prefix = String(process.env.GE_HASH_PREFIX || "ge").trim();
  return `${prefix}-${crypto.createHash("sha256").update(email).digest("hex")}`;
}

function firstNonEmpty(...values) {
  for (const val of values) {
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return "";
}

function getDataStoreSpecs() {
  const fromEnv = String(process.env.GE_DATA_STORES || "").trim();
  if (fromEnv) {
    return fromEnv.split(";").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function buildVertexAiSearchSpec() {
  const stores = getDataStoreSpecs();
  if (stores.length === 0) {
    return {};
  }
  return {
    dataStoreSpecs: stores.map((dataStore) => ({ dataStore }))
  };
}

function getGeminiConfig(overrides = {}) {
  const projectId = firstNonEmpty(
    overrides.projectId,
    process.env.GCP_PROJECT_ID,
    DEFAULT_GEMINI_CONFIG.projectId
  );
  const location = firstNonEmpty(
    overrides.location,
    process.env.GCP_LOCATION,
    DEFAULT_GEMINI_CONFIG.location
  );
  const engineId = firstNonEmpty(
    overrides.engineId,
    process.env.GE_ENGINE_ID,
    DEFAULT_GEMINI_CONFIG.engineId
  );
  const widgetConfigId = firstNonEmpty(
    overrides.widgetConfigId,
    process.env.GE_WIDGET_CONFIG_ID,
    DEFAULT_GEMINI_CONFIG.widgetConfigId
  );
  const userPseudoId = firstNonEmpty(
    overrides.userPseudoId,
    DEFAULT_GEMINI_CONFIG.userPseudoId
  );
  const googleOAuthClientId = firstNonEmpty(
    overrides.googleOAuthClientId,
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GE_GOOGLE_OAUTH_CLIENT_ID
  );
  const googleOAuthClientSecret = firstNonEmpty(
    overrides.googleOAuthClientSecret,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GE_GOOGLE_OAUTH_CLIENT_SECRET
  );
  const googleOAuthRedirectUri = firstNonEmpty(
    overrides.googleOAuthRedirectUri,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
    process.env.GE_GOOGLE_OAUTH_REDIRECT_URI
  );
  const googleOAuthScopes = firstNonEmpty(
    overrides.googleOAuthScopes,
    process.env.GOOGLE_OAUTH_SCOPES,
    "https://www.googleapis.com/auth/cloud-platform openid email"
  );
  const googleOAuthCookieSecret = firstNonEmpty(
    overrides.googleOAuthCookieSecret,
    process.env.GOOGLE_OAUTH_COOKIE_SECRET,
    process.env.GE_GOOGLE_OAUTH_COOKIE_SECRET
  );

  if (!/^[a-z0-9-]+$/i.test(location)) {
    throw new Error(`invalid_gcp_location: ${location}`);
  }

  const host =
    location.toLowerCase() === "global"
      ? "https://discoveryengine.googleapis.com"
      : `https://${location.toLowerCase()}-discoveryengine.googleapis.com`;

  const enginePath = `projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/collections/default_collection/engines/${encodeURIComponent(engineId)}`;

  return {
    projectId,
    location,
    engineId,
    widgetConfigId,
    userPseudoId,
    googleOAuthClientId,
    googleOAuthClientSecret,
    googleOAuthRedirectUri,
    googleOAuthScopes,
    googleOAuthCookieSecret,
    googleOAuthServerEnabled: Boolean(googleOAuthClientId && googleOAuthClientSecret),
    host,
    enginePath,
    webAppBaseUrl: buildDeepLinkUrl(widgetConfigId, "")
  };
}

function includeSessionInDeepLink() {
  const raw = process.env.GE_DEEP_LINK_INCLUDE_SESSION;
  if (raw !== undefined && String(raw).trim() !== "") {
    return isTruthyEnv("GE_DEEP_LINK_INCLUDE_SESSION");
  }
  return matchSessionUserPseudoIdEnabled();
}

function buildDeepLinkUrl(widgetConfigId, sessionId) {
  const cid = String(widgetConfigId || "").trim();
  if (!cid) {
    return "https://vertexaisearch.cloud.google.com/u/0/home";
  }
  const baseUrl = `https://vertexaisearch.cloud.google.com/u/0/home/cid/${encodeURIComponent(cid)}`;
  const sid = String(sessionId || "").trim();
  if (!includeSessionInDeepLink() || !sid || sid === "-") {
    return baseUrl;
  }
  return `${baseUrl}/r/session/${encodeURIComponent(sid)}`;
}

function extractSessionId(sessionName) {
  const raw = String(sessionName || "").trim();
  if (!raw) {
    return "";
  }
  const parts = raw.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last === "-" ? "" : last;
}

function defaultRequestTimeoutMs() {
  const fromEnv = Number(process.env.GE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 1000 ? fromEnv : 60000;
}

function requestJson(urlString, { method = "GET", headers = {}, body = null, timeoutMs = defaultRequestTimeoutMs() } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const lib = parsedUrl.protocol === "http:" ? http : https;
    const payload =
      body == null
        ? null
        : typeof body === "string"
          ? Buffer.from(body, "utf8")
          : Buffer.from(JSON.stringify(body), "utf8");

    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders["Content-Length"] = String(payload.length);
      if (!reqHeaders["Content-Type"]) {
        reqHeaders["Content-Type"] = "application/json; charset=utf-8";
      }
    }

    const req = lib.request(
      parsedUrl,
      {
        method,
        headers: reqHeaders,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: text
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`request_timeout: ${method} ${parsedUrl.pathname}`));
    });
    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function exchangeEntraTokenForGoogleToken(entraAccessToken, audience) {
  const subjectToken = String(entraAccessToken || "").trim();
  const aud = String(audience || "").trim();
  if (!subjectToken || !aud) {
    return "";
  }
  const payload = {
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    subjectToken,
    audience: aud,
    scope: "https://www.googleapis.com/auth/cloud-platform"
  };
  const resp = await requestJson("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: payload,
    timeoutMs: 15000
  });
  if (resp.status < 200 || resp.status >= 300) {
    return "";
  }
  const parsed = JSON.parse(resp.body);
  return parsed && parsed.access_token ? String(parsed.access_token).trim() : "";
}

const DEFAULT_DWD_SCOPES =
  "https://www.googleapis.com/auth/discoveryengine.readwrite https://www.googleapis.com/auth/discoveryengine.assist.readwrite";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function signServiceAccountJwt(cred, subjectUser, customScope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const sub = String(subjectUser || "").trim();
  const scope =
    String(customScope || "").trim() ||
    (sub
      ? String(process.env.GE_DWD_SCOPES || DEFAULT_DWD_SCOPES).trim()
      : CLOUD_PLATFORM_SCOPE);
  const payload = {
    iss: cred.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  if (sub) {
    payload.sub = sub;
  }
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(cred.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

async function exchangeServiceAccountAssertion(cred, subjectUser, customScope) {
  const assertion = signServiceAccountJwt(cred, subjectUser, customScope);
  const formBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  }).toString();
  const resp = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    timeoutMs: 10000
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`service_account_jwt_failed_${resp.status}`);
  }
  const parsed = JSON.parse(resp.body);
  if (!parsed.access_token) {
    throw new Error("service_account_empty_access_token");
  }
  return String(parsed.access_token).trim();
}

async function getTokenFromServiceAccountJson(cred, subjectUser) {
  if (!cred || cred.type !== "service_account" || !cred.client_email || !cred.private_key) {
    throw new Error("adc_unsupported_credential_type");
  }
  const sub = String(subjectUser || "").trim();
  if (!sub) {
    return exchangeServiceAccountAssertion(cred, "", CLOUD_PLATFORM_SCOPE);
  }
  const dwdScopes = String(process.env.GE_DWD_SCOPES || DEFAULT_DWD_SCOPES).trim();
  try {
    return await exchangeServiceAccountAssertion(cred, sub, dwdScopes);
  } catch (firstErr) {
    if (dwdScopes !== CLOUD_PLATFORM_SCOPE) {
      return exchangeServiceAccountAssertion(cred, sub, CLOUD_PLATFORM_SCOPE);
    }
    throw firstErr;
  }
}

async function getTokenFromAdcFile(cloudIdentityEmail) {
  const inlineJson = String(
    process.env.GE_DWD_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || ""
  ).trim();
  let cred = null;
  if (inlineJson) {
    cred = JSON.parse(inlineJson);
  } else {
    const adcPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");

    if (!fs.existsSync(adcPath)) {
      throw new Error(`adc_file_missing: ${adcPath}`);
    }

    cred = JSON.parse(fs.readFileSync(adcPath, "utf8"));
  }
  if (cred.type === "service_account") {
    const shouldImpersonate = impersonateUserEnabled() || Boolean(inlineJson);
    const subject =
      shouldImpersonate && cloudIdentityEmail ? String(cloudIdentityEmail).trim() : "";
    return getTokenFromServiceAccountJson(cred, subject);
  }
  if (cred.type !== "authorized_user" || !cred.client_id || !cred.client_secret || !cred.refresh_token) {
    throw new Error("adc_unsupported_credential_type");
  }

  const formBody = new URLSearchParams({
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    refresh_token: cred.refresh_token,
    grant_type: "refresh_token"
  }).toString();

  const resp = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    timeoutMs: 10000
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`adc_refresh_failed_${resp.status}`);
  }

  const parsed = JSON.parse(resp.body);
  if (!parsed.access_token) {
    throw new Error("adc_empty_access_token");
  }
  return String(parsed.access_token).trim();
}

async function getTokenFromMetadataServer() {
  const resp = await requestJson(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      timeoutMs: 3000
    }
  );
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`metadata_token_http_${resp.status}`);
  }
  const parsed = JSON.parse(resp.body);
  if (!parsed.access_token) {
    throw new Error("metadata_empty_access_token");
  }
  return String(parsed.access_token).trim();
}

function getTokenFromGcloudCli(preferredAccount = "") {
  const acct = String(preferredAccount || "").trim();
  const commands =
    acct && acct.includes("@")
      ? [["auth", "print-access-token", acct]]
      : [
          ["auth", "print-access-token"],
          ["auth", "application-default", "print-access-token"]
        ];
  const errors = [];
  for (const args of commands) {
    try {
      const out = execFileSync("gcloud", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 8000
      }).trim();
      if (out) {
        return out;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`gcloud_cli_failed: ${errors.join(" | ")}`);
}

const OAUTH_STATE_COOKIE_NAME = "ge_omnibar_google_oauth_state";
const OAUTH_SESSION_COOKIE_NAME = "ge_omnibar_google_oauth_session";
const DEFAULT_PROCESS_COOKIE_SECRET = crypto.randomBytes(32).toString("hex");
const userOAuthStore = new Map();

function getOAuthEncryptionKey(configOverrides = {}) {
  const cfg = getGeminiConfig(configOverrides);
  const rawSecret = firstNonEmpty(
    cfg.googleOAuthCookieSecret,
    cfg.googleOAuthClientSecret,
    process.env.SECURITY_AUTH_CLIENTSECRET,
    DEFAULT_PROCESS_COOKIE_SECRET
  );
  return crypto.createHash("sha256").update(rawSecret, "utf8").digest();
}

function sealOAuthPayload(payloadObj, keyBuffer) {
  if (!payloadObj || typeof payloadObj !== "object") {
    throw new Error("oauth_seal_invalid_payload");
  }
  const key = Buffer.isBuffer(keyBuffer) ? keyBuffer : getOAuthEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function unsealOAuthPayload(sealedString, keyBuffer) {
  const raw = String(sealedString || "").trim();
  if (!raw) {
    throw new Error("oauth_cookie_invalid_or_tampered");
  }
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("oauth_cookie_invalid_or_tampered");
  }
  const key = Buffer.isBuffer(keyBuffer) ? keyBuffer : getOAuthEncryptionKey();
  let iv;
  let authTag;
  let ciphertext;
  try {
    iv = Buffer.from(parts[1], "base64url");
    authTag = Buffer.from(parts[2], "base64url");
    ciphertext = Buffer.from(parts[3], "base64url");
  } catch (decodeErr) {
    const err = new Error("oauth_cookie_invalid_or_tampered");
    err.cause = decodeErr;
    throw err;
  }
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("oauth_cookie_invalid_or_tampered");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("oauth_cookie_invalid_or_tampered");
    }
    return parsed;
  } catch (decryptErr) {
    const err = new Error("oauth_cookie_invalid_or_tampered");
    err.cause = decryptErr;
    throw err;
  }
}

function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256"
  };
}

function isAllowedCorsOrigin(origin) {
  const trimmed = String(origin || "").trim();
  if (!trimmed) {
    return false;
  }
  const allowedList = String(
    process.env.HOSTING_CORS_ORIGINS || "https://localhost:8081,https://localhost:8080,http://localhost:8080"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "").toLowerCase();
  if (publicBase) {
    allowedList.push(publicBase);
  }
  return allowedList.includes(trimmed.toLowerCase());
}

function sanitizeOAuthReturnUrl(rawReturnUrl, req) {
  const raw = String(rawReturnUrl || "").trim();
  if (!raw || /[\r\n\0]/.test(raw)) {
    return "/";
  }
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw.startsWith("/\\")) {
      return "/";
    }
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      return "/";
    }
    const reqHost = firstNonEmpty(
      headerValue(req, "x-forwarded-host"),
      headerValue(req, "host")
    ).toLowerCase();
    if (reqHost && parsed.host.toLowerCase() === reqHost) {
      return parsed.toString();
    }
    if (isAllowedCorsOrigin(parsed.origin)) {
      return parsed.toString();
    }
  } catch (_urlErr) {
    return "/";
  }
  return "/";
}

function isRequestHttps(req) {
  const proto = headerValue(req, "x-forwarded-proto").toLowerCase();
  if (proto === "https") {
    return true;
  }
  if (req && req.socket && req.socket.encrypted) {
    return true;
  }
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").trim().toLowerCase();
  return publicBase.startsWith("https://");
}

function resolveOAuthRedirectUri(req, config) {
  if (config && config.googleOAuthRedirectUri) {
    return config.googleOAuthRedirectUri;
  }
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (publicBase) {
    return `${publicBase}/api/auth/google/callback`;
  }
  const host = firstNonEmpty(
    headerValue(req, "x-forwarded-host"),
    headerValue(req, "host"),
    "localhost:8080"
  );
  const proto = isRequestHttps(req) ? "https" : "http";
  return `${proto}://${host}/api/auth/google/callback`;
}

function formatSetCookie(name, value, { maxAgeSec, secure = true, httpOnly = true, sameSite = "Lax", path: cookiePath = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`, `SameSite=${sameSite}`];
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  if (secure) {
    parts.push("Secure");
  }
  if (typeof maxAgeSec === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  }
  return parts.join("; ");
}

function storeUserGoogleOAuthTokens({ email, accessToken, refreshToken = "", expiresInSec = 3599, expiresAt = 0 }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("oauth_user_email_required");
  }
  const existing = userOAuthStore.get(normalizedEmail);
  const mergedRefreshToken =
    String(refreshToken || "").trim() ||
    (existing && existing.refreshToken ? String(existing.refreshToken).trim() : "");
  const computedExpiresAt =
    Number(expiresAt) > 0
      ? Number(expiresAt)
      : Date.now() + (Number(expiresInSec) > 0 ? Number(expiresInSec) : 3599) * 1000;
  const record = {
    email: normalizedEmail,
    accessToken: String(accessToken || "").trim(),
    refreshToken: mergedRefreshToken,
    expiresAt: computedExpiresAt,
    updatedAt: Date.now()
  };
  userOAuthStore.set(normalizedEmail, record);
  return record;
}

function readUserGoogleOAuthFromRequest(req, expectedEmail = "", configOverrides = {}) {
  const normalizedExpected = String(expectedEmail || "").trim().toLowerCase();
  const key = getOAuthEncryptionKey(configOverrides);
  const cookies = parseCookieHeader(headerValue(req, "cookie"));
  const rawSessionCookie = firstNonEmpty(cookies[OAUTH_SESSION_COOKIE_NAME]);

  if (rawSessionCookie) {
    try {
      const unsealed = unsealOAuthPayload(rawSessionCookie, key);
      const cookieEmail = String(unsealed.email || "").trim().toLowerCase();
      if (cookieEmail && cookieEmail.includes("@")) {
        if (normalizedExpected && cookieEmail !== normalizedExpected) {
          // Reject cross-user cookie replay when IdP identity is a different user
          return userOAuthStore.get(normalizedExpected) || null;
        }
        return storeUserGoogleOAuthTokens({
          email: cookieEmail,
          accessToken: unsealed.accessToken || "",
          refreshToken: unsealed.refreshToken || "",
          expiresAt: unsealed.expiresAt || 0
        });
      }
    } catch (_cookieErr) {
      // Tampered or expired cookie is ignored in favor of clean server lookup
    }
  }

  if (normalizedExpected && userOAuthStore.has(normalizedExpected)) {
    return userOAuthStore.get(normalizedExpected) || null;
  }

  return null;
}

async function exchangeAuthorizationCodeForTokens({
  code,
  codeVerifier,
  redirectUri,
  config,
  requestFn = requestJson
}) {
  const formBody = new URLSearchParams({
    code: String(code || "").trim(),
    client_id: config.googleOAuthClientId,
    client_secret: config.googleOAuthClientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: String(codeVerifier || "").trim()
  }).toString();

  const resp = await requestFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    timeoutMs: 15000
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`oauth_code_exchange_failed_${resp.status}`);
    err.statusCode = 502;
    err.detail = resp.body;
    throw err;
  }

  const parsed = JSON.parse(resp.body);
  if (!parsed || typeof parsed.access_token !== "string" || !parsed.access_token.trim()) {
    throw new Error("oauth_code_exchange_empty_access_token");
  }
  return {
    accessToken: parsed.access_token.trim(),
    refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token.trim() : "",
    idToken: typeof parsed.id_token === "string" ? parsed.id_token.trim() : "",
    expiresIn: Number(parsed.expires_in) || 3599
  };
}

async function refreshUserGoogleOAuthToken({
  email,
  refreshToken,
  config,
  requestFn = requestJson
}) {
  const formBody = new URLSearchParams({
    client_id: config.googleOAuthClientId,
    client_secret: config.googleOAuthClientSecret,
    refresh_token: String(refreshToken || "").trim(),
    grant_type: "refresh_token"
  }).toString();

  const resp = await requestFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    timeoutMs: 15000
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`oauth_refresh_failed_${resp.status}`);
    err.statusCode = 401;
    err.detail = resp.body;
    throw err;
  }

  const parsed = JSON.parse(resp.body);
  if (!parsed || typeof parsed.access_token !== "string" || !parsed.access_token.trim()) {
    throw new Error("oauth_refresh_empty_access_token");
  }

  return storeUserGoogleOAuthTokens({
    email,
    accessToken: parsed.access_token.trim(),
    refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token.trim() : refreshToken,
    expiresInSec: Number(parsed.expires_in) || 3599
  });
}

async function resolveServerGoogleOAuthToken({
  req,
  cloudIdentityEmail = "",
  configOverrides = {},
  requestFn = requestJson
}) {
  const cfg = getGeminiConfig(configOverrides);
  const record = readUserGoogleOAuthFromRequest(req, cloudIdentityEmail, configOverrides);
  if (!record) {
    return null;
  }
  if (record.accessToken && record.expiresAt > Date.now() + 60 * 1000) {
    return {
      accessToken: record.accessToken,
      email: record.email,
      refreshedRecord: null
    };
  }
  if (record.refreshToken && cfg.googleOAuthServerEnabled) {
    const refreshed = await refreshUserGoogleOAuthToken({
      email: record.email,
      refreshToken: record.refreshToken,
      config: cfg,
      requestFn
    });
    return {
      accessToken: refreshed.accessToken,
      email: refreshed.email,
      refreshedRecord: refreshed
    };
  }
  return null;
}

function buildGoogleOAuthLoginPath(loginHint = "", mode = "popup", returnUrl = "/") {
  const params = new URLSearchParams();
  if (loginHint) {
    params.set("login_hint", loginHint);
  }
  if (mode) {
    params.set("mode", mode);
  }
  if (returnUrl && returnUrl !== "/") {
    params.set("returnUrl", returnUrl);
  }
  const qs = params.toString();
  return qs ? `/api/auth/google/login?${qs}` : "/api/auth/google/login";
}

function buildPopupCompleteHtml(email) {
  const safeEmailJson = JSON.stringify(String(email || ""));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Google Sign-In Complete</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f141c; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #18202c; border: 1px solid #2d3748; border-radius: 12px; padding: 24px 28px; text-align: center; max-width: 360px; }
    h2 { margin: 0 0 8px; font-size: 18px; color: #68d391; }
    p { margin: 0; font-size: 14px; color: #a0aec0; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connected to Gemini Enterprise</h2>
    <p>Completing sign-in…</p>
  </div>
  <script>
    (function () {
      var email = ${safeEmailJson};
      try {
        if (window.opener && window.location && window.location.origin) {
          window.opener.postMessage({ type: "ge_omnibar_google_oauth_complete", ok: true, email: email }, window.location.origin);
        }
      } catch (e) {}
      setTimeout(function () { window.close(); }, 120);
    })();
  </script>
</body>
</html>`;
}

function appendQueryParam(urlStr, key, val) {
  const sep = urlStr.includes("?") ? "&" : "?";
  return `${urlStr}${sep}${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
}

async function getGoogleAccessToken(options = {}) {
  const googleAccessToken = String(options.googleAccessToken || "").trim();
  if (googleAccessToken) {
    return googleAccessToken;
  }

  const cloudIdentityEmail = String(options.cloudIdentityEmail || "").trim();
  const entraAccessToken = String(options.entraAccessToken || "").trim();
  const userSpecific = Boolean(cloudIdentityEmail || entraAccessToken);
  const configOverrides = options.configOverrides || {};
  const requestFn = options.requestFn || requestJson;

  // Pattern 2: Server-Side Google OAuth 2.0 Session + Automatic Refresh Token
  if (options.req || cloudIdentityEmail) {
    const serverOAuth = await resolveServerGoogleOAuthToken({
      req: options.req,
      cloudIdentityEmail,
      configOverrides,
      requestFn
    });
    if (serverOAuth && serverOAuth.accessToken) {
      if (serverOAuth.refreshedRecord && typeof options.onTokenRefreshed === "function") {
        options.onTokenRefreshed(serverOAuth.refreshedRecord);
      }
      return serverOAuth.accessToken;
    }
  }

  const cfg = getGeminiConfig(configOverrides);
  if (cfg.googleOAuthServerEnabled && !isTruthyEnv("GOOGLE_OAUTH_ALLOW_ADC_FALLBACK")) {
    const err = new Error("google_oauth_required");
    err.statusCode = 401;
    err.authUrl = buildGoogleOAuthLoginPath(cloudIdentityEmail, "popup");
    err.loginHint = cloudIdentityEmail || "";
    err.detail = "Server-side Google OAuth authorization is required for this Cloud Identity user.";
    throw err;
  }

  const explicitToken = String(process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "").trim();
  if (explicitToken) {
    return explicitToken;
  }

  if (!userSpecific && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const audience = stsAudience();
  if (audience && entraAccessToken) {
    try {
      const exchanged = await exchangeEntraTokenForGoogleToken(entraAccessToken, audience);
      if (exchanged) {
        return exchanged;
      }
    } catch (_err) {
      // STS exchange failed; continue to ADC / gcloud fallback chain
    }
  }

  const errors = [];

  try {
    const cliToken = getTokenFromGcloudCli(cloudIdentityEmail);
    if (!userSpecific) {
      tokenCache = {
        token: cliToken,
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS
      };
    }
    return cliToken;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const adcToken = await getTokenFromAdcFile(cloudIdentityEmail);
    if (!userSpecific) {
      tokenCache = {
        token: adcToken,
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS
      };
    }
    return adcToken;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const metadataToken = await getTokenFromMetadataServer();
    if (!userSpecific) {
      tokenCache = {
        token: metadataToken,
        expiresAt: Date.now() + 10 * 60 * 1000
      };
    }
    return metadataToken;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const error = new Error("adc_unavailable");
  error.detail = errors.join("; ");
  throw error;
}

function clearTokenCache() {
  tokenCache = { token: "", expiresAt: 0 };
  userOAuthStore.clear();
}

function parseJsonChunks(rawBody) {
  const trimmed = String(rawBody || "").trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("malformed_json_stream_unterminated");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("invalid_stream_assist_json_array");
    }
    return parsed.filter((item) => item && typeof item === "object");
  }

  const chunks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth < 0) {
        throw new Error("malformed_json_stream_unbalanced_braces");
      }
      if (depth === 0 && start >= 0) {
        const slice = trimmed.slice(start, i + 1);
        chunks.push(JSON.parse(slice));
        start = -1;
      }
    }
  }

  if (depth !== 0 || inString) {
    throw new Error("malformed_json_stream_unterminated");
  }

  return chunks;
}

function readStreamAssistResponse(rawBody, widgetConfigId, fallbackSession = "") {
  const chunks = parseJsonChunks(rawBody);
  const textParts = [];
  let session = String(fallbackSession || "").trim();
  const seenSources = new Set();
  const results = [];
  const citations = [];

  for (const chunk of chunks) {
    if (chunk.sessionInfo && typeof chunk.sessionInfo.session === "string" && chunk.sessionInfo.session.trim()) {
      session = chunk.sessionInfo.session.trim();
    }

    const replies = chunk.answer && Array.isArray(chunk.answer.replies) ? chunk.answer.replies : [];
    for (const reply of replies) {
      const grounded = reply && reply.groundedContent ? reply.groundedContent : null;
      if (!grounded || typeof grounded !== "object") {
        continue;
      }

      const content = grounded.content;
      if (content && typeof content === "object") {
        const isThought = content.thought === true;
        if (!isThought && typeof content.text === "string" && content.text.length > 0) {
          textParts.push(content.text);
        }
      }

      const metadata = grounded.textGroundingMetadata;
      if (metadata && typeof metadata === "object") {
        const references = Array.isArray(metadata.references) ? metadata.references : [];
        for (const ref of references) {
          if (!ref || typeof ref !== "object") {
            continue;
          }
          const docMeta = ref.documentMetadata && typeof ref.documentMetadata === "object" ? ref.documentMetadata : {};
          const title = String(docMeta.title || ref.title || "Enterprise Source").trim();
          const url = String(docMeta.uri || ref.uri || "").trim();
          const snippet = String(ref.content || "").trim();
          const key = `${title.toLowerCase()}\n${url.toLowerCase()}`;
          if (!seenSources.has(key)) {
            seenSources.add(key);
            results.push({
              index: results.length + 1,
              title,
              url,
              snippet
            });
          }
        }
      }

      const citationMeta = grounded.citationMetadata || (content && content.citationMetadata);
      if (citationMeta && Array.isArray(citationMeta.citations)) {
        for (const cit of citationMeta.citations) {
          if (cit && typeof cit === "object") {
            citations.push(cit);
          }
        }
      }
    }
  }

  const sessionId = extractSessionId(session);
  const deepLinkUrl = buildDeepLinkUrl(widgetConfigId, sessionId);

  return {
    session,
    sessionId,
    deepLinkUrl,
    summary: textParts.join(""),
    results,
    citations
  };
}

function readAnswerResponse(rawBody, widgetConfigId, fallbackSession = "") {
  const data = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  if (!data || typeof data !== "object") {
    throw new Error("invalid_answer_response");
  }

  const answer = data.answer && typeof data.answer === "object" ? data.answer : {};
  const session = firstNonEmpty(
    data.session && data.session.name,
    typeof data.session === "string" ? data.session : "",
    fallbackSession
  );
  const summary = String(answer.answerText || "").trim();
  const seenSources = new Set();
  const results = [];

  const references = Array.isArray(answer.references) ? answer.references : [];
  for (const ref of references) {
    const chunkInfo = (ref && (ref.chunkInfo || ref.unstructuredDocumentInfo || ref.structuredDocumentInfo)) || {};
    const docMeta = chunkInfo.documentMetadata || chunkInfo;
    const title = String(docMeta.title || "Enterprise Source").trim();
    const url = String(docMeta.uri || "").trim();
    const snippet = String(chunkInfo.content || "").trim();
    const key = `${title.toLowerCase()}\n${url.toLowerCase()}`;
    if (!seenSources.has(key)) {
      seenSources.add(key);
      results.push({
        index: results.length + 1,
        title,
        url,
        snippet
      });
    }
  }

  const sessionId = extractSessionId(session);
  const deepLinkUrl = buildDeepLinkUrl(widgetConfigId, sessionId);

  return {
    session,
    sessionId,
    deepLinkUrl,
    summary,
    results,
    citations: Array.isArray(answer.citations) ? answer.citations : []
  };
}

async function patchSessionUserPseudoId({ config, token, sessionName, sessionId, requestFn = requestJson }) {
  const url = `${config.host}/v1alpha/${sessionName}?updateMask=userPseudoId`;
  return requestFn(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": config.projectId,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: { userPseudoId: sessionId }
  });
}

async function createDiscoverySession({ config, token, requestFn = requestJson }) {
  const url = `${config.host}/v1alpha/${config.enginePath}/sessions`;
  const payload = {
    state: "IN_PROGRESS"
  };

  const resp = await requestFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": config.projectId,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: payload
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`gemini_session_http_${resp.status}`);
    err.status = resp.status;
    err.upstreamBody = resp.body;
    err.detail = resp.body;
    throw err;
  }

  const parsed = JSON.parse(resp.body);
  if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
    throw new Error("gemini_session_missing_name");
  }
  const sessionName = parsed.name.trim();
  if (matchSessionUserPseudoIdEnabled()) {
    const sessionId = extractSessionId(sessionName);
    const current = String(parsed.userPseudoId || "").trim();
    if (sessionId && current !== sessionId) {
      const patchResp = await patchSessionUserPseudoId({
        config,
        token,
        sessionName,
        sessionId,
        requestFn
      });
      if (patchResp.status < 200 || patchResp.status >= 300) {
        const err = new Error(`gemini_session_patch_http_${patchResp.status}`);
        err.status = patchResp.status;
        err.upstreamBody = patchResp.body;
        throw err;
      }
    }
  }
  return sessionName;
}

function normalizeSessionResourceName(sessionInput, config) {
  const raw = String(sessionInput || "").trim();
  if (!raw || raw === "-" || raw.endsWith("/-")) {
    return "";
  }
  if (raw.includes("..")) {
    throw new Error("invalid_session_format");
  }
  if (raw.startsWith("projects/")) {
    return raw;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) {
    return `projects/${config.projectId}/locations/${config.location}/collections/default_collection/engines/${config.engineId}/sessions/${raw}`;
  }
  throw new Error("invalid_session_format");
}

async function searchGeminiEnterprise({
  query,
  session = "",
  mode = "streamAssist",
  userPseudoId = "",
  cloudIdentityEmail = "",
  entraAccessToken = "",
  googleAccessToken = "",
  req = null,
  onTokenRefreshed = null,
  configOverrides = {},
  tokenProvider,
  requestFn = requestJson
}) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  if (!trimmedQuery) {
    const err = new Error("query_required");
    err.statusCode = 400;
    throw err;
  }
  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    const err = new Error("query_too_long");
    err.statusCode = 400;
    throw err;
  }
  if (mode !== "streamAssist" && mode !== "answer") {
    const err = new Error("invalid_mode");
    err.statusCode = 400;
    throw err;
  }

  const config = getGeminiConfig(configOverrides);
  if (!config.projectId || !config.engineId) {
    const err = new Error("gemini_not_configured");
    err.statusCode = 502;
    throw err;
  }

  let activeSession = "";
  try {
    activeSession = normalizeSessionResourceName(session, config);
  } catch {
    const validationErr = new Error("invalid_session_format");
    validationErr.statusCode = 400;
    throw validationErr;
  }

  const token = tokenProvider
    ? await tokenProvider()
    : await getGoogleAccessToken({
        cloudIdentityEmail,
        entraAccessToken,
        googleAccessToken,
        req,
        onTokenRefreshed,
        configOverrides,
        requestFn
      });

  const pseudoForSession = matchSessionUserPseudoIdEnabled()
    ? ""
    : firstNonEmpty(userPseudoId, resolveUserPseudoIdForStorage(cloudIdentityEmail, userPseudoId));

  if (!activeSession) {
    activeSession = await createDiscoverySession({
      config,
      token,
      requestFn
    });
  }

  const activeSessionId = extractSessionId(activeSession);
  const storedPseudoId = matchSessionUserPseudoIdEnabled()
    ? activeSessionId
    : firstNonEmpty(pseudoForSession, activeSessionId);

  if (mode === "answer") {
    const answerUrl = `${config.host}/v1alpha/${config.enginePath}/servingConfigs/default_search:answer`;
    const answerPayload = {
      query: { text: trimmedQuery },
      session: activeSession,
      relatedQuestionsSpec: { enable: true },
      answerGenerationSpec: {
        ignoreAdversarialQuery: false,
        ignoreNonAnswerSeekingQuery: false,
        ignoreLowRelevantContent: false,
        includeCitations: true
      }
    };

    const resp = await requestFn(answerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": config.projectId,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: answerPayload
    });

    if (resp.status < 200 || resp.status >= 300) {
      const err = new Error(`gemini_http_${resp.status}`);
      err.status = resp.status;
      err.upstreamBody = resp.body;
      err.detail = resp.body;
      throw err;
    }

    const answerResult = readAnswerResponse(resp.body, config.widgetConfigId, activeSession);
    return {
      ...answerResult,
      mode: "answer",
      userPseudoId: storedPseudoId
    };
  }

  const streamAssistUrl = `${config.host}/v1alpha/${config.enginePath}/assistants/default_assistant:streamAssist`;
  const streamAssistPayload = {
    query: { text: trimmedQuery },
    session: activeSession,
    toolsSpec: {
      vertexAiSearchSpec: buildVertexAiSearchSpec()
    }
  };

  const resp = await requestFn(streamAssistUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": config.projectId,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: streamAssistPayload
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`gemini_http_${resp.status}`);
    err.status = resp.status;
    err.upstreamBody = resp.body;
    err.detail = resp.body;
    throw err;
  }

  const assistResult = readStreamAssistResponse(resp.body, config.widgetConfigId, activeSession);
  return {
    ...assistResult,
    mode: "streamAssist",
    userPseudoId: assistResult.sessionId || activeSessionId || storedPseudoId
  };
}

async function getDiscoverySession({
  session,
  cloudIdentityEmail = "",
  entraAccessToken = "",
  googleAccessToken = "",
  req = null,
  onTokenRefreshed = null,
  configOverrides = {},
  tokenProvider,
  requestFn = requestJson
}) {
  const config = getGeminiConfig(configOverrides);
  const sessionName = normalizeSessionResourceName(session, config);
  if (!sessionName) {
    const err = new Error("session_required");
    err.statusCode = 400;
    throw err;
  }

  const token = tokenProvider
    ? await tokenProvider()
    : await getGoogleAccessToken({
        cloudIdentityEmail,
        entraAccessToken,
        googleAccessToken,
        req,
        onTokenRefreshed,
        configOverrides,
        requestFn
      });
  const url = `${config.host}/v1alpha/${sessionName}?includeAnswerDetails=true`;
  const resp = await requestFn(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": config.projectId
    }
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`gemini_session_get_http_${resp.status}`);
    err.status = resp.status;
    err.upstreamBody = resp.body;
    err.detail = resp.body;
    throw err;
  }

  const data = JSON.parse(resp.body);
  const sessionId = extractSessionId(data.name || sessionName);
  const turns = Array.isArray(data.turns)
    ? data.turns.map((turn) => {
        const queryText = (turn.query && turn.query.text) || "";
        const detailed = turn.detailedAssistAnswer || {};
        const replies = Array.isArray(detailed.replies) ? detailed.replies : [];
        const answerParts = [];
        for (const r of replies) {
          const content = r && r.groundedContent && r.groundedContent.content;
          if (content && content.thought !== true && typeof content.text === "string") {
            answerParts.push(content.text);
          }
        }
        return {
          query: queryText,
          assistAnswerResource: turn.assistAnswer || "",
          answer: answerParts.join(""),
          state: detailed.state || ""
        };
      })
    : [];

  return {
    session: data.name || sessionName,
    sessionId,
    state: data.state || "",
    userPseudoId: data.userPseudoId || "",
    startTime: data.startTime || "",
    endTime: data.endTime || "",
    expireTime: data.expireTime || "",
    deepLinkUrl: buildDeepLinkUrl(config.widgetConfigId, sessionId),
    turns
  };
}

function writeJson(res, status, payload, req, extraHeaders = {}) {
  const allowOrigin = req && req.headers && req.headers.origin ? req.headers.origin : "*";
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Content-Type, X-User-Email, X-Google-Access-Token, X-Entra-Id-Token, X-Idp-Token",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error("payload_too_large");
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function attachGeminiSearchRoute(req, res, pathname, options = {}) {
  if (
    pathname !== "/api/search" &&
    pathname !== "/api/config" &&
    pathname !== "/api/session" &&
    pathname !== "/api/auth/google/login" &&
    pathname !== "/api/auth/google/callback" &&
    pathname !== "/api/auth/google/status" &&
    pathname !== "/api/auth/google/logout"
  ) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    writeJson(res, 204, {}, req);
    return true;
  }

  if (pathname === "/api/auth/google/login") {
    if (method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    const cfg = getGeminiConfig(options.configOverrides);
    if (!cfg.googleOAuthServerEnabled) {
      writeJson(res, 400, { error: "google_oauth_not_configured" }, req);
      return true;
    }
    const urlObj = new URL(req.url || "/", "http://localhost");
    const rawHint = urlObj.searchParams.get("login_hint") || "";
    const resolvedHint =
      resolveCloudIdentityEmail(rawHint, null, null, null, options.identityOverrides) ||
      resolveSignedInUserEmail(req, null, options.identityOverrides);
    const mode = urlObj.searchParams.get("mode") === "popup" ? "popup" : "redirect";
    const returnUrl = sanitizeOAuthReturnUrl(urlObj.searchParams.get("returnUrl"), req);
    const state = crypto.randomBytes(24).toString("base64url");
    const pkce = generatePkcePair();
    const key = getOAuthEncryptionKey(options.configOverrides);
    const stateCookieVal = sealOAuthPayload(
      {
        state,
        codeVerifier: pkce.codeVerifier,
        loginHint: resolvedHint || "",
        returnUrl,
        mode,
        exp: Date.now() + 10 * 60 * 1000
      },
      key
    );
    const redirectUri = resolveOAuthRedirectUri(req, cfg);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", cfg.googleOAuthClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", cfg.googleOAuthScopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
    authUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
    if (resolvedHint) {
      authUrl.searchParams.set("login_hint", resolvedHint);
    }
    const requestedPrompt = urlObj.searchParams.get("prompt");
    if (requestedPrompt) {
      authUrl.searchParams.set("prompt", requestedPrompt);
    }

    const setCookie = formatSetCookie(OAUTH_STATE_COOKIE_NAME, stateCookieVal, {
      maxAgeSec: 600,
      secure: isRequestHttps(req),
      httpOnly: true,
      sameSite: "Lax"
    });
    res.writeHead(302, {
      Location: authUrl.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": setCookie
    });
    res.end();
    return true;
  }

  if (pathname === "/api/auth/google/callback") {
    if (method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    const cfg = getGeminiConfig(options.configOverrides);
    if (!cfg.googleOAuthServerEnabled) {
      writeJson(res, 400, { error: "google_oauth_not_configured" }, req);
      return true;
    }
    const urlObj = new URL(req.url || "/", "http://localhost");
    const queryState = (urlObj.searchParams.get("state") || "").trim();
    const code = (urlObj.searchParams.get("code") || "").trim();
    const providerError = (urlObj.searchParams.get("error") || "").trim();
    const cookies = parseCookieHeader(headerValue(req, "cookie"));
    const rawStateCookie = firstNonEmpty(cookies[OAUTH_STATE_COOKIE_NAME]);
    const clearStateCookie = formatSetCookie(OAUTH_STATE_COOKIE_NAME, "", {
      maxAgeSec: 0,
      secure: isRequestHttps(req),
      httpOnly: true,
      sameSite: "Lax"
    });

    let statePayload;
    try {
      const key = getOAuthEncryptionKey(options.configOverrides);
      statePayload = unsealOAuthPayload(rawStateCookie, key);
    } catch (_err) {
      writeJson(res, 400, { error: "oauth_invalid_state" }, req, { "Set-Cookie": clearStateCookie });
      return true;
    }

    if (
      !queryState ||
      !statePayload ||
      statePayload.state !== queryState ||
      typeof statePayload.exp !== "number" ||
      statePayload.exp < Date.now()
    ) {
      writeJson(res, 400, { error: "oauth_invalid_state" }, req, { "Set-Cookie": clearStateCookie });
      return true;
    }

    if (providerError) {
      if (statePayload.mode === "redirect") {
        const safeTarget = appendQueryParam(
          sanitizeOAuthReturnUrl(statePayload.returnUrl, req),
          "google_auth",
          "skipped"
        );
        res.writeHead(302, {
          Location: safeTarget,
          "Cache-Control": "no-store",
          "Set-Cookie": clearStateCookie
        });
        res.end();
        return true;
      }
      writeJson(
        res,
        400,
        { error: "oauth_provider_error", detail: providerError },
        req,
        { "Set-Cookie": clearStateCookie }
      );
      return true;
    }

    if (!code) {
      writeJson(res, 400, { error: "oauth_code_required" }, req, { "Set-Cookie": clearStateCookie });
      return true;
    }

    const redirectUri = resolveOAuthRedirectUri(req, cfg);
    const requestFn = options.requestFn || requestJson;

    exchangeAuthorizationCodeForTokens({
      code,
      codeVerifier: statePayload.codeVerifier,
      redirectUri,
      config: cfg,
      requestFn
    })
      .then(async (tokenRes) => {
        const idClaims = readJwtPayload(tokenRes.idToken);
        let googleEmail = resolveCloudIdentityEmail(
          jwtClaim(idClaims, "email", "preferred_username", "upn"),
          jwtClaim(idClaims, "given_name"),
          jwtClaim(idClaims, "family_name"),
          jwtClaim(idClaims, "name"),
          options.identityOverrides
        );
        if (!googleEmail && tokenRes.accessToken) {
          const userInfoResp = await requestFn("https://openidconnect.googleapis.com/v1/userinfo", {
            method: "GET",
            headers: { Authorization: `Bearer ${tokenRes.accessToken}` },
            timeoutMs: 10000
          });
          if (userInfoResp.status >= 200 && userInfoResp.status < 300) {
            const info = JSON.parse(userInfoResp.body);
            googleEmail = resolveCloudIdentityEmail(
              info.email,
              info.given_name,
              info.family_name,
              info.name,
              options.identityOverrides
            );
          }
        }

        const expectedEmail = firstNonEmpty(
          resolveSignedInUserEmail(req, null, options.identityOverrides),
          statePayload.loginHint
        ).toLowerCase();

        if (expectedEmail && googleEmail && expectedEmail !== googleEmail.toLowerCase()) {
          const mismatchErr = new Error("oauth_identity_mismatch");
          mismatchErr.statusCode = 403;
          mismatchErr.detail = `Authenticated Google account (${googleEmail}) does not match signed-in enterprise identity (${expectedEmail}).`;
          throw mismatchErr;
        }

        const finalEmail = (googleEmail || expectedEmail).toLowerCase();
        if (!finalEmail) {
          const missingEmailErr = new Error("oauth_user_email_required");
          missingEmailErr.statusCode = 400;
          throw missingEmailErr;
        }

        const stored = storeUserGoogleOAuthTokens({
          email: finalEmail,
          accessToken: tokenRes.accessToken,
          refreshToken: tokenRes.refreshToken,
          expiresInSec: tokenRes.expiresIn
        });

        const key = getOAuthEncryptionKey(options.configOverrides);
        const sealedSession = sealOAuthPayload(stored, key);
        const sessionCookie = formatSetCookie(OAUTH_SESSION_COOKIE_NAME, sealedSession, {
          maxAgeSec: 30 * 24 * 3600,
          secure: isRequestHttps(req),
          httpOnly: true,
          sameSite: "Lax"
        });

        if (statePayload.mode === "popup") {
          const html = buildPopupCompleteHtml(finalEmail);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "Set-Cookie": [clearStateCookie, sessionCookie]
          });
          res.end(html);
          return;
        }

        const targetUrl = sanitizeOAuthReturnUrl(statePayload.returnUrl, req);
        res.writeHead(302, {
          Location: targetUrl,
          "Cache-Control": "no-store",
          "Set-Cookie": [clearStateCookie, sessionCookie]
        });
        res.end();
      })
      .catch((err) => {
        const status = err && err.statusCode ? err.statusCode : 502;
        writeJson(
          res,
          status,
          {
            error: err instanceof Error ? err.message : "oauth_callback_failed",
            detail: err && err.detail ? err.detail : undefined
          },
          req,
          { "Set-Cookie": clearStateCookie }
        );
      });
    return true;
  }

  if (pathname === "/api/auth/google/status") {
    if (method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    const cfg = getGeminiConfig(options.configOverrides);
    const userEmail = resolveSignedInUserEmail(req, null, options.identityOverrides);
    const tokenRecord = readUserGoogleOAuthFromRequest(req, userEmail, options.configOverrides);
    const hasValidAccess = Boolean(tokenRecord && tokenRecord.accessToken && tokenRecord.expiresAt > Date.now() + 60 * 1000);
    const hasRefresh = Boolean(tokenRecord && tokenRecord.refreshToken);
    const resolvedEmail = userEmail || (tokenRecord && tokenRecord.email) || "";
    writeJson(
      res,
      200,
      {
        enabled: cfg.googleOAuthServerEnabled,
        authenticated: Boolean(hasValidAccess || (hasRefresh && cfg.googleOAuthServerEnabled)),
        email: resolvedEmail,
        loginUrl: buildGoogleOAuthLoginPath(resolvedEmail, "popup")
      },
      req
    );
    return true;
  }

  if (pathname === "/api/auth/google/logout") {
    if (method !== "POST") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    const userEmail = resolveSignedInUserEmail(req, null, options.identityOverrides);
    const tokenRecord = readUserGoogleOAuthFromRequest(req, userEmail, options.configOverrides);
    if (userEmail) {
      userOAuthStore.delete(userEmail.toLowerCase());
    }
    if (tokenRecord && tokenRecord.email) {
      userOAuthStore.delete(tokenRecord.email.toLowerCase());
    }
    const clearSessionCookie = formatSetCookie(OAUTH_SESSION_COOKIE_NAME, "", {
      maxAgeSec: 0,
      secure: isRequestHttps(req),
      httpOnly: true,
      sameSite: "Lax"
    });
    writeJson(res, 200, { ok: true }, req, { "Set-Cookie": clearSessionCookie });
    return true;
  }

  if (pathname === "/api/config") {
    if (method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    try {
      const cfg = getGeminiConfig(options.configOverrides);
      const userEmail = resolveSignedInUserEmail(req, null, options.identityOverrides);
      const tokenRecord = readUserGoogleOAuthFromRequest(req, userEmail, options.configOverrides);
      const hasValidAccess = Boolean(tokenRecord && tokenRecord.accessToken && tokenRecord.expiresAt > Date.now() + 60 * 1000);
      const hasRefresh = Boolean(tokenRecord && tokenRecord.refreshToken);
      const googleOAuthAuthenticated = Boolean(
        hasValidAccess || (hasRefresh && cfg.googleOAuthServerEnabled)
      );
      const resolvedEmail = userEmail || (tokenRecord && tokenRecord.email) || "";
      writeJson(
        res,
        200,
        {
          projectId: cfg.projectId,
          location: cfg.location,
          engineId: cfg.engineId,
          widgetConfigId: cfg.widgetConfigId,
          webAppBaseUrl: cfg.webAppBaseUrl,
          apiMethod: "streamAssist",
          matchSessionUserPseudoId: matchSessionUserPseudoIdEnabled(),
          includeSessionInDeepLink: includeSessionInDeepLink(),
          userEmail: resolvedEmail,
          googleOAuthClientId: cfg.googleOAuthClientId || "",
          googleOAuthServerEnabled: cfg.googleOAuthServerEnabled,
          googleOAuthAuthenticated,
          googleOAuthLoginUrl: buildGoogleOAuthLoginPath(resolvedEmail, "popup")
        },
        req
      );
    } catch (err) {
      writeJson(res, 500, { error: err instanceof Error ? err.message : "config_error" }, req);
    }
    return true;
  }

  if (pathname === "/api/session") {
    if (method !== "GET") {
      writeJson(res, 405, { error: "method_not_allowed" }, req);
      return true;
    }
    const urlObj = new URL(req.url || "/", "http://localhost");
    const sessionParam = urlObj.searchParams.get("session") || "";
    const entraToken = extractBearerToken(req);
    const googleAccessToken = extractGoogleAccessToken(req, null);
    const cloudEmail = resolveSignedInUserEmail(req, null, options.identityOverrides);
    let refreshedCookieHeader = null;
    getDiscoverySession({
      session: sessionParam,
      cloudIdentityEmail: cloudEmail,
      entraAccessToken: entraToken,
      googleAccessToken,
      req,
      onTokenRefreshed: (refreshed) => {
        const key = getOAuthEncryptionKey(options.configOverrides);
        refreshedCookieHeader = formatSetCookie(
          OAUTH_SESSION_COOKIE_NAME,
          sealOAuthPayload(refreshed, key),
          {
            maxAgeSec: 30 * 24 * 3600,
            secure: isRequestHttps(req),
            httpOnly: true,
            sameSite: "Lax"
          }
        );
      },
      configOverrides: options.configOverrides,
      tokenProvider: options.tokenProvider,
      requestFn: options.requestFn
    })
      .then((result) =>
        writeJson(
          res,
          200,
          result,
          req,
          refreshedCookieHeader ? { "Set-Cookie": refreshedCookieHeader } : {}
        )
      )
      .catch((err) => {
        const status = err && err.statusCode ? err.statusCode : 502;
        writeJson(
          res,
          status,
          {
            error: err instanceof Error ? err.message : "session_lookup_failed",
            authUrl: err && err.authUrl ? err.authUrl : undefined,
            loginHint: err && err.loginHint ? err.loginHint : undefined
          },
          req
        );
      });
    return true;
  }

  if (method !== "POST") {
    writeJson(res, 405, { error: "method_not_allowed" }, req);
    return true;
  }

  let refreshedCookieHeader = null;
  readRequestBody(req)
    .then((raw) => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        const err = new Error("invalid_json");
        err.statusCode = 400;
        throw err;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        const err = new Error("invalid_json_object");
        err.statusCode = 400;
        throw err;
      }
      const entraToken = extractBearerToken(req);
      const googleAccessToken = extractGoogleAccessToken(req, body);
      const tokenRecord = readUserGoogleOAuthFromRequest(req, "", options.configOverrides);
      const cloudEmail =
        resolveSignedInUserEmail(req, body, options.identityOverrides) ||
        (tokenRecord && tokenRecord.email) ||
        "";
      const allowAnonymous = isTruthyEnv("GE_ALLOW_ANONYMOUS");
      if (!cloudEmail && !googleAccessToken && !options.tokenProvider && !allowAnonymous) {
        const err = new Error("user_identity_required");
        err.statusCode = 401;
        err.detail = "Signed-in browser session, Google OAuth token, or IdP authentication is required.";
        throw err;
      }
      const userPseudoId = resolveUserPseudoIdForStorage(cloudEmail, body.userPseudoId || "");
      const lockServerConfig = isTruthyEnv("GE_LOCK_SERVER_CONFIG");
      const mergedConfigOverrides = lockServerConfig
        ? options.configOverrides
        : {
            ...(options.configOverrides || {}),
            ...(typeof body.projectId === "string" && body.projectId.trim()
              ? { projectId: body.projectId.trim() }
              : {}),
            ...(typeof body.location === "string" && body.location.trim()
              ? { location: body.location.trim() }
              : {}),
            ...(typeof body.engineId === "string" && body.engineId.trim()
              ? { engineId: body.engineId.trim() }
              : {}),
            ...(typeof body.widgetConfigId === "string" && body.widgetConfigId.trim()
              ? { widgetConfigId: body.widgetConfigId.trim() }
              : {})
          };
      return searchGeminiEnterprise({
        query: body.query,
        session: body.session || "",
        mode: body.mode || "streamAssist",
        userPseudoId,
        cloudIdentityEmail: cloudEmail,
        entraAccessToken: entraToken,
        googleAccessToken,
        req,
        onTokenRefreshed: (refreshed) => {
          const key = getOAuthEncryptionKey(mergedConfigOverrides);
          refreshedCookieHeader = formatSetCookie(
            OAUTH_SESSION_COOKIE_NAME,
            sealOAuthPayload(refreshed, key),
            {
              maxAgeSec: 30 * 24 * 3600,
              secure: isRequestHttps(req),
              httpOnly: true,
              sameSite: "Lax"
            }
          );
        },
        configOverrides: mergedConfigOverrides,
        tokenProvider: options.tokenProvider,
        requestFn: options.requestFn
      }).then((answer) => ({
        answer,
        userPseudoId: answer.sessionId || answer.userPseudoId || userPseudoId,
        cloudIdentityEmail: cloudEmail
      }));
    })
    .then(({ answer, userPseudoId, cloudIdentityEmail }) => {
      writeJson(
        res,
        200,
        {
          ...answer,
          userPseudoId: userPseudoId || answer.userPseudoId || "",
          cloudIdentityEmail: cloudIdentityEmail || ""
        },
        req,
        refreshedCookieHeader ? { "Set-Cookie": refreshedCookieHeader } : {}
      );
    })
    .catch((err) => {
      const status = err && err.statusCode ? err.statusCode : 502;
      writeJson(
        res,
        status,
        {
          error: err instanceof Error ? err.message : "search_failed",
          detail: err && err.detail ? err.detail : undefined,
          authUrl: err && err.authUrl ? err.authUrl : undefined,
          loginHint: err && err.loginHint ? err.loginHint : undefined
        },
        req
      );
    });

  return true;
}

/**
 * Express / Connect compatible middleware factory.
 */
function createExpressMiddleware(options = {}) {
  return function geminiOmnibarMiddleware(req, res, next) {
    const urlObj = new URL(req.originalUrl || req.url || "/", "http://localhost");
    const handled = attachGeminiSearchRoute(req, res, urlObj.pathname, options);
    if (!handled && typeof next === "function") {
      next();
    }
  };
}

module.exports = {
  DEFAULT_GEMINI_CONFIG,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_SESSION_COOKIE_NAME,
  getGeminiConfig,
  getIdentityConfig,
  buildDeepLinkUrl,
  extractSessionId,
  parseJsonChunks,
  readStreamAssistResponse,
  readAnswerResponse,
  createDiscoverySession,
  normalizeSessionResourceName,
  searchGeminiEnterprise,
  getDiscoverySession,
  getGoogleAccessToken,
  clearTokenCache,
  attachGeminiSearchRoute,
  createExpressMiddleware,
  resolveCloudIdentityEmail,
  resolveSignedInUserEmail,
  resolveUserPseudoIdForStorage,
  extractBearerToken,
  extractGoogleAccessToken,
  exchangeEntraTokenForGoogleToken,
  matchSessionUserPseudoIdEnabled,
  patchSessionUserPseudoId,
  sealOAuthPayload,
  unsealOAuthPayload,
  generatePkcePair,
  sanitizeOAuthReturnUrl,
  storeUserGoogleOAuthTokens,
  readUserGoogleOAuthFromRequest,
  refreshUserGoogleOAuthToken,
  resolveServerGoogleOAuthToken,
  buildGoogleOAuthLoginPath
};

