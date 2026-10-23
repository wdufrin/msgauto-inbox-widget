/**
 * Browser-Direct (Serverless) Discovery Engine Client for <gemini-omnibar>.
 *
 * Enables Topology A (Zero-Backend Mode):
 * Calls Discovery Engine REST API (:streamAssist / :answer / sessions) directly from the browser
 * using the user's Google OAuth 2.0 access token (ya29...) acquired via Google Identity Services.
 */

import { buildDeepLinkUrl, GroundedSource } from "./markdown";
import { getGoogleOAuthToken } from "./auth-adapters";

export interface DirectClientConfig {
  projectId: string;
  location?: string;
  engineId: string;
  widgetConfigId?: string;
  googleClientId?: string;
  dataStores?: string[];
  matchSessionUserPseudoId?: boolean;
  includeSessionInDeepLink?: boolean;
}

export interface SearchResponsePayload {
  session: string;
  sessionId: string;
  deepLinkUrl: string;
  summary: string;
  results: GroundedSource[];
  citations: any[];
  mode: "streamAssist" | "answer";
  userPseudoId: string;
}

export interface HttpResponseLike {
  status: number;
  body: string;
}

export type DirectRequestFn = (
  url: string,
  options: { method: string; headers: Record<string, string>; body?: any }
) => Promise<HttpResponseLike>;

const MAX_QUERY_LENGTH = 4000;

export function extractSessionId(sessionName?: string): string {
  const raw = String(sessionName || "").trim();
  if (!raw) {
    return "";
  }
  const parts = raw.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last === "-" ? "" : last;
}

export function resolveDiscoveryHost(location: string = "global"): string {
  const loc = String(location || "global").trim();
  if (!/^[a-z0-9-]+$/i.test(loc)) {
    throw new Error(`invalid_gcp_location: ${loc}`);
  }
  return loc.toLowerCase() === "global"
    ? "https://discoveryengine.googleapis.com"
    : `https://${loc.toLowerCase()}-discoveryengine.googleapis.com`;
}

export function normalizeSessionResourceName(
  sessionInput: string | undefined,
  config: { projectId: string; location: string; engineId: string }
): string {
  const raw = String(sessionInput || "").trim();
  if (!raw || raw === "-" || raw.endsWith("/-")) {
    return "";
  }
  if (raw.includes("..")) {
    throw new Error("invalid_session_format");
  }
  if (/^projects\/[a-zA-Z0-9_-]+\/locations\/[a-zA-Z0-9_-]+\/collections\/[a-zA-Z0-9_-]+\/engines\/[a-zA-Z0-9_-]+\/sessions\/[a-zA-Z0-9_-]+$/.test(raw)) {
    return raw;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) {
    return `projects/${config.projectId}/locations/${config.location}/collections/default_collection/engines/${config.engineId}/sessions/${raw}`;
  }
  throw new Error("invalid_session_format");
}

/**
 * Split a Discovery Engine :streamAssist response body into JSON chunk objects.
 * Supports both JSON array format `[{...}, {...}]` and concatenated JSON objects.
 */
export function parseJsonChunks(rawBody: string): any[] {
  const trimmed = String(rawBody || "").trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_err) {
      throw new Error("malformed_json_stream_unterminated");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("invalid_stream_assist_json_array");
    }
    return parsed.filter((item) => item && typeof item === "object");
  }

  const chunks: any[] = [];
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

export function readStreamAssistResponse(
  rawBody: string,
  widgetConfigId: string = "",
  fallbackSession: string = "",
  includeSessionInDeepLink: boolean = true
): Omit<SearchResponsePayload, "mode" | "userPseudoId"> {
  const chunks = parseJsonChunks(rawBody);
  const textParts: string[] = [];
  let session = String(fallbackSession || "").trim();
  const seenSources = new Set<string>();
  const results: GroundedSource[] = [];
  const citations: any[] = [];

  for (const chunk of chunks) {
    if (
      chunk.sessionInfo &&
      typeof chunk.sessionInfo.session === "string" &&
      chunk.sessionInfo.session.trim()
    ) {
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
          const docMeta =
            ref.documentMetadata && typeof ref.documentMetadata === "object"
              ? ref.documentMetadata
              : {};
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
  const deepLinkUrl = buildDeepLinkUrl(widgetConfigId, sessionId, includeSessionInDeepLink);

  return {
    session,
    sessionId,
    deepLinkUrl,
    summary: textParts.join(""),
    results,
    citations
  };
}

export function readAnswerResponse(
  rawBody: string | Record<string, any>,
  widgetConfigId: string = "",
  fallbackSession: string = "",
  includeSessionInDeepLink: boolean = true
): Omit<SearchResponsePayload, "mode" | "userPseudoId"> {
  const data = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  if (!data || typeof data !== "object") {
    throw new Error("invalid_answer_response");
  }

  const answer = data.answer && typeof data.answer === "object" ? data.answer : {};
  const session =
    (data.session && typeof data.session.name === "string" && data.session.name.trim()) ||
    (typeof data.session === "string" && data.session.trim()) ||
    fallbackSession;
  const summary = String(answer.answerText || "").trim();
  const seenSources = new Set<string>();
  const results: GroundedSource[] = [];

  const references = Array.isArray(answer.references) ? answer.references : [];
  for (const ref of references) {
    const chunkInfo =
      (ref && (ref.chunkInfo || ref.unstructuredDocumentInfo || ref.structuredDocumentInfo)) || {};
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
  const deepLinkUrl = buildDeepLinkUrl(widgetConfigId, sessionId, includeSessionInDeepLink);

  return {
    session,
    sessionId,
    deepLinkUrl,
    summary,
    results,
    citations: Array.isArray(answer.citations) ? answer.citations : []
  };
}

const defaultBrowserRequestFn: DirectRequestFn = async (url, options) => {
  const resp = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined
  });
  const body = await resp.text();
  return {
    status: resp.status,
    body
  };
};

export async function searchDiscoveryEngineDirect(options: {
  query: string;
  session?: string;
  mode?: "streamAssist" | "answer";
  userEmail?: string;
  googleAccessToken?: string;
  config: DirectClientConfig;
  tokenProvider?: () => Promise<string>;
  requestFn?: DirectRequestFn;
}): Promise<SearchResponsePayload> {
  const trimmedQuery = String(options.query || "").trim();
  if (!trimmedQuery) {
    throw new Error("query_required");
  }
  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    throw new Error("query_too_long");
  }
  const mode = options.mode || "streamAssist";
  if (mode !== "streamAssist" && mode !== "answer") {
    throw new Error("invalid_mode");
  }

  const cfg = options.config || ({} as DirectClientConfig);
  const projectId = String(cfg.projectId || "").trim();
  const location = String(cfg.location || "global").trim();
  const engineId = String(cfg.engineId || "").trim();
  const widgetConfigId = String(cfg.widgetConfigId || "").trim();
  const matchSessionUserPseudoId = cfg.matchSessionUserPseudoId !== false;
  const includeSessionInDeepLink = cfg.includeSessionInDeepLink !== false;

  if (!projectId || !engineId) {
    throw new Error("gemini_not_configured");
  }

  const host = resolveDiscoveryHost(location);
  const enginePath = `projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/collections/default_collection/engines/${encodeURIComponent(engineId)}`;

  let activeSession = normalizeSessionResourceName(options.session, {
    projectId,
    location,
    engineId
  });

  let token = String(options.googleAccessToken || "").trim();
  if (!token && options.tokenProvider) {
    token = String((await options.tokenProvider()) || "").trim();
  }
  if (!token) {
    const oauth = await getGoogleOAuthToken(cfg.googleClientId, options.userEmail);
    token = (oauth && oauth.accessToken) || "";
  }
  if (!token) {
    throw new Error("google_oauth_token_required");
  }

  const requestFn = options.requestFn || defaultBrowserRequestFn;
  const commonHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Goog-User-Project": projectId,
    "Content-Type": "application/json; charset=utf-8"
  };

  if (!activeSession) {
    const sessionUrl = `${host}/v1alpha/${enginePath}/sessions`;
    const createResp = await requestFn(sessionUrl, {
      method: "POST",
      headers: commonHeaders,
      body: { state: "IN_PROGRESS" }
    });
    if (createResp.status < 200 || createResp.status >= 300) {
      throw new Error(`gemini_session_http_${createResp.status}`);
    }
    const created = JSON.parse(createResp.body);
    if (!created || typeof created.name !== "string" || !created.name.trim()) {
      throw new Error("gemini_session_missing_name");
    }
    activeSession = created.name.trim();
    const sessionId = extractSessionId(activeSession);
    if (matchSessionUserPseudoId && sessionId && created.userPseudoId !== sessionId) {
      const patchUrl = `${host}/v1alpha/${activeSession}?updateMask=userPseudoId`;
      const patchResp = await requestFn(patchUrl, {
        method: "PATCH",
        headers: commonHeaders,
        body: { userPseudoId: sessionId }
      });
      if (patchResp.status < 200 || patchResp.status >= 300) {
        throw new Error(`gemini_session_patch_http_${patchResp.status}`);
      }
    }
  }

  const activeSessionId = extractSessionId(activeSession);

  if (mode === "answer") {
    const answerUrl = `${host}/v1alpha/${enginePath}/servingConfigs/default_search:answer`;
    const answerResp = await requestFn(answerUrl, {
      method: "POST",
      headers: commonHeaders,
      body: {
        query: { text: trimmedQuery },
        session: activeSession,
        relatedQuestionsSpec: { enable: true },
        answerGenerationSpec: {
          ignoreAdversarialQuery: false,
          ignoreNonAnswerSeekingQuery: false,
          ignoreLowRelevantContent: false,
          includeCitations: true
        }
      }
    });
    if (answerResp.status < 200 || answerResp.status >= 300) {
      throw new Error(`gemini_http_${answerResp.status}`);
    }
    const parsedAnswer = readAnswerResponse(
      answerResp.body,
      widgetConfigId,
      activeSession,
      includeSessionInDeepLink
    );
    return {
      ...parsedAnswer,
      mode: "answer",
      userPseudoId: activeSessionId
    };
  }

  const streamAssistUrl = `${host}/v1alpha/${enginePath}/assistants/default_assistant:streamAssist`;
  const dataStoreSpecs = Array.isArray(cfg.dataStores) && cfg.dataStores.length > 0
    ? { dataStoreSpecs: cfg.dataStores.map((dataStore) => ({ dataStore })) }
    : {};

  const assistResp = await requestFn(streamAssistUrl, {
    method: "POST",
    headers: commonHeaders,
    body: {
      query: { text: trimmedQuery },
      session: activeSession,
      toolsSpec: {
        vertexAiSearchSpec: dataStoreSpecs
      }
    }
  });
  if (assistResp.status < 200 || assistResp.status >= 300) {
    throw new Error(`gemini_http_${assistResp.status}`);
  }

  const parsedAssist = readStreamAssistResponse(
    assistResp.body,
    widgetConfigId,
    activeSession,
    includeSessionInDeepLink
  );
  return {
    ...parsedAssist,
    mode: "streamAssist",
    userPseudoId: parsedAssist.sessionId || activeSessionId
  };
}
