import {
  buildDeepLinkUrl,
  DEFAULT_WIDGET_CONFIG_ID,
  escapeHtml,
  formatGeminiMarkdown,
  formatInlineMarkdown,
  GroundedSource,
  renderSourcesHtml,
  sanitizeUrl
} from "./markdown";
import {
  completeServerGoogleOAuthPopup,
  decodeJwtPayload,
  discoverBrowserIdentity,
  DiscoveredIdentity,
  getGoogleOAuthToken,
  getIdpAccessToken,
  IdentityConfig,
  IdentityStrategy,
  loadGoogleIdentityServices,
  mailboxFromNames,
  msalAccountFromStorage,
  msalTokenFromStorage,
  oktaTokenFromStorage,
  parseNamesFromDisplayName,
  prepareOmnibarSearchPayload,
  readBrowserCookie,
  readCachedGoogleOAuth,
  resolveCloudIdentityEmail,
  resolveGoogleClientId,
  saveCachedGoogleOAuth
} from "./auth-adapters";
import {
  DirectClientConfig,
  DirectRequestFn,
  extractSessionId,
  normalizeSessionResourceName,
  parseJsonChunks,
  readAnswerResponse,
  readStreamAssistResponse,
  resolveDiscoveryHost,
  searchDiscoveryEngineDirect,
  SearchResponsePayload
} from "./direct-client";
import {
  defineGeminiOmnibarElement,
  GEMINI_OMNIBAR_STYLES,
  GeminiOmnibarElement,
  initOmnibar,
  OmnibarControllerState,
  OmnibarTurn,
  OmnibarVariant,
  resolveVariant
} from "./gemini-omnibar";
import { VARIANT_LARGE_CSS, VARIANT_LARGE_METADATA } from "./variants/large";
import { VARIANT_SMALL_CSS, VARIANT_SMALL_METADATA } from "./variants/small";
import { VARIANT_ICON_CSS, VARIANT_ICON_METADATA } from "./variants/icon";
import { CLOUDRUN_IAP_METADATA, parseIapIdentityHeader } from "./auth/cloudrun-iap";
import { SERVICE_ACCOUNT_DWD_METADATA } from "./auth/service-account-dwd";

// Auto-register <gemini-omnibar> in browser environments
if (typeof window !== "undefined") {
  defineGeminiOmnibarElement("gemini-omnibar");
}

export {
  escapeHtml,
  sanitizeUrl,
  buildDeepLinkUrl,
  buildDeepLinkUrl as buildFallbackDeepLink,
  DEFAULT_WIDGET_CONFIG_ID,
  formatInlineMarkdown,
  formatGeminiMarkdown,
  renderSourcesHtml,
  GroundedSource,
  IdentityStrategy,
  IdentityConfig,
  DiscoveredIdentity,
  resolveCloudIdentityEmail,
  parseNamesFromDisplayName,
  mailboxFromNames,
  decodeJwtPayload,
  msalAccountFromStorage,
  msalTokenFromStorage,
  oktaTokenFromStorage,
  readBrowserCookie,
  discoverBrowserIdentity,
  discoverBrowserIdentity as discoverEntraIdentity,
  getIdpAccessToken,
  loadGoogleIdentityServices,
  readCachedGoogleOAuth,
  saveCachedGoogleOAuth,
  resolveGoogleClientId,
  getGoogleOAuthToken,
  completeServerGoogleOAuthPopup,
  prepareOmnibarSearchPayload,
  prepareOmnibarSearchPayload as prepareGeminiSearchPayload,
  DirectClientConfig,
  DirectRequestFn,
  SearchResponsePayload,
  extractSessionId,
  resolveDiscoveryHost,
  normalizeSessionResourceName,
  parseJsonChunks,
  readStreamAssistResponse,
  readAnswerResponse,
  searchDiscoveryEngineDirect,
  GeminiOmnibarElement,
  defineGeminiOmnibarElement,
  initOmnibar,
  GEMINI_OMNIBAR_STYLES,
  OmnibarControllerState,
  OmnibarTurn,
  OmnibarVariant,
  resolveVariant,
  VARIANT_LARGE_CSS,
  VARIANT_LARGE_METADATA,
  VARIANT_SMALL_CSS,
  VARIANT_SMALL_METADATA,
  VARIANT_ICON_CSS,
  VARIANT_ICON_METADATA,
  CLOUDRUN_IAP_METADATA,
  parseIapIdentityHeader,
  SERVICE_ACCOUNT_DWD_METADATA
};

