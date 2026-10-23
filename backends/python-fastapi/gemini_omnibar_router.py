"""
Drop-in FastAPI Router for <gemini-omnibar>.

Exposes:
  - GET  /api/config
  - POST /api/search
  - GET  /api/session

Supports all 4 enterprise auth modes:
  1. Per-user Google OAuth token passthrough (X-Google-Access-Token / Bearer ya29...)
  2. Workforce Identity Federation (WIF STS token exchange from Entra/Okta JWT)
  3. Cloud Run IAP (X-Goog-Authenticated-User-Email) / Azure EasyAuth
  4. Application Default Credentials (google.auth.default)
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import google.auth
import google.auth.transport.requests
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()

MAX_QUERY_LENGTH = 4000


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    session: str = ""
    mode: str = "streamAssist"
    userPseudoId: str = ""
    googleAccessToken: str = ""


def _get_config() -> Dict[str, Any]:
    project_id = os.environ.get("GCP_PROJECT_ID", "").strip()
    location = os.environ.get("GCP_LOCATION", "global").strip()
    engine_id = os.environ.get("GE_ENGINE_ID", "").strip()
    widget_config_id = os.environ.get("GE_WIDGET_CONFIG_ID", "").strip()
    google_oauth_client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()

    if not re.match(r"^[a-zA-Z0-9-]+$", location):
        raise ValueError(f"invalid_gcp_location: {location}")

    host = (
        "https://discoveryengine.googleapis.com"
        if location.lower() == "global"
        else f"https://{location.lower()}-discoveryengine.googleapis.com"
    )
    engine_path = (
        f"projects/{quote(project_id)}/locations/{quote(location)}"
        f"/collections/default_collection/engines/{quote(engine_id)}"
    )
    return {
        "projectId": project_id,
        "location": location,
        "engineId": engine_id,
        "widgetConfigId": widget_config_id,
        "googleOAuthClientId": google_oauth_client_id,
        "host": host,
        "enginePath": engine_path,
        "webAppBaseUrl": build_deep_link_url(widget_config_id, ""),
    }


def build_deep_link_url(widget_config_id: str, session_id: str = "") -> str:
    cid = (widget_config_id or "").strip()
    if not cid:
        return "https://vertexaisearch.cloud.google.com/u/0/home"
    base = f"https://vertexaisearch.cloud.google.com/u/0/home/cid/{quote(cid)}"
    sid = (session_id or "").strip()
    if not sid or sid == "-":
        return base
    return f"{base}/r/session/{quote(sid)}"


def extract_session_id(session_name: str) -> str:
    parts = [p for p in (session_name or "").strip().split("/") if p]
    if not parts:
        return ""
    last = parts[-1]
    return "" if last == "-" else last


def normalize_session_name(session_input: str, cfg: Dict[str, Any]) -> str:
    raw = (session_input or "").strip()
    if not raw or raw == "-" or raw.endswith("/-"):
        return ""
    if ".." in raw:
        raise ValueError("invalid_session_format")
    if raw.startswith("projects/"):
        return raw
    if re.match(r"^[a-zA-Z0-9_-]+$", raw):
        return (
            f"projects/{cfg['projectId']}/locations/{cfg['location']}"
            f"/collections/default_collection/engines/{cfg['engineId']}/sessions/{raw}"
        )
    raise ValueError("invalid_session_format")


def _decode_jwt_claims(token: str) -> Dict[str, Any]:
    raw = (token or "").strip()
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    parts = raw.split(".")
    if len(parts) < 2:
        return {}
    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload_b64.encode("utf-8"))
        data = json.loads(decoded.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except (ValueError, json.JSONDecodeError):
        # Invalid base64 or non-JSON JWT payload
        return {}


def resolve_user_email(request: Request, body_pseudo_id: str = "") -> str:
    iap = request.headers.get("x-goog-authenticated-user-email", "").strip()
    if iap:
        if ":" in iap and iap.lower().startswith("accounts.google.com:"):
            iap = iap.split(":", 1)[1].strip()
        if "@" in iap:
            return iap.lower()

    easy_auth = (
        request.headers.get("x-ms-client-principal-name", "").strip()
        or request.headers.get("x-forwarded-email", "").strip()
        or request.headers.get("x-user-email", "").strip()
    )
    if easy_auth and "@" in easy_auth:
        return easy_auth.lower()

    auth_header = request.headers.get("authorization", "").strip()
    if auth_header and not auth_header.lower().startswith("bearer ya29."):
        claims = _decode_jwt_claims(auth_header)
        email = (
            claims.get("email")
            or claims.get("preferred_username")
            or claims.get("upn")
            or ""
        ).strip()
        if "@" in email:
            return email.lower()

    if "@" in (body_pseudo_id or ""):
        return body_pseudo_id.strip().lower()

    return ""


async def resolve_google_token(request: Request, body_google_token: str = "") -> str:
    header_tok = request.headers.get("x-google-access-token", "").strip()
    if header_tok:
        return header_tok
    if body_google_token.strip():
        return body_google_token.strip()

    auth_header = request.headers.get("authorization", "").strip()
    if auth_header.lower().startswith("bearer ya29."):
        return auth_header[7:].strip()

    sts_audience = os.environ.get("GE_STS_AUDIENCE", "").strip()
    if sts_audience and auth_header.lower().startswith("bearer "):
        subject_token = auth_header[7:].strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            sts_resp = await client.post(
                "https://sts.googleapis.com/v1/token",
                json={
                    "grantType": "urn:ietf:params:oauth:grant-type:token-exchange",
                    "requestedTokenType": "urn:ietf:params:oauth:token-type:access_token",
                    "subjectTokenType": "urn:ietf:params:oauth:token-type:jwt",
                    "subjectToken": subject_token,
                    "audience": sts_audience,
                    "scope": "https://www.googleapis.com/auth/cloud-platform",
                },
            )
            if sts_resp.status_code == 200:
                token_data = sts_resp.json()
                if token_data.get("access_token"):
                    return str(token_data["access_token"]).strip()

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    auth_req = google.auth.transport.requests.Request()
    creds.refresh(auth_req)
    if not creds.token:
        raise HTTPException(status_code=502, detail="adc_unavailable")
    return creds.token


@router.get("/api/config")
async def get_omnibar_config(request: Request) -> Dict[str, Any]:
    cfg = _get_config()
    return {
        "projectId": cfg["projectId"],
        "location": cfg["location"],
        "engineId": cfg["engineId"],
        "widgetConfigId": cfg["widgetConfigId"],
        "webAppBaseUrl": cfg["webAppBaseUrl"],
        "apiMethod": "streamAssist",
        "matchSessionUserPseudoId": True,
        "includeSessionInDeepLink": True,
        "userEmail": resolve_user_email(request),
        "googleOAuthClientId": cfg["googleOAuthClientId"],
    }


@router.post("/api/search")
async def post_omnibar_search(payload: SearchRequest, request: Request) -> Dict[str, Any]:
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail={"error": "query_required"})
    if len(query) > MAX_QUERY_LENGTH:
        raise HTTPException(status_code=400, detail={"error": "query_too_long"})
    if payload.mode not in ("streamAssist", "answer"):
        raise HTTPException(status_code=400, detail={"error": "invalid_mode"})

    cfg = _get_config()
    if not cfg["projectId"] or not cfg["engineId"]:
        raise HTTPException(status_code=502, detail={"error": "gemini_not_configured"})

    try:
        active_session = normalize_session_name(payload.session, cfg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    user_email = resolve_user_email(request, payload.userPseudoId)
    token = await resolve_google_token(request, payload.googleAccessToken)

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Goog-User-Project": cfg["projectId"],
        "Content-Type": "application/json; charset=utf-8",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        if not active_session:
            sess_url = f"{cfg['host']}/v1alpha/{cfg['enginePath']}/sessions"
            sess_resp = await client.post(sess_url, headers=headers, json={"state": "IN_PROGRESS"})
            if sess_resp.status_code >= 300:
                raise HTTPException(
                    status_code=502,
                    detail={"error": f"gemini_session_http_{sess_resp.status_code}"},
                )
            sess_data = sess_resp.json()
            active_session = sess_data.get("name", "").strip()
            session_id = extract_session_id(active_session)
            if session_id and sess_data.get("userPseudoId") != session_id:
                patch_url = f"{cfg['host']}/v1alpha/{active_session}?updateMask=userPseudoId"
                await client.patch(
                    patch_url, headers=headers, json={"userPseudoId": session_id}
                )

        session_id = extract_session_id(active_session)

        if payload.mode == "answer":
            ans_url = f"{cfg['host']}/v1alpha/{cfg['enginePath']}/servingConfigs/default_search:answer"
            ans_resp = await client.post(
                ans_url,
                headers=headers,
                json={
                    "query": {"text": query},
                    "session": active_session,
                    "relatedQuestionsSpec": {"enable": True},
                    "answerGenerationSpec": {"includeCitations": True},
                },
            )
            if ans_resp.status_code >= 300:
                raise HTTPException(
                    status_code=502, detail={"error": f"gemini_http_{ans_resp.status_code}"}
                )
            data = ans_resp.json()
            answer_obj = data.get("answer") or {}
            results: List[Dict[str, Any]] = []
            for idx, ref in enumerate(answer_obj.get("references") or [], start=1):
                chunk = ref.get("chunkInfo") or ref.get("unstructuredDocumentInfo") or {}
                doc_meta = chunk.get("documentMetadata") or chunk
                results.append(
                    {
                        "index": idx,
                        "title": doc_meta.get("title") or f"Source {idx}",
                        "url": doc_meta.get("uri") or "",
                        "snippet": chunk.get("content") or "",
                    }
                )
            return {
                "session": active_session,
                "sessionId": session_id,
                "deepLinkUrl": build_deep_link_url(cfg["widgetConfigId"], session_id),
                "summary": answer_obj.get("answerText") or "",
                "results": results,
                "citations": answer_obj.get("citations") or [],
                "mode": "answer",
                "userPseudoId": session_id,
                "cloudIdentityEmail": user_email,
            }

        assist_url = f"{cfg['host']}/v1alpha/{cfg['enginePath']}/assistants/default_assistant:streamAssist"
        assist_resp = await client.post(
            assist_url,
            headers=headers,
            json={
                "query": {"text": query},
                "session": active_session,
                "toolsSpec": {"vertexAiSearchSpec": {}},
            },
        )
        if assist_resp.status_code >= 300:
            raise HTTPException(
                status_code=502, detail={"error": f"gemini_http_{assist_resp.status_code}"}
            )

        chunks = assist_resp.json()
        if not isinstance(chunks, list):
            chunks = [chunks]

        text_parts: List[str] = []
        results = []
        seen = set()

        for chunk in chunks:
            if chunk.get("sessionInfo", {}).get("session"):
                active_session = chunk["sessionInfo"]["session"].strip()
            for reply in chunk.get("answer", {}).get("replies") or []:
                grounded = reply.get("groundedContent") or {}
                content = grounded.get("content") or {}
                if not content.get("thought") and content.get("text"):
                    text_parts.append(content["text"])
                for ref in grounded.get("textGroundingMetadata", {}).get("references") or []:
                    doc_meta = ref.get("documentMetadata") or {}
                    title = (doc_meta.get("title") or ref.get("title") or "Enterprise Source").strip()
                    url = (doc_meta.get("uri") or ref.get("uri") or "").strip()
                    key = f"{title.lower()}\n{url.lower()}"
                    if key not in seen:
                        seen.add(key)
                        results.append(
                            {
                                "index": len(results) + 1,
                                "title": title,
                                "url": url,
                                "snippet": (ref.get("content") or "").strip(),
                            }
                        )

        session_id = extract_session_id(active_session)
        return {
            "session": active_session,
            "sessionId": session_id,
            "deepLinkUrl": build_deep_link_url(cfg["widgetConfigId"], session_id),
            "summary": "".join(text_parts),
            "results": results,
            "citations": [],
            "mode": "streamAssist",
            "userPseudoId": session_id,
            "cloudIdentityEmail": user_email,
        }
