/**
 * Pluggable Enterprise Identity & OAuth Adapters for <gemini-omnibar>.
 *
 * Supports:
 * 1. Configurable Identity Transform Strategies:
 *    - "passthrough" (default): uses user@company.com directly
 *    - "domain_rewrite": rewrites @corp.company.com -> @company.com (or derives given.family@company.com)
 *    - "claim_template": builds email from template e.g. "{given_name}.{family_name}@company.com"
 * 2. Browser Identity Discovery:
 *    - Entra ID (MSAL v2/v3/v4 sessionStorage/localStorage or window.__geEntraAuth)
 *    - Okta (okta-token-storage in localStorage/sessionStorage)
 *    - OIDC JWT cookies & headers
 * 3. Google Identity Services (GIS) OAuth Token Acquisition with login_hint & cache validation.
 */

export type IdentityStrategy = "passthrough" | "domain_rewrite" | "claim_template";

export interface IdentityConfig {
  strategy?: IdentityStrategy;
  targetDomain?: string;
  sourceDomain?: string;
  claimTemplate?: string;
}

export interface DiscoveredIdentity {
  email: string;
  givenName: string;
  familyName: string;
  displayName: string;
  provider?: "entra" | "okta" | "oidc" | "cookie" | "dom";
}

export function slugNamePart(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "");
}

export function parseNamesFromDisplayName(displayName: unknown): { givenName: string; familyName: string } {
  let normalized = String(displayName || "").trim();
  if (!normalized || normalized.indexOf("@") >= 0) {
    return { givenName: "", familyName: "" };
  }
  const paren = normalized.indexOf("(");
  if (paren > 0) {
    normalized = normalized.slice(0, paren).trim();
  }
  if (normalized.indexOf(",") >= 0) {
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

export function mailboxFromNames(given: unknown, family: unknown, domain: string): string {
  const g = slugNamePart(given);
  const f = slugNamePart(family);
  const d = String(domain || "").trim().toLowerCase().replace(/^@+/, "");
  if (!g || !f || !d) {
    return "";
  }
  return `${g}.${f}@${d}`;
}

/**
 * Customer-agnostic identity resolver supporting passthrough, domain_rewrite, and claim_template.
 */
export function resolveCloudIdentityEmail(
  emailOrIdentity: DiscoveredIdentity | string | null | undefined,
  given?: string,
  family?: string,
  displayName?: string,
  config?: IdentityConfig
): string {
  let rawEmail = "";
  let g = String(given || "").trim();
  let f = String(family || "").trim();
  let disp = String(displayName || "").trim();

  if (emailOrIdentity && typeof emailOrIdentity === "object") {
    rawEmail = String(emailOrIdentity.email || "").trim();
    g = g || String(emailOrIdentity.givenName || "").trim();
    f = f || String(emailOrIdentity.familyName || "").trim();
    disp = disp || String(emailOrIdentity.displayName || "").trim();
  } else {
    rawEmail = String(emailOrIdentity || "").trim();
  }

  const strategy: IdentityStrategy = (config && config.strategy) || "passthrough";
  const targetDomain = String((config && config.targetDomain) || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  const sourceDomain = String((config && config.sourceDomain) || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  const template = String((config && config.claimTemplate) || "{given_name}.{family_name}@{domain}").trim();

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

  if (strategy === "claim_template") {
    const effectiveDomain = targetDomain || emailDomain;
    if (cleanGiven && cleanFamily && effectiveDomain) {
      return template
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

  if (strategy === "domain_rewrite") {
    const effectiveTarget = targetDomain || emailDomain;
    const isSourceMatch =
      !sourceDomain ||
      emailDomain === sourceDomain ||
      emailDomain.endsWith("." + sourceDomain);

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
  // If a targetDomain is explicitly configured and we have given/family claims for a subdomain UPN,
  // rewrite if it matches sourceDomain; otherwise pass the email through untouched.
  if (rawEmail && atIndex > 0) {
    if (
      sourceDomain &&
      targetDomain &&
      (emailDomain === sourceDomain || emailDomain.endsWith("." + sourceDomain))
    ) {
      if (cleanGiven && cleanFamily) {
        return `${cleanGiven}.${cleanFamily}@${targetDomain}`;
      }
      return `${emailUser}@${targetDomain}`;
    }
    return rawEmail.toLowerCase();
  }

  if (cleanGiven && cleanFamily && targetDomain) {
    return `${cleanGiven}.${cleanFamily}@${targetDomain}`;
  }

  return "";
}

export function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // Expected when inspecting non-JSON browser storage entries
    return null;
  }
}

export function decodeJwtPayload(token: string | null | undefined): Record<string, any> | null {
  const raw = String(token || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length < 2 || typeof atob !== "function") {
    return null;
  }
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }
    const decoded = decodeURIComponent(
      Array.prototype.map
        .call(atob(b64), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return parseJsonSafe(decoded);
  } catch (_err) {
    // Malformed base64 JWT payload
    return null;
  }
}

function getBrowserStorages(): Storage[] {
  const storages: Storage[] = [];
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      storages.push(window.sessionStorage);
    }
  } catch (_err) {
    // Storage blocked by browser privacy settings
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storages.push(window.localStorage);
    }
  } catch (_err) {
    // Storage blocked by browser privacy settings
  }
  return storages;
}

export function msalAccountFromStorage(): Record<string, any> | null {
  const storages = getBrowserStorages();
  for (let s = 0; s < storages.length; s++) {
    const storage = storages[s];
    const accountKeyLists = [
      parseJsonSafe(storage.getItem("msal.1.account.keys")),
      parseJsonSafe(storage.getItem("msal.account.keys"))
    ];
    for (let k = 0; k < accountKeyLists.length; k++) {
      const list = accountKeyLists[k];
      if (Array.isArray(list)) {
        for (let idx = 0; idx < list.length; idx++) {
          const acctObj = parseJsonSafe(storage.getItem(list[idx]));
          if (acctObj && (acctObj.username || acctObj.homeAccountId || acctObj.idTokenClaims)) {
            return acctObj;
          }
        }
      }
    }
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i) || "";
      const parsed = parseJsonSafe(storage.getItem(key));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      if (
        (parsed.homeAccountId && (parsed.username || parsed.idTokenClaims || parsed.localAccountId)) ||
        (key.indexOf("msal") >= 0 && (parsed.username || parsed.homeAccountId))
      ) {
        return parsed;
      }
    }
  }
  return null;
}

export function msalTokenFromStorage(): string {
  const storages = getBrowserStorages();
  for (let s = 0; s < storages.length; s++) {
    const storage = storages[s];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i) || "";
      if (key.indexOf("token.keys") >= 0) {
        const keyMap = parseJsonSafe(storage.getItem(key));
        if (keyMap && typeof keyMap === "object") {
          const tokenKeyList = ([] as string[]).concat(keyMap.idToken || [], keyMap.accessToken || []);
          for (let t = 0; t < tokenKeyList.length; t++) {
            const entry = parseJsonSafe(storage.getItem(tokenKeyList[t]));
            if (entry && typeof entry.secret === "string" && entry.secret.trim()) {
              return entry.secret.trim();
            }
          }
        }
      }
    }
    for (let j = 0; j < storage.length; j++) {
      const k2 = storage.key(j) || "";
      const item = parseJsonSafe(storage.getItem(k2));
      if (
        item &&
        typeof item === "object" &&
        (item.credentialType === "IdToken" || item.credentialType === "AccessToken") &&
        typeof item.secret === "string" &&
        item.secret.trim()
      ) {
        return item.secret.trim();
      }
    }
  }
  return "";
}

export function oktaTokenFromStorage(): { token: string; claims: Record<string, any> | null } | null {
  const storages = getBrowserStorages();
  for (let s = 0; s < storages.length; s++) {
    const raw = storages[s].getItem("okta-token-storage");
    const parsed = parseJsonSafe(raw);
    if (parsed && typeof parsed === "object") {
      const idTokenObj = parsed.idToken;
      const accessTokenObj = parsed.accessToken;
      const token =
        (idTokenObj && (idTokenObj.idToken || idTokenObj.value)) ||
        (accessTokenObj && (accessTokenObj.accessToken || accessTokenObj.value)) ||
        "";
      const claims =
        (idTokenObj && idTokenObj.claims) ||
        (token ? decodeJwtPayload(token) : null);
      if (token || claims) {
        return { token: String(token || "").trim(), claims };
      }
    }
  }
  return null;
}

export function readBrowserCookie(name: string): string {
  if (typeof document === "undefined" || !document.cookie) {
    return "";
  }
  const parts = document.cookie.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const k = part.slice(0, eq).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch (_err) {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return "";
}

export function discoverBrowserIdentity(fallbackSessionEmail?: string): DiscoveredIdentity | null {
  const win = typeof window !== "undefined" ? (window as any) : null;
  const entraHook = win ? win.__geEntraAuth : null;
  if (entraHook && typeof entraHook.getAccount === "function") {
    const acct = entraHook.getAccount();
    if (acct) {
      const claims = acct.idTokenClaims || {};
      return {
        email: acct.username || acct.email || claims.preferred_username || claims.email || "",
        givenName: claims.given_name || "",
        familyName: claims.family_name || "",
        displayName: acct.name || claims.name || "",
        provider: "entra"
      };
    }
  }

  const msal = msalAccountFromStorage();
  if (msal) {
    const msalClaims = msal.idTokenClaims || {};
    return {
      email: msal.username || msalClaims.preferred_username || msalClaims.email || "",
      givenName: msalClaims.given_name || "",
      familyName: msalClaims.family_name || "",
      displayName: msal.name || msalClaims.name || "",
      provider: "entra"
    };
  }

  const okta = oktaTokenFromStorage();
  if (okta && okta.claims) {
    const c = okta.claims;
    return {
      email: c.email || c.preferred_username || c.upn || "",
      givenName: c.given_name || "",
      familyName: c.family_name || "",
      displayName: c.name || "",
      provider: "okta"
    };
  }

  const storedJwt =
    msalTokenFromStorage() ||
    readBrowserCookie("ge_id_token") ||
    readBrowserCookie("id_token") ||
    readBrowserCookie("access_token");
  if (storedJwt) {
    const jwtClaims = decodeJwtPayload(storedJwt);
    if (jwtClaims) {
      return {
        email:
          jwtClaims.email ||
          jwtClaims.preferred_username ||
          jwtClaims.upn ||
          jwtClaims.unique_name ||
          "",
        givenName: jwtClaims.given_name || "",
        familyName: jwtClaims.family_name || "",
        displayName: jwtClaims.name || "",
        provider: "oidc"
      };
    }
  }

  const cookieEmail =
    readBrowserCookie("ge_user_email") ||
    readBrowserCookie("user_email") ||
    String(fallbackSessionEmail || "").trim();
  if (cookieEmail) {
    return { email: cookieEmail, givenName: "", familyName: "", displayName: "", provider: "cookie" };
  }

  if (typeof document !== "undefined") {
    const script = document.querySelector("script[data-user-email]");
    if (script) {
      const dataEmail = script.getAttribute("data-user-email");
      if (dataEmail) {
        return { email: dataEmail, givenName: "", familyName: "", displayName: "", provider: "dom" };
      }
    }
  }

  return null;
}

export function getIdpAccessToken(): Promise<string> {
  const win = typeof window !== "undefined" ? (window as any) : null;
  const entraHook = win ? win.__geEntraAuth : null;
  if (entraHook && typeof entraHook.getToken === "function") {
    return Promise.resolve(entraHook.getToken(false))
      .catch(() => entraHook.getToken(true))
      .catch(() => msalTokenFromStorage());
  }
  const msalTok = msalTokenFromStorage();
  if (msalTok) {
    return Promise.resolve(msalTok);
  }
  const okta = oktaTokenFromStorage();
  if (okta && okta.token) {
    return Promise.resolve(okta.token);
  }
  return Promise.resolve("");
}

let gisLoadPromise: Promise<boolean> | null = null;

export function loadGoogleIdentityServices(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  const win = window as any;
  if (win.google && win.google.accounts && win.google.accounts.oauth2) {
    return Promise.resolve(true);
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }
  gisLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      resolve(Boolean(win.google && win.google.accounts && win.google.accounts.oauth2));
    };
    script.onerror = () => {
      gisLoadPromise = null;
      resolve(false);
    };
    (document.head || document.body || document.documentElement).appendChild(script);
  });
  return gisLoadPromise;
}

const OAUTH_STORAGE_KEYS = ["ge_omnibar_google_oauth"];

export function readCachedGoogleOAuth(
  loginHintEmail?: string
): { accessToken: string; email: string } | null {
  const hint = String(loginHintEmail || "").trim().toLowerCase();
  try {
    if (typeof sessionStorage !== "undefined") {
      for (const key of OAUTH_STORAGE_KEYS) {
        const raw = sessionStorage.getItem(key);
        if (!raw) {
          continue;
        }
        const parsed = parseJsonSafe(raw);
        if (
          parsed &&
          typeof parsed.accessToken === "string" &&
          parsed.accessToken &&
          typeof parsed.expiresAt === "number" &&
          parsed.expiresAt > Date.now() + 60000
        ) {
          const cachedEmail = String(parsed.email || "").trim().toLowerCase();
          if (!hint || !cachedEmail || hint === cachedEmail) {
            return { accessToken: parsed.accessToken, email: cachedEmail || hint };
          }
        }
      }
    }
  } catch (_err) {
    // sessionStorage unavailable
  }
  const cookieToken = readBrowserCookie("ge_google_access_token");
  if (cookieToken) {
    return {
      accessToken: cookieToken,
      email:
        hint ||
        String(readBrowserCookie("ge_user_email") || "")
          .trim()
          .toLowerCase()
    };
  }
  return null;
}

export function saveCachedGoogleOAuth(
  accessToken: string,
  email?: string,
  expiresInSec?: number
): { accessToken: string; email: string } {
  const ttlMs = (Number(expiresInSec) > 0 ? Number(expiresInSec) : 3300) * 1000;
  const record = {
    accessToken: String(accessToken || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    expiresAt: Date.now() + ttlMs
  };
  try {
    if (typeof sessionStorage !== "undefined") {
      const serialized = JSON.stringify(record);
      sessionStorage.setItem("ge_omnibar_google_oauth", serialized);
    }
  } catch (_err) {
    // sessionStorage unavailable
  }
  return { accessToken: record.accessToken, email: record.email };
}

export function resolveGoogleClientId(configuredClientId?: string): string {
  if (configuredClientId && String(configuredClientId).trim()) {
    return String(configuredClientId).trim();
  }
  if (typeof window !== "undefined") {
    const win = window as any;
    const globalId = win.__GE_GOOGLE_OAUTH_CLIENT_ID;
    if (globalId && String(globalId).trim()) {
      return String(globalId).trim();
    }
  }
  if (typeof document !== "undefined") {
    const script = document.querySelector("script[data-google-client-id]");
    if (script) {
      const attr = script.getAttribute("data-google-client-id");
      if (attr && attr.trim()) {
        return attr.trim();
      }
    }
  }
  return "";
}

export function getGoogleOAuthToken(
  configuredClientId?: string,
  loginHintEmail?: string
): Promise<{ accessToken: string; email: string } | null> {
  const hint = String(loginHintEmail || "").trim().toLowerCase();
  const cached = readCachedGoogleOAuth(hint);
  if (cached && cached.accessToken) {
    return Promise.resolve(cached);
  }

  const win = typeof window !== "undefined" ? (window as any) : null;
  const googleAuthHook = win ? win.__geGoogleAuth : null;
  if (googleAuthHook && typeof googleAuthHook.getToken === "function") {
    return Promise.resolve(googleAuthHook.getToken(hint))
      .then((res: any) => {
        if (!res) {
          return null;
        }
        if (typeof res === "string") {
          return saveCachedGoogleOAuth(res, hint, 3300);
        }
        if (typeof res.accessToken === "string" && res.accessToken) {
          return saveCachedGoogleOAuth(res.accessToken, res.email || hint, res.expiresIn);
        }
        return null;
      })
      .catch(() => null);
  }

  const clientId = resolveGoogleClientId(configuredClientId);
  if (!clientId) {
    return Promise.resolve(null);
  }

  return loadGoogleIdentityServices().then((loaded) => {
    if (!loaded || !win || !win.google || !win.google.accounts || !win.google.accounts.oauth2) {
      return null;
    }

    function requestWithPrompt(
      promptMode: string
    ): Promise<{ accessToken?: string; expiresIn?: number; error?: string }> {
      return new Promise((resolve) => {
        const client = win.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "https://www.googleapis.com/auth/cloud-platform openid email",
          hint,
          prompt: promptMode,
          callback: (resp: any) => {
            if (!resp || resp.error || !resp.access_token) {
              resolve({ error: (resp && resp.error) || "token_error" });
              return;
            }
            resolve({
              accessToken: resp.access_token,
              expiresIn: resp.expires_in
            });
          },
          error_callback: (err: any) => {
            resolve({ error: (err && err.type) || "gis_error" });
          }
        });
        client.requestAccessToken({
          prompt: promptMode,
          hint
        });
      });
    }

    return requestWithPrompt("")
      .then((firstTry) => {
        if (firstTry && firstTry.accessToken) {
          return firstTry;
        }
        return requestWithPrompt("select_account");
      })
      .then((tokenRes) => {
        if (!tokenRes || !tokenRes.accessToken) {
          return null;
        }
        const accessToken = tokenRes.accessToken;
        if (hint || typeof fetch !== "function") {
          return saveCachedGoogleOAuth(accessToken, hint, tokenRes.expiresIn);
        }
        return fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + accessToken }
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((info) => {
            const resolvedEmail =
              (info && typeof info.email === "string" ? info.email.trim().toLowerCase() : "") || hint;
            return saveCachedGoogleOAuth(accessToken, resolvedEmail, tokenRes.expiresIn);
          })
          .catch(() => saveCachedGoogleOAuth(accessToken, hint, tokenRes.expiresIn));
      });
  });
}

export function completeServerGoogleOAuthPopup(
  authUrl?: string,
  loginHintEmail?: string,
  apiBaseUrl: string = ""
): Promise<boolean> {
  const cleanBase = String(apiBaseUrl || "").trim().replace(/\/+$/, "");
  let targetUrl = String(authUrl || "/api/auth/google/login").trim();
  if (!targetUrl.startsWith("/api/auth/google/login") && !/^https?:\/\/[^/]+\/api\/auth\/google\/login/i.test(targetUrl)) {
    targetUrl = "/api/auth/google/login";
  }
  if (targetUrl.startsWith("/") && cleanBase) {
    targetUrl = `${cleanBase}${targetUrl}`;
  }
  const hint = String(loginHintEmail || "").trim().toLowerCase();
  if (hint && targetUrl.indexOf("login_hint=") === -1) {
    targetUrl += (targetUrl.indexOf("?") >= 0 ? "&" : "?") + "login_hint=" + encodeURIComponent(hint);
  }
  if (targetUrl.indexOf("mode=") === -1) {
    targetUrl += (targetUrl.indexOf("?") >= 0 ? "&" : "?") + "mode=popup";
  }

  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  const win = window as any;
  const popupHook = win.__geServerOAuthPopup;
  if (typeof popupHook === "function") {
    return Promise.resolve(popupHook(targetUrl, hint));
  }
  if (typeof window.open !== "function") {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    let popup: Window | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function finish(ok: boolean) {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      window.removeEventListener("message", onMessage);
      resolve(Boolean(ok));
    }

    function onMessage(event: MessageEvent) {
      if (!window.location || event.origin !== window.location.origin) {
        return;
      }
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        data.type === "ge_omnibar_google_oauth_complete"
      ) {
        finish(Boolean(data.ok));
      }
    }

    window.addEventListener("message", onMessage);
    popup = window.open(
      targetUrl,
      "ge_omnibar_google_oauth",
      "width=520,height=640,menubar=no,toolbar=no,location=no,status=no"
    );
    if (!popup) {
      finish(false);
      return;
    }

    pollTimer = setInterval(() => {
      if (popup && popup.closed) {
        finish(true);
      }
    }, 250);

    timeoutTimer = setTimeout(() => {
      finish(false);
    }, 60000);
  });
}

export function prepareOmnibarSearchPayload(
  query: string,
  session?: string,
  mode: string = "streamAssist",
  sessionUserEmail?: string,
  googleOAuthClientId?: string,
  identityConfig?: IdentityConfig,
  serverOAuthEnabled: boolean = false
): Promise<{ headers: Record<string, string>; body: Record<string, any> }> {
  const identity = discoverBrowserIdentity(sessionUserEmail);
  const headers: Record<string, string> = { Accept: "application/json" };
  let cloudEmail = "";
  if (identity) {
    cloudEmail = resolveCloudIdentityEmail(
      identity.email,
      identity.givenName,
      identity.familyName,
      identity.displayName,
      identityConfig
    );
    if (cloudEmail) {
      headers["X-User-Email"] = cloudEmail;
    }
  }

  const googleTokenPromise = serverOAuthEnabled
    ? Promise.resolve(null)
    : getGoogleOAuthToken(googleOAuthClientId, cloudEmail);

  return Promise.all([
    getIdpAccessToken(),
    googleTokenPromise
  ]).then(([idpToken, googleAuth]) => {
    if (idpToken) {
      headers.Authorization = "Bearer " + idpToken;
    }
    if (googleAuth && googleAuth.accessToken) {
      headers["X-Google-Access-Token"] = googleAuth.accessToken;
      if (!cloudEmail && googleAuth.email) {
        cloudEmail =
          resolveCloudIdentityEmail(googleAuth.email, "", "", "", identityConfig) || googleAuth.email;
        if (cloudEmail) {
          headers["X-User-Email"] = cloudEmail;
        }
      }
    }
    const body: Record<string, any> = {
      query,
      session: session || "",
      mode
    };
    if (cloudEmail) {
      body.userPseudoId = cloudEmail;
    }
    if (googleAuth && googleAuth.accessToken) {
      body.googleAccessToken = googleAuth.accessToken;
    }
    return { headers, body };
  });
}

