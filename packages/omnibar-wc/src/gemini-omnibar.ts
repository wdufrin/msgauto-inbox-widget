/**
 * <gemini-omnibar> Self-Contained Shadow DOM Web Component.
 *
 * Renders the Gemini Enterprise Omnibar pill bar + inline expand-down conversation drawer
 * on any customer site (SharePoint, AEM, React, ServiceNow, static HTML) with zero CSS collisions.
 *
 * Supports two deployment topologies:
 *   - Topology A (mode="direct"): 100% browser-only serverless calls to Discovery Engine REST API
 *   - Topology B (mode="proxy", default): Calls lightweight backend proxy (/api/search, /api/config)
 */

import {
  buildDeepLinkUrl,
  DEFAULT_WIDGET_CONFIG_ID,
  escapeHtml,
  formatGeminiMarkdown,
  GroundedSource,
  renderSourcesHtml
} from "./markdown";
import {
  completeServerGoogleOAuthPopup,
  discoverBrowserIdentity,
  IdentityConfig,
  IdentityStrategy,
  loadGoogleIdentityServices,
  prepareOmnibarSearchPayload,
  resolveCloudIdentityEmail
} from "./auth-adapters";
import {
  DirectRequestFn,
  searchDiscoveryEngineDirect
} from "./direct-client";
import { LARGE_VARIANT_CSS } from "./variants/large";
import { SMALL_VARIANT_CSS } from "./variants/small";
import { ICON_VARIANT_CSS } from "./variants/icon";

export type OmnibarVariant = "large" | "small" | "icon";

export function resolveVariant(raw?: string | null): OmnibarVariant {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "small" || v === "icon") {
    return v;
  }
  return "large";
}


export interface OmnibarTurn {
  query: string;
  summary: string;
  results: GroundedSource[];
  deepLinkUrl: string;
}

export interface OmnibarControllerState {
  session: string;
  sessionId: string;
  userEmail: string;
  googleOAuthClientId: string;
  googleOAuthServerEnabled?: boolean;
  googleOAuthAuthenticated?: boolean;
  googleOAuthLoginUrl?: string;
  mode: "streamAssist" | "answer";
  variant: OmnibarVariant;
  widgetConfigId: string;
  includeSessionInDeepLink: boolean;
  deepLinkUrl: string;
  loading: boolean;
  expandedTall: boolean;
  turns: OmnibarTurn[];
}


export const GEMINI_OMNIBAR_STYLES = `
:host {
  display: block;
  width: 100%;
  font-family: var(--ge-font, "Google Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  box-sizing: border-box;
  color-scheme: normal;
}
${LARGE_VARIANT_CSS}
${SMALL_VARIANT_CSS}
${ICON_VARIANT_CSS}


:host *,
:host *::before,
:host *::after {
  box-sizing: border-box;
}

.ge-omnibar-shell {
  --_bg: var(--ge-bg, #ffffff);
  --_border: var(--ge-border, #d9e7f8);
  --_border-open: var(--ge-border-open, #b8d4f8);
  --_shadow: var(--ge-shadow, 0 8px 28px rgba(26, 115, 232, 0.08));
  --_shadow-open: var(--ge-shadow-open, 0 12px 36px rgba(26, 115, 232, 0.14));
  --_text: var(--ge-text, #202124);
  --_text-muted: var(--ge-text-muted, #80868b);
  --_text-secondary: var(--ge-text-secondary, #5f6368);
  --_accent: var(--ge-accent, #1a73e8);
  --_accent-hover: var(--ge-accent-hover, #1557b0);
  --_surface-subtle: var(--ge-surface-subtle, #f8fafd);
  --_surface-hover: var(--ge-surface-hover, #f1f3f4);
  --_divider: var(--ge-divider, #e4edf8);
  --_send-disabled-bg: var(--ge-send-disabled-bg, #e8eaed);
  --_send-disabled-fg: var(--ge-send-disabled-fg, #80868b);
  --_menu-bg: var(--ge-menu-bg, #ffffff);
  --_menu-border: var(--ge-menu-border, #dadce0);
  --_user-bubble-bg: var(--ge-user-bubble-bg, #e8f0fe);
  --_user-bubble-fg: var(--ge-user-bubble-fg, #174ea6);
  --_card-bg: var(--ge-card-bg, #f8fafd);
  --_card-border: var(--ge-card-border, #e3ecf8);
  --_chip-bg: var(--ge-chip-bg, #ffffff);
  --_chip-border: var(--ge-chip-border, #d5e2f2);

  position: relative;
  background: var(--_bg);
  border: 1px solid var(--_border);
  border-radius: var(--ge-radius, 28px);
  box-shadow: var(--_shadow);
  padding: 18px 20px 12px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.ge-omnibar-shell[data-resolved-theme="dark"] {
  --_bg: var(--ge-bg, #1e1f20);
  --_border: var(--ge-border, #3c4043);
  --_border-open: var(--ge-border-open, #5f6368);
  --_shadow: var(--ge-shadow, 0 8px 28px rgba(0, 0, 0, 0.45));
  --_shadow-open: var(--ge-shadow-open, 0 12px 36px rgba(0, 0, 0, 0.55));
  --_text: var(--ge-text, #e8eaed);
  --_text-muted: var(--ge-text-muted, #9aa0a6);
  --_text-secondary: var(--ge-text-secondary, #9aa0a6);
  --_accent: var(--ge-accent, #1a73e8);
  --_accent-hover: var(--ge-accent-hover, #1b66c9);
  --_surface-subtle: var(--ge-surface-subtle, #282a2c);
  --_surface-hover: var(--ge-surface-hover, #282a2c);
  --_divider: var(--ge-divider, #3c4043);
  --_send-disabled-bg: var(--ge-send-disabled-bg, #3c4043);
  --_send-disabled-fg: var(--ge-send-disabled-fg, #9aa0a6);
  --_menu-bg: var(--ge-menu-bg, #282a2c);
  --_menu-border: var(--ge-menu-border, #3c4043);
  --_user-bubble-bg: var(--ge-user-bubble-bg, #394457);
  --_user-bubble-fg: var(--ge-user-bubble-fg, #aecbfa);
  --_card-bg: var(--ge-card-bg, #282a2c);
  --_card-border: var(--ge-card-border, #3c4043);
  --_chip-bg: var(--ge-chip-bg, #1e1f20);
  --_chip-border: var(--ge-chip-border, #3c4043);
}

.ge-omnibar-form {
  margin: 0;
}

.bottom-search-container {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 10px;
  row-gap: 18px;
}

.prefix-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
}

.prefix-icon .gemini-logo,
.prefix-icon svg {
  width: 22px;
  height: 22px;
  display: block;
  object-fit: contain;
}

.input-and-weaveform-container {
  flex: 1 1 0;
  min-width: 0;
}

.input-and-weaveform-container input {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 0.9375rem;
  color: var(--_text);
  outline: none;
}

.input-and-weaveform-container input::placeholder {
  color: var(--_text-muted);
}

.multiline-input-actions-buttons {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 4px;
}

.actions-gap {
  flex: 1 1 auto;
  min-width: 12px;
}

.ge-omnibar-model-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.action-model-selector {
  padding: 6px 8px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--_text);
}

.action-model-selector:hover {
  background: var(--_surface-hover);
}

.action-model-selector:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 1px;
}

.model-selector-label-container {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--_text);
}

.model-selector-label {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
}

.model-selector-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--_text-secondary);
  margin-left: -2px;
}

.ge-omnibar-model-menu__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 300px;
  max-width: min(360px, 92vw);
  padding: 8px 0;
  margin: 0;
  background: var(--_menu-bg);
  border: 1px solid var(--_menu-border);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
}

.ge-omnibar-shell.has-open-drawer .ge-omnibar-model-menu__panel {
  top: auto;
  bottom: calc(100% + 6px);
}

.ge-omnibar-model-menu__panel[hidden] {
  display: none !important;
}

.ge-omnibar-model-menu__option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--_text);
}

.ge-omnibar-model-menu__option:hover,
.ge-omnibar-model-menu__option:focus-visible {
  background: var(--_surface-hover);
  outline: none;
}

.ge-omnibar-model-menu__glyph {
  flex: 0 0 20px;
  margin-top: 2px;
  color: var(--_text-secondary);
}

.ge-omnibar-model-menu__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ge-omnibar-model-menu__name {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--_text);
  line-height: 1.3;
}

.ge-omnibar-model-menu__desc {
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--_text-secondary);
  line-height: 1.35;
}

.ge-omnibar-model-menu__check {
  flex: 0 0 20px;
  margin-top: 2px;
  color: var(--_accent);
  opacity: 0;
}

.ge-omnibar-model-menu__option.is-selected .ge-omnibar-model-menu__check {
  opacity: 1;
}

.send-button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 0;
  background: var(--_send-disabled-bg);
  color: var(--_send-disabled-fg);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.send-button:not(:disabled) {
  background: var(--_accent);
  color: #ffffff;
}

.send-button:disabled {
  cursor: default;
}

/* Expand-Down Inline Conversation Drawer */
.ge-omnibar-shell.has-open-drawer {
  border-color: var(--_border-open);
  box-shadow: var(--_shadow-open);
  display: flex;
  flex-direction: column;
}

.ge-omnibar-shell.has-open-drawer .ge-omnibar-form {
  order: 2;
  flex-shrink: 0;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--_divider);
}

.ge-omnibar-shell.has-open-drawer .ge-omnibar-drawer {
  order: 1;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 260px;
  max-height: min(520px, 58vh);
}

.ge-omnibar-shell.has-open-drawer .ge-omnibar-drawer.ge-omnibar-drawer--tall {
  max-height: min(720px, 72vh);
}

.ge-omnibar-drawer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--_divider);
  animation: geOmnibarSlideDown 0.18s ease-out;
}

.ge-omnibar-drawer[hidden] {
  display: none !important;
}

@keyframes geOmnibarSlideDown {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ge-omnibar-drawer__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 4px 10px;
  border-bottom: 1px solid var(--_divider);
}

.ge-omnibar-drawer__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ge-omnibar-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--_accent);
  flex: 0 0 8px;
}

.ge-omnibar-status-dot.is-loading {
  background: #fbbc04;
  box-shadow: 0 0 0 3px rgba(251, 188, 4, 0.25);
}

.ge-omnibar-status-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--_text);
}

.ge-omnibar-session-pill {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--_accent);
  background: rgba(26, 115, 232, 0.14);
  padding: 2px 8px;
  border-radius: 999px;
}

.ge-omnibar-drawer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ge-omnibar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  text-decoration: none;
}

.ge-omnibar-btn--ghost {
  background: var(--_surface-hover);
  color: var(--_text);
}

.ge-omnibar-btn--ghost:hover {
  filter: brightness(0.95);
}

.ge-omnibar-btn--primary {
  background: var(--_accent);
  color: #ffffff;
}

.ge-omnibar-btn--primary:hover {
  background: var(--_accent-hover);
  color: #ffffff;
}

.ge-omnibar-btn--icon {
  width: 28px;
  height: 28px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  color: var(--_text-secondary);
}

.ge-omnibar-btn--icon:hover {
  background: var(--_surface-hover);
  color: var(--_text);
}

.ge-omnibar-drawer__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}

.ge-omnibar-turn {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ge-omnibar-user-row {
  display: flex;
  justify-content: flex-end;
}

.ge-omnibar-user-bubble {
  max-width: 82%;
  background: var(--_user-bubble-bg);
  color: var(--_user-bubble-fg);
  font-size: 0.9rem;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: 18px 18px 4px 18px;
  line-height: 1.45;
}

.ge-omnibar-assistant-row {
  display: flex;
  justify-content: flex-start;
}

.ge-omnibar-loading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--_surface-subtle);
  border: 1px solid var(--_card-border);
  color: var(--_text-secondary);
  font-size: 0.875rem;
}

.ge-omnibar-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(138, 180, 248, 0.35);
  border-top-color: var(--_accent);
  border-radius: 50%;
  animation: geOmnibarSpin 0.8s linear infinite;
}

@keyframes geOmnibarSpin {
  to {
    transform: rotate(360deg);
  }
}

.ge-omnibar-answer-card {
  width: 100%;
  background: var(--_card-bg);
  border: 1px solid var(--_card-border);
  border-radius: 16px;
  padding: 16px 18px 12px;
}

.ge-omnibar-markdown {
  font-size: 0.925rem;
  line-height: 1.6;
  color: var(--_text);
}

.ge-omnibar-heading {
  margin: 12px 0 6px;
  font-weight: 700;
  color: var(--_text);
  line-height: 1.35;
}

.ge-omnibar-heading:first-child {
  margin-top: 0;
}

h2.ge-omnibar-heading { font-size: 1.1rem; }
h3.ge-omnibar-heading { font-size: 1.0rem; }
h4.ge-omnibar-heading { font-size: 0.9375rem; }

.ge-omnibar-para {
  margin: 0 0 10px;
}

.ge-omnibar-para:last-child {
  margin-bottom: 0;
}

.ge-omnibar-list {
  margin: 0 0 10px;
  padding-left: 1.35rem;
}

.ge-omnibar-list li {
  margin-bottom: 4px;
}

.ge-omnibar-quote {
  margin: 8px 0 10px;
  padding: 6px 12px;
  border-left: 3px solid var(--_accent);
  background: rgba(26, 115, 232, 0.08);
  border-radius: 0 8px 8px 0;
  color: var(--_text);
}

.ge-omnibar-inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
  background: rgba(148, 163, 184, 0.2);
  color: var(--_text);
  padding: 2px 5px;
  border-radius: 4px;
}

.ge-omnibar-code-wrap {
  margin: 8px 0 12px;
  border-radius: 10px;
  overflow: hidden;
  background: #0f172a;
  color: #f8fafc;
}

.ge-omnibar-code-lang {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 12px;
  background: #1e293b;
  color: #94a3b8;
}

.ge-omnibar-pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  font-size: 0.82rem;
  line-height: 1.5;
}

.ge-omnibar-table-wrap {
  overflow-x: auto;
  margin: 8px 0 12px;
}

.ge-omnibar-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  background: var(--_chip-bg);
  border-radius: 8px;
  overflow: hidden;
}

.ge-omnibar-table th,
.ge-omnibar-table td {
  border: 1px solid var(--_card-border);
  padding: 6px 10px;
  text-align: left;
  color: var(--_text);
}

.ge-omnibar-table th {
  background: rgba(26, 115, 232, 0.12);
  font-weight: 600;
}

.ge-omnibar-link {
  color: #4285f4;
  text-decoration: underline;
}

.ge-omnibar-cite-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #1a73e8;
  background: #e8f0fe;
  border-radius: 999px;
  vertical-align: baseline;
  text-decoration: none;
}

.ge-omnibar-cite-badge:hover {
  background: #1a73e8;
  color: #ffffff;
}

.ge-omnibar-sources {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--_card-border);
}

.ge-omnibar-sources-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--_text-secondary);
  margin-bottom: 6px;
}

.ge-omnibar-sources-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ge-omnibar-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--_chip-bg);
  border: 1px solid var(--_chip-border);
  font-size: 0.78rem;
  color: var(--_text);
  text-decoration: none;
}

a.ge-omnibar-source-chip:hover {
  border-color: var(--_accent);
  color: #4285f4;
}

.ge-omnibar-source-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e8f0fe;
  color: #1a73e8;
  font-size: 0.68rem;
  font-weight: 700;
  flex: 0 0 16px;
}

.ge-omnibar-source-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ge-omnibar-answer-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--_divider);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ge-omnibar-footer-hint {
  font-size: 0.76rem;
  color: var(--_text-secondary);
}

.ge-omnibar-deep-link {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #4285f4;
  text-decoration: none;
}

.ge-omnibar-deep-link:hover {
  text-decoration: underline;
}

.ge-omnibar-error-card {
  width: 100%;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 14px;
  padding: 14px 16px;
}

.ge-omnibar-error-title {
  margin: 0 0 4px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ef4444;
}

.ge-omnibar-error-sub {
  margin: 0 0 10px;
  font-size: 0.8125rem;
  color: var(--_text-secondary);
}
`;

const GEMINI_SPARKLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">
  <defs>
    <linearGradient id="ge-sparkle-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4285f4" />
      <stop offset="50%" stop-color="#9b72cb" />
      <stop offset="100%" stop-color="#d96570" />
    </linearGradient>
  </defs>
  <path fill="url(#ge-sparkle-grad)" d="M14 2C14 8.627 8.627 14 2 14c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z"/>
</svg>
`;

export class GeminiOmnibarElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [
      "variant",
      "api-url",
      "mode",
      "default-mode",
      "placeholder",
      "theme",
      "google-client-id",
      "project-id",
      "location",
      "engine-id",
      "widget-config-id",
      "logo-url",
      "identity-strategy",
      "identity-domain",
      "identity-source-domain",
      "identity-template"
    ];
  }

  public state: OmnibarControllerState;
  public directRequestFn?: DirectRequestFn;
  private shadow: ShadowRoot;
  private shellEl!: HTMLElement;
  private formEl!: HTMLFormElement;
  private inputEl!: HTMLInputElement;
  private sendBtn!: HTMLButtonElement;
  private drawerEl!: HTMLElement;
  private threadEl!: HTMLElement;
  private openAppLink!: HTMLAnchorElement;
  private sessionPill!: HTMLElement;
  private statusText!: HTMLElement;
  private statusDot!: HTMLElement;
  private modelLabelEl!: HTMLElement;
  private modelPanelEl!: HTMLElement;
  private modelAnchorBtn!: HTMLButtonElement;
  private prefixIconEl!: HTMLElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.state = {
      session: "",
      sessionId: "",
      userEmail: "",
      googleOAuthClientId: "",
      googleOAuthServerEnabled: false,
      googleOAuthAuthenticated: false,
      googleOAuthLoginUrl: "/api/auth/google/login?mode=popup",
      mode: "streamAssist",
      variant: "large",
      widgetConfigId: DEFAULT_WIDGET_CONFIG_ID,
      includeSessionInDeepLink: true,
      deepLinkUrl: buildDeepLinkUrl(DEFAULT_WIDGET_CONFIG_ID, "", true),
      loading: false,
      expandedTall: false,
      turns: []
    };
    this.renderShadowDom();
  }

  connectedCallback(): void {
    this.syncAttributesToState();
    this.fetchBackendConfigIfNeeded();
  }

  attributeChangedCallback(): void {
    if (this.shellEl) {
      this.syncAttributesToState();
    }
  }

  private getIdentityConfig(): IdentityConfig {
    const rawStrategy = (this.getAttribute("identity-strategy") || "passthrough")
      .trim()
      .toLowerCase() as IdentityStrategy;
    return {
      strategy:
        rawStrategy === "domain_rewrite" || rawStrategy === "claim_template"
          ? rawStrategy
          : "passthrough",
      targetDomain: this.getAttribute("identity-domain") || "",
      sourceDomain: this.getAttribute("identity-source-domain") || "",
      claimTemplate: this.getAttribute("identity-template") || ""
    };
  }

  private resolveVariant(): OmnibarVariant {
    return resolveVariant(this.getAttribute("variant"));
  }

  private resolveTheme(): "dark" | "light" {
    const attr = (this.getAttribute("theme") || "dark").trim().toLowerCase();
    if (attr === "light") {
      return "light";
    }
    if (attr === "dark") {
      return "dark";
    }
    if (typeof document !== "undefined") {
      const docTheme =
        document.documentElement.getAttribute("data-theme") ||
        (document.body && document.body.getAttribute("data-theme"));
      if (docTheme === "dark" || docTheme === "light") {
        return docTheme;
      }
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }

  private isDirectMode(): boolean {
    const modeAttr = (this.getAttribute("mode") || "").trim().toLowerCase();
    return modeAttr === "direct" || modeAttr === "serverless";
  }

  private resolveApiBaseUrl(): string {
    return String(this.getAttribute("api-url") || "")
      .trim()
      .replace(/\/+$/, "");
  }

  private syncAttributesToState(): void {
    const resolvedVariant = this.resolveVariant();
    this.state.variant = resolvedVariant;
    this.setAttribute("data-variant", resolvedVariant);
    this.shellEl.setAttribute("data-variant", resolvedVariant);

    const resolvedTheme = this.resolveTheme();
    this.shellEl.setAttribute("data-resolved-theme", resolvedTheme);

    const placeholder =
      this.getAttribute("placeholder") ||
      (resolvedVariant === "large" ? "Ask Gemini Enterprise" : "Ask Gemini…");
    if (this.state.turns.length === 0) {
      this.inputEl.placeholder = placeholder;
    }

    const defaultMode = this.getAttribute("default-mode");
    if (defaultMode === "answer" || defaultMode === "streamAssist") {
      this.applyMode(defaultMode);
    }

    const clientId = this.getAttribute("google-client-id");
    if (clientId) {
      this.state.googleOAuthClientId = clientId.trim();
    }

    const widgetConfigId = this.getAttribute("widget-config-id");
    if (widgetConfigId && widgetConfigId.trim()) {
      this.state.widgetConfigId = widgetConfigId.trim();
      if (!this.state.sessionId) {
        this.state.deepLinkUrl = buildDeepLinkUrl(
          this.state.widgetConfigId,
          "",
          this.state.includeSessionInDeepLink
        );
      }
    }

    const logoUrl = this.getAttribute("logo-url");
    if (logoUrl && /^https?:\/\/|^\//i.test(logoUrl.trim())) {
      this.prefixIconEl.innerHTML = `<img src="${escapeHtml(logoUrl.trim())}" alt="" class="gemini-logo">`;
    } else {
      this.prefixIconEl.innerHTML = GEMINI_SPARKLE_SVG;
    }

    this.updateHeaderState();
    this.syncSubmitButton();
  }

  private fetchBackendConfigIfNeeded(): void {
    if (this.isDirectMode() || typeof fetch !== "function") {
      return;
    }
    const base = this.resolveApiBaseUrl();
    const configUrl = `${base}/api/config`;
    fetch(configUrl, {
      headers: { Accept: "application/json" },
      credentials: "include"
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cfg || typeof cfg !== "object") {
          return;
        }
        if (typeof cfg.userEmail === "string" && cfg.userEmail.trim()) {
          this.state.userEmail = cfg.userEmail.trim();
        }
        if (typeof cfg.googleOAuthServerEnabled === "boolean") {
          this.state.googleOAuthServerEnabled = cfg.googleOAuthServerEnabled;
        }
        if (typeof cfg.googleOAuthAuthenticated === "boolean") {
          this.state.googleOAuthAuthenticated = cfg.googleOAuthAuthenticated;
        }
        if (typeof cfg.googleOAuthLoginUrl === "string" && cfg.googleOAuthLoginUrl.trim()) {
          this.state.googleOAuthLoginUrl = cfg.googleOAuthLoginUrl.trim();
        }
        if (typeof cfg.googleOAuthClientId === "string" && cfg.googleOAuthClientId.trim()) {
          this.state.googleOAuthClientId = cfg.googleOAuthClientId.trim();
          if (!this.state.googleOAuthServerEnabled) {
            loadGoogleIdentityServices();
          }
        }
        if (cfg.widgetConfigId) {
          this.state.widgetConfigId = String(cfg.widgetConfigId).trim();
          if (typeof cfg.includeSessionInDeepLink === "boolean") {
            this.state.includeSessionInDeepLink = cfg.includeSessionInDeepLink;
          }
          if (!this.state.sessionId) {
            this.state.deepLinkUrl =
              cfg.webAppBaseUrl ||
              buildDeepLinkUrl(
                this.state.widgetConfigId,
                "",
                this.state.includeSessionInDeepLink
              );
            this.updateHeaderState();
          }
        }
      })
      .catch(() => {
        // Keep attribute/default config when backend config endpoint is unreachable
      });
  }

  private renderShadowDom(): void {
    this.shadow.innerHTML = `
      <style>${GEMINI_OMNIBAR_STYLES}</style>
      <div class="ge-omnibar-shell omnibar" data-variant="large" data-resolved-theme="dark">
        <div class="ge-omnibar-drawer" id="ge-omnibar-drawer" hidden>
          <div class="ge-omnibar-drawer__header">
            <div class="ge-omnibar-drawer__meta">
              <span class="ge-omnibar-status-dot" id="ge-status-dot"></span>
              <span class="ge-omnibar-status-text" id="ge-status-text">Gemini Enterprise Assistant</span>
              <span class="ge-omnibar-session-pill" id="ge-session-pill" hidden></span>
            </div>
            <div class="ge-omnibar-drawer__actions">
              <button type="button" class="ge-omnibar-btn ge-omnibar-btn--ghost" id="ge-new-btn" title="Start a new conversation session">New Topic</button>
              <button type="button" class="ge-omnibar-btn ge-omnibar-btn--ghost" id="ge-size-btn" title="Toggle drawer height">Expand ↕</button>
              <a class="ge-omnibar-btn ge-omnibar-btn--primary" id="ge-open-app" href="${escapeHtml(this.state.deepLinkUrl)}" target="_blank" rel="noopener noreferrer">
                <span>Open in Gemini Enterprise App</span>
                <span aria-hidden="true">↗</span>
              </a>
              <button type="button" class="ge-omnibar-btn ge-omnibar-btn--icon" id="ge-close-btn" aria-label="Minimize chat drawer" title="Minimize">✕</button>
            </div>
          </div>
          <div class="ge-omnibar-drawer__body" id="ge-thread" role="log" aria-live="polite"></div>
        </div>

        <form class="ge-omnibar-form omnibar" role="search">
          <div class="form-elements multiline-input">
            <div class="bottom-search-container">
              <div class="prefix-icon" aria-hidden="true">${GEMINI_SPARKLE_SVG}</div>
              <div class="input-and-weaveform-container">
                <input id="agent-search" class="ge-omnibar-input" type="text" aria-label="Search" placeholder="Ask Gemini Enterprise" autocomplete="off">
              </div>
              <div class="actions-buttons multiline-input-actions-buttons">
                <div class="actions-gap"></div>
                <div class="ge-omnibar-model-menu" data-ge-model-menu>
                  <button type="button" class="action-model-selector" id="model-selector-menu-anchor" aria-label="Choose model" aria-haspopup="listbox" aria-expanded="false">
                    <div class="model-selector-label-container">
                      <div class="model-selector-label">Auto</div>
                      <span class="model-selector-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                      </span>
                    </div>
                  </button>
                  <div class="ge-omnibar-model-menu__panel" role="listbox" aria-label="Search mode" hidden>
                    <button type="button" class="ge-omnibar-model-menu__option is-selected" role="option" data-mode="streamAssist" aria-selected="true">
                      <span class="ge-omnibar-model-menu__glyph" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/></svg>
                      </span>
                      <span class="ge-omnibar-model-menu__copy">
                        <span class="ge-omnibar-model-menu__name">Auto</span>
                        <span class="ge-omnibar-model-menu__desc">Multi-turn StreamAssist chat</span>
                      </span>
                      <span class="ge-omnibar-model-menu__check" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      </span>
                    </button>
                    <button type="button" class="ge-omnibar-model-menu__option" role="option" data-mode="answer" aria-selected="false">
                      <span class="ge-omnibar-model-menu__glyph" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.48 2.54l2.6 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z"/></svg>
                      </span>
                      <span class="ge-omnibar-model-menu__copy">
                        <span class="ge-omnibar-model-menu__name">Quick</span>
                        <span class="ge-omnibar-model-menu__desc">Single-shot enterprise answer</span>
                      </span>
                      <span class="ge-omnibar-model-menu__check" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      </span>
                    </button>
                  </div>
                </div>
                <button type="submit" class="send-button submit" aria-label="Submit" disabled>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 19V6.8l-5.6 5.6L4 11l8-8 8 8-1.4 1.4L13 6.8V19z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    `;

    this.shellEl = this.shadow.querySelector(".ge-omnibar-shell") as HTMLElement;
    this.formEl = this.shadow.querySelector(".ge-omnibar-form") as HTMLFormElement;
    this.inputEl = this.shadow.querySelector("#agent-search") as HTMLInputElement;
    this.sendBtn = this.shadow.querySelector(".send-button") as HTMLButtonElement;
    this.drawerEl = this.shadow.querySelector("#ge-omnibar-drawer") as HTMLElement;
    this.threadEl = this.shadow.querySelector("#ge-thread") as HTMLElement;
    this.openAppLink = this.shadow.querySelector("#ge-open-app") as HTMLAnchorElement;
    this.sessionPill = this.shadow.querySelector("#ge-session-pill") as HTMLElement;
    this.statusText = this.shadow.querySelector("#ge-status-text") as HTMLElement;
    this.statusDot = this.shadow.querySelector("#ge-status-dot") as HTMLElement;
    this.modelLabelEl = this.shadow.querySelector(".model-selector-label") as HTMLElement;
    this.modelPanelEl = this.shadow.querySelector(".ge-omnibar-model-menu__panel") as HTMLElement;
    this.modelAnchorBtn = this.shadow.querySelector("#model-selector-menu-anchor") as HTMLButtonElement;
    this.prefixIconEl = this.shadow.querySelector(".prefix-icon") as HTMLElement;

    const newBtn = this.shadow.querySelector("#ge-new-btn") as HTMLButtonElement;
    const sizeBtn = this.shadow.querySelector("#ge-size-btn") as HTMLButtonElement;
    const closeBtn = this.shadow.querySelector("#ge-close-btn") as HTMLButtonElement;

    this.prefixIconEl.addEventListener("click", () => {
      if (this.state.variant === "icon") {
        this.shellEl.classList.add("is-icon-expanded");
        this.inputEl.focus();
      }
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.state.variant === "icon" && !this.inputEl.value.trim()) {
        this.shellEl.classList.remove("is-icon-expanded");
        this.closeDrawer();
      }
    });

    this.modelAnchorBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = this.modelPanelEl.hidden;
      this.modelPanelEl.hidden = !willOpen;
      this.modelAnchorBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    const optionBtns = this.modelPanelEl.querySelectorAll(".ge-omnibar-model-menu__option[data-mode]");
    optionBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const mode = btn.getAttribute("data-mode") === "answer" ? "answer" : "streamAssist";
        this.applyMode(mode);
        this.modelPanelEl.hidden = true;
        this.modelAnchorBtn.setAttribute("aria-expanded", "false");
      });
    });

    newBtn.addEventListener("click", () => this.resetSession());
    sizeBtn.addEventListener("click", () => {
      this.state.expandedTall = !this.state.expandedTall;
      this.drawerEl.classList.toggle("ge-omnibar-drawer--tall", this.state.expandedTall);
      sizeBtn.textContent = this.state.expandedTall ? "Compact ↕" : "Expand ↕";
    });
    closeBtn.addEventListener("click", () => this.closeDrawer());

    this.inputEl.addEventListener("input", () => this.syncSubmitButton());
    this.inputEl.addEventListener("focus", () => {
      if (this.state.turns.length > 0 && this.drawerEl.hidden) {
        this.openDrawer();
      }
    });

    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitQuery(this.inputEl.value);
    });
  }

  public applyMode(mode: "streamAssist" | "answer"): void {
    this.state.mode = mode === "answer" ? "answer" : "streamAssist";
    const optionBtns = this.modelPanelEl.querySelectorAll(".ge-omnibar-model-menu__option[data-mode]");
    optionBtns.forEach((opt) => {
      const selected = opt.getAttribute("data-mode") === this.state.mode;
      opt.classList.toggle("is-selected", selected);
      opt.setAttribute("aria-selected", selected ? "true" : "false");
    });
    this.modelLabelEl.textContent = this.state.mode === "answer" ? "Quick" : "Auto";
  }

  public openDrawer(): void {
    this.drawerEl.hidden = false;
    this.shellEl.classList.add("has-open-drawer");
  }

  public closeDrawer(): void {
    this.drawerEl.hidden = true;
    this.shellEl.classList.remove("has-open-drawer");
  }

  public resetSession(): void {
    this.state.session = "";
    this.state.sessionId = "";
    this.state.turns = [];
    this.state.deepLinkUrl = buildDeepLinkUrl(
      this.state.widgetConfigId,
      "",
      this.state.includeSessionInDeepLink
    );
    this.threadEl.innerHTML = "";
    this.inputEl.placeholder =
      this.getAttribute("placeholder") ||
      (this.state.variant === "large" ? "Ask Gemini Enterprise" : "Ask Gemini…");
    this.updateHeaderState();
    this.closeDrawer();
    this.inputEl.focus();
    this.dispatchEvent(new CustomEvent("ge-session-reset", { bubbles: true, composed: true }));
  }

  private syncSubmitButton(): void {
    this.sendBtn.disabled = this.state.loading || !this.inputEl.value.trim();
  }

  private updateHeaderState(): void {
    this.openAppLink.href = this.state.deepLinkUrl;
    if (this.state.sessionId) {
      this.sessionPill.hidden = false;
      this.sessionPill.textContent = "Session #" + this.state.sessionId.slice(-8);
      this.sessionPill.title = this.state.session;
    } else {
      this.sessionPill.hidden = true;
      this.sessionPill.textContent = "";
    }
    this.statusDot.classList.toggle("is-loading", this.state.loading);
    if (this.state.loading) {
      this.statusText.textContent =
        this.state.mode === "answer"
          ? "Synthesizing quick answer…"
          : "Streaming Gemini Enterprise response…";
    } else if (this.state.sessionId) {
      statusTextSet(this.statusText, "Session synced with Gemini Enterprise");
    } else {
      statusTextSet(this.statusText, "Gemini Enterprise Assistant");
    }
  }

  public async submitQuery(rawQuery: string): Promise<void> {
    const query = String(rawQuery || "").trim();
    if (!query || this.state.loading) {
      return;
    }

    this.inputEl.value = "";
    this.state.loading = true;
    this.syncSubmitButton();
    this.openDrawer();
    this.updateHeaderState();
    this.inputEl.focus();

    this.dispatchEvent(
      new CustomEvent("ge-search-start", {
        bubbles: true,
        composed: true,
        detail: { query, mode: this.state.mode, session: this.state.session }
      })
    );

    const turnEl = document.createElement("div");
    turnEl.className = "ge-omnibar-turn";
    turnEl.innerHTML =
      '<div class="ge-omnibar-user-row">' +
        '<div class="ge-omnibar-user-bubble">' +
          escapeHtml(query) +
        "</div>" +
      "</div>" +
      '<div class="ge-omnibar-assistant-row">' +
        '<div class="ge-omnibar-loading">' +
          '<span class="ge-omnibar-spinner"></span>' +
          "<span>Searching enterprise knowledge &amp; generating answer…</span>" +
        "</div>" +
      "</div>";
    this.threadEl.appendChild(turnEl);
    this.threadEl.scrollTop = this.threadEl.scrollHeight;

    const assistantRow = turnEl.querySelector(".ge-omnibar-assistant-row") as HTMLElement;

    try {
      let data: any;
      if (this.isDirectMode()) {
        const identity = discoverBrowserIdentity(this.state.userEmail);
        const resolvedEmail = identity
          ? resolveCloudIdentityEmail(
              identity.email,
              identity.givenName,
              identity.familyName,
              identity.displayName,
              this.getIdentityConfig()
            )
          : this.state.userEmail;
        data = await searchDiscoveryEngineDirect({
          query,
          session: this.state.session,
          mode: this.state.mode,
          userEmail: resolvedEmail,
          config: {
            projectId: this.getAttribute("project-id") || "",
            location: this.getAttribute("location") || "global",
            engineId: this.getAttribute("engine-id") || "",
            widgetConfigId: this.state.widgetConfigId,
            googleClientId: this.state.googleOAuthClientId
          },
          requestFn: this.directRequestFn
        });
      } else {
        const prepared = await prepareOmnibarSearchPayload(
          query,
          this.state.session || "",
          this.state.mode,
          this.state.userEmail,
          this.state.googleOAuthClientId,
          this.getIdentityConfig(),
          Boolean(this.state.googleOAuthServerEnabled)
        );
        const attrProjectId = (this.getAttribute("project-id") || "").trim();
        const attrLocation = (this.getAttribute("location") || "").trim();
        const attrEngineId = (this.getAttribute("engine-id") || "").trim();
        const attrWidgetCid = (this.getAttribute("widget-config-id") || "").trim();
        const requestBody: Record<string, unknown> = {
          ...prepared.body,
          ...(attrProjectId ? { projectId: attrProjectId } : {}),
          ...(attrLocation ? { location: attrLocation } : {}),
          ...(attrEngineId ? { engineId: attrEngineId } : {}),
          ...(attrWidgetCid ? { widgetConfigId: attrWidgetCid } : {})
        };
        const headers = { ...prepared.headers, "Content-Type": "application/json" };
        const base = this.resolveApiBaseUrl();
        let resp = await fetch(`${base}/api/search`, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(requestBody)
        });
        let body = await resp.json();
        if (resp.status === 401 && body && body.error === "google_oauth_required") {
          const authed = await completeServerGoogleOAuthPopup(
            body.authUrl || this.state.googleOAuthLoginUrl,
            body.loginHint || this.state.userEmail || (requestBody.userEmail as string) || "",
            base
          );
          if (authed) {
            this.state.googleOAuthAuthenticated = true;
            resp = await fetch(`${base}/api/search`, {
              method: "POST",
              headers,
              credentials: "include",
              body: JSON.stringify(requestBody)
            });
            body = await resp.json();
          }
        }
        if (!resp.ok) {
          throw new Error((body && body.error) || "HTTP " + resp.status);
        }
        data = body;
      }

      this.state.loading = false;
      if (data.session) {
        this.state.session = data.session;
      }
      if (data.sessionId) {
        this.state.sessionId = data.sessionId;
      }
      if (data.deepLinkUrl) {
        this.state.deepLinkUrl = data.deepLinkUrl;
      } else if (this.state.sessionId) {
        this.state.deepLinkUrl = buildDeepLinkUrl(
          this.state.widgetConfigId,
          this.state.sessionId,
          this.state.includeSessionInDeepLink
        );
      }

      this.state.turns.push({
        query,
        summary: data.summary || "",
        results: data.results || [],
        deepLinkUrl: this.state.deepLinkUrl
      });

      this.inputEl.placeholder = "Ask a follow-up question in this session…";
      this.updateHeaderState();
      this.syncSubmitButton();

      const formattedAnswer = formatGeminiMarkdown(data.summary || "", data.results || []);
      const sourcesHtml = renderSourcesHtml(data.results || []);

      assistantRow.innerHTML =
        '<div class="ge-omnibar-answer-card">' +
          '<div class="ge-omnibar-markdown">' +
            formattedAnswer +
          "</div>" +
          sourcesHtml +
          '<div class="ge-omnibar-answer-footer">' +
            '<span class="ge-omnibar-footer-hint">Session saved to your Gemini Enterprise history</span>' +
            '<a class="ge-omnibar-deep-link" href="' +
              escapeHtml(this.state.deepLinkUrl) +
              '" target="_blank" rel="noopener noreferrer">' +
              "Open in Gemini Enterprise App ↗" +
            "</a>" +
          "</div>" +
        "</div>";

      this.threadEl.scrollTop = this.threadEl.scrollHeight;
      this.inputEl.focus();

      this.dispatchEvent(
        new CustomEvent("ge-search-success", {
          bubbles: true,
          composed: true,
          detail: {
            query,
            mode: this.state.mode,
            session: this.state.session,
            sessionId: this.state.sessionId,
            deepLinkUrl: this.state.deepLinkUrl,
            summary: data.summary || "",
            results: data.results || []
          }
        })
      );
    } catch (err: any) {
      this.state.loading = false;
      this.updateHeaderState();
      this.syncSubmitButton();
      const errMsg = err && err.message ? err.message : "unknown_error";
      const fallbackUrl =
        buildDeepLinkUrl(
          this.state.widgetConfigId,
          this.state.sessionId,
          this.state.includeSessionInDeepLink
        ) + (this.state.sessionId ? "" : "?q=" + encodeURIComponent(query));

      assistantRow.innerHTML =
        '<div class="ge-omnibar-error-card">' +
          '<p class="ge-omnibar-error-title">Could not complete inline search (' +
            escapeHtml(errMsg) +
          ")</p>" +
          '<p class="ge-omnibar-error-sub">You can still run this query directly in the Gemini Enterprise web app:</p>' +
          '<a class="ge-omnibar-btn ge-omnibar-btn--primary" href="' +
            escapeHtml(fallbackUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            "Open in Gemini Enterprise App ↗" +
          "</a>" +
        "</div>";
      this.threadEl.scrollTop = this.threadEl.scrollHeight;
      this.inputEl.focus();

      this.dispatchEvent(
        new CustomEvent("ge-search-error", {
          bubbles: true,
          composed: true,
          detail: { query, mode: this.state.mode, error: errMsg }
        })
      );
    }
  }
}

function statusTextSet(el: HTMLElement | null, text: string): void {
  if (el) {
    el.textContent = text;
  }
}

export function defineGeminiOmnibarElement(tagName: string = "gemini-omnibar"): void {
  if (typeof window !== "undefined" && window.customElements && !window.customElements.get(tagName)) {
    window.customElements.define(tagName, GeminiOmnibarElement);
  }
}

/**
 * Light-DOM initializer for existing pages using `<div class="omnibar"><form class="omnibar">`.
 */
export function initOmnibar(
  doc?: Document,
  identityConfig?: IdentityConfig
): {
  state: OmnibarControllerState;
  resetSession: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
} | null {
  const documentRef = doc || (typeof document !== "undefined" ? document : null);
  if (!documentRef) {
    return null;
  }

  const form = documentRef.querySelector("form.omnibar") as HTMLFormElement | null;
  const input = documentRef.getElementById("agent-search") as HTMLInputElement | null;
  const send = form && (form.querySelector(".send-button") as HTMLButtonElement | null);
  const omnibarContainer = form && (form.closest("div.omnibar") as HTMLElement | null);
  if (!form || !input || !send || !omnibarContainer) {
    return null;
  }

  const modelMenuRoot = form.querySelector("[data-ge-model-menu]");

  const state: OmnibarControllerState = {
    session: "",
    sessionId: "",
    userEmail: "",
    googleOAuthClientId: "",
    googleOAuthServerEnabled: false,
    googleOAuthAuthenticated: false,
    googleOAuthLoginUrl: "/api/auth/google/login?mode=popup",
    mode: "streamAssist",
    variant: "large",
    widgetConfigId: DEFAULT_WIDGET_CONFIG_ID,
    includeSessionInDeepLink: true,
    deepLinkUrl: buildDeepLinkUrl(DEFAULT_WIDGET_CONFIG_ID, "", true),
    loading: false,
    expandedTall: false,
    turns: []
  };

  let drawer = documentRef.getElementById("ge-omnibar-drawer");
  if (!drawer) {
    drawer = documentRef.createElement("div");
    drawer.id = "ge-omnibar-drawer";
    drawer.className = "ge-omnibar-drawer";
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="ge-omnibar-drawer__header">' +
        '<div class="ge-omnibar-drawer__meta">' +
          '<span class="ge-omnibar-status-dot" id="ge-status-dot"></span>' +
          '<span class="ge-omnibar-status-text" id="ge-status-text">Gemini Enterprise Assistant</span>' +
          '<span class="ge-omnibar-session-pill" id="ge-session-pill" hidden></span>' +
        "</div>" +
        '<div class="ge-omnibar-drawer__actions">' +
          '<button type="button" class="ge-omnibar-btn ge-omnibar-btn--ghost" id="ge-new-btn" title="Start a new conversation session">New Topic</button>' +
          '<button type="button" class="ge-omnibar-btn ge-omnibar-btn--ghost" id="ge-size-btn" title="Toggle drawer height">Expand ↕</button>' +
          '<a class="ge-omnibar-btn ge-omnibar-btn--primary" id="ge-open-app" href="' +
            escapeHtml(state.deepLinkUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            "<span>Open in Gemini Enterprise App</span>" +
            '<span aria-hidden="true">↗</span>' +
          "</a>" +
          '<button type="button" class="ge-omnibar-btn ge-omnibar-btn--icon" id="ge-close-btn" aria-label="Minimize chat drawer" title="Minimize">✕</button>' +
        "</div>" +
      "</div>" +
      '<div class="ge-omnibar-drawer__body" id="ge-thread" role="log" aria-live="polite"></div>';
    omnibarContainer.appendChild(drawer);
  }

  const threadEl = drawer.querySelector("#ge-thread") as HTMLElement;
  const openAppLink = drawer.querySelector("#ge-open-app") as HTMLAnchorElement;
  const sessionPill = drawer.querySelector("#ge-session-pill") as HTMLElement;
  const statusText = drawer.querySelector("#ge-status-text") as HTMLElement;
  const statusDot = drawer.querySelector("#ge-status-dot") as HTMLElement;
  const newBtn = drawer.querySelector("#ge-new-btn") as HTMLButtonElement;
  const sizeBtn = drawer.querySelector("#ge-size-btn") as HTMLButtonElement;
  const closeBtn = drawer.querySelector("#ge-close-btn") as HTMLButtonElement;

  if (typeof fetch === "function") {
    fetch("/api/config", {
      headers: { Accept: "application/json" },
      credentials: "include"
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && typeof cfg.userEmail === "string" && cfg.userEmail.trim()) {
          state.userEmail = cfg.userEmail.trim();
        }
        if (cfg && typeof cfg.googleOAuthServerEnabled === "boolean") {
          state.googleOAuthServerEnabled = cfg.googleOAuthServerEnabled;
        }
        if (cfg && typeof cfg.googleOAuthAuthenticated === "boolean") {
          state.googleOAuthAuthenticated = cfg.googleOAuthAuthenticated;
        }
        if (cfg && typeof cfg.googleOAuthLoginUrl === "string" && cfg.googleOAuthLoginUrl.trim()) {
          state.googleOAuthLoginUrl = cfg.googleOAuthLoginUrl.trim();
        }
        if (cfg && typeof cfg.googleOAuthClientId === "string" && cfg.googleOAuthClientId.trim()) {
          state.googleOAuthClientId = cfg.googleOAuthClientId.trim();
          if (!state.googleOAuthServerEnabled) {
            loadGoogleIdentityServices();
          }
        }
        if (cfg && cfg.widgetConfigId) {
          state.widgetConfigId = cfg.widgetConfigId;
          if (typeof cfg.includeSessionInDeepLink === "boolean") {
            state.includeSessionInDeepLink = cfg.includeSessionInDeepLink;
          }
          if (!state.sessionId) {
            state.deepLinkUrl =
              cfg.webAppBaseUrl ||
              buildDeepLinkUrl(cfg.widgetConfigId, "", state.includeSessionInDeepLink);
            if (openAppLink) {
              openAppLink.href = state.deepLinkUrl;
            }
          }
        }
      })
      .catch(() => {
        // Keep default fallback config when offline
      });
  }

  function syncSubmitButton(): void {
    send!.disabled = state.loading || !input!.value.trim();
  }

  function updateHeaderState(): void {
    if (openAppLink) {
      openAppLink.href = state.deepLinkUrl;
    }
    if (sessionPill) {
      if (state.sessionId) {
        sessionPill.hidden = false;
        sessionPill.textContent = "Session #" + state.sessionId.slice(-8);
        sessionPill.title = state.session;
      } else {
        sessionPill.hidden = true;
        sessionPill.textContent = "";
      }
    }
    if (statusDot) {
      statusDot.classList.toggle("is-loading", state.loading);
    }
    if (statusText) {
      if (state.loading) {
        statusText.textContent =
          state.mode === "answer"
            ? "Synthesizing quick answer…"
            : "Streaming Gemini Enterprise response…";
      } else if (state.sessionId) {
        statusText.textContent = "Session synced with Gemini Enterprise";
      } else {
        statusText.textContent = "Gemini Enterprise Assistant";
      }
    }
  }

  function openDrawer(): void {
    drawer!.hidden = false;
    omnibarContainer!.classList.add("has-open-drawer");
  }

  function closeDrawer(): void {
    drawer!.hidden = true;
    omnibarContainer!.classList.remove("has-open-drawer");
  }

  function resetSession(): void {
    state.session = "";
    state.sessionId = "";
    state.turns = [];
    state.deepLinkUrl = buildDeepLinkUrl(state.widgetConfigId, "", state.includeSessionInDeepLink);
    if (threadEl) {
      threadEl.innerHTML = "";
    }
    input!.placeholder = "Ask Gemini Enterprise";
    updateHeaderState();
    closeDrawer();
    input!.focus();
  }

  if (modelMenuRoot) {
    const anchor = modelMenuRoot.querySelector(".action-model-selector") as HTMLElement | null;
    const panel = modelMenuRoot.querySelector(
      ".ge-omnibar-model-menu__panel"
    ) as HTMLElement | null;
    const labelEl = modelMenuRoot.querySelector(".model-selector-label") as HTMLElement | null;
    if (anchor && panel && labelEl) {
      const optionBtns = panel.querySelectorAll("[data-mode]");
      const applyMode = (mode: string | null) => {
        state.mode = mode === "answer" ? "answer" : "streamAssist";
        optionBtns.forEach((opt) => {
          const selected = opt.getAttribute("data-mode") === state.mode;
          opt.classList.toggle("is-selected", selected);
          opt.setAttribute("aria-selected", selected ? "true" : "false");
        });
        labelEl.textContent = state.mode === "answer" ? "Quick" : "Auto";
      };
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        anchor.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
      });
      optionBtns.forEach((opt) => {
        opt.addEventListener("click", (event) => {
          event.preventDefault();
          applyMode(opt.getAttribute("data-mode"));
          panel.hidden = true;
          anchor.setAttribute("aria-expanded", "false");
        });
      });
      applyMode(state.mode);
    }
  }

  if (newBtn) {
    newBtn.addEventListener("click", resetSession);
  }
  if (sizeBtn) {
    sizeBtn.addEventListener("click", () => {
      state.expandedTall = !state.expandedTall;
      drawer!.classList.toggle("ge-omnibar-drawer--tall", state.expandedTall);
      sizeBtn.textContent = state.expandedTall ? "Compact ↕" : "Expand ↕";
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeDrawer);
  }

  input.addEventListener("input", syncSubmitButton);
  input.addEventListener("focus", () => {
    if (state.turns.length > 0 && drawer!.hidden) {
      openDrawer();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || state.loading) {
      return;
    }

    input.value = "";
    state.loading = true;
    syncSubmitButton();
    openDrawer();
    updateHeaderState();
    input.focus();

    const turnEl = documentRef.createElement("div");
    turnEl.className = "ge-omnibar-turn";
    turnEl.innerHTML =
      '<div class="ge-omnibar-user-row">' +
        '<div class="ge-omnibar-user-bubble">' +
          escapeHtml(query) +
        "</div>" +
      "</div>" +
      '<div class="ge-omnibar-assistant-row">' +
        '<div class="ge-omnibar-loading">' +
          '<span class="ge-omnibar-spinner"></span>' +
          "<span>Searching enterprise knowledge &amp; generating answer…</span>" +
        "</div>" +
      "</div>";
    threadEl.appendChild(turnEl);
    threadEl.scrollTop = threadEl.scrollHeight;

    const assistantRow = turnEl.querySelector(".ge-omnibar-assistant-row") as HTMLElement;

    prepareOmnibarSearchPayload(
      query,
      state.session || "",
      state.mode,
      state.userEmail,
      state.googleOAuthClientId,
      identityConfig,
      Boolean(state.googleOAuthServerEnabled)
    )
      .then((prepared) => {
        const headers = { ...prepared.headers, "Content-Type": "application/json" };
        const postSearch = () =>
          fetch("/api/search", {
            method: "POST",
            headers,
            credentials: "include",
            body: JSON.stringify(prepared.body)
          });
        return postSearch().then((resp) =>
          resp.json().then((body) => {
            if (resp.status === 401 && body && body.error === "google_oauth_required") {
              return completeServerGoogleOAuthPopup(
                body.authUrl || state.googleOAuthLoginUrl,
                body.loginHint || state.userEmail || (prepared.body && prepared.body.userEmail) || ""
              ).then((authed) => {
                if (!authed) {
                  throw new Error("google_oauth_required");
                }
                state.googleOAuthAuthenticated = true;
                return postSearch().then((retryResp) =>
                  retryResp.json().then((retryBody) => {
                    if (!retryResp.ok) {
                      throw new Error((retryBody && retryBody.error) || "HTTP " + retryResp.status);
                    }
                    return retryBody;
                  })
                );
              });
            }
            if (!resp.ok) {
              throw new Error((body && body.error) || "HTTP " + resp.status);
            }
            return body;
          })
        );
      })
      .then((data) => {
        state.loading = false;
        if (data.session) {
          state.session = data.session;
        }
        if (data.sessionId) {
          state.sessionId = data.sessionId;
        }
        if (data.deepLinkUrl) {
          state.deepLinkUrl = data.deepLinkUrl;
        } else if (state.sessionId) {
          state.deepLinkUrl = buildDeepLinkUrl(
            state.widgetConfigId,
            state.sessionId,
            state.includeSessionInDeepLink
          );
        }

        state.turns.push({
          query,
          summary: data.summary || "",
          results: data.results || [],
          deepLinkUrl: state.deepLinkUrl
        });

        input.placeholder = "Ask a follow-up question in this session…";
        updateHeaderState();
        syncSubmitButton();

        const formattedAnswer = formatGeminiMarkdown(data.summary || "", data.results || []);
        const sourcesHtml = renderSourcesHtml(data.results || []);

        assistantRow.innerHTML =
          '<div class="ge-omnibar-answer-card">' +
            '<div class="ge-omnibar-markdown">' +
              formattedAnswer +
            "</div>" +
            sourcesHtml +
            '<div class="ge-omnibar-answer-footer">' +
              '<span class="ge-omnibar-footer-hint">Session saved to your Gemini Enterprise history</span>' +
              '<a class="ge-omnibar-deep-link" href="' +
                escapeHtml(state.deepLinkUrl) +
                '" target="_blank" rel="noopener noreferrer">' +
                "Open in Gemini Enterprise App ↗" +
              "</a>" +
            "</div>" +
          "</div>";

        threadEl.scrollTop = threadEl.scrollHeight;
        input.focus();
      })
      .catch((err) => {
        state.loading = false;
        updateHeaderState();
        syncSubmitButton();
        const fallbackUrl =
          buildDeepLinkUrl(
            state.widgetConfigId,
            state.sessionId,
            state.includeSessionInDeepLink
          ) + (state.sessionId ? "" : "?q=" + encodeURIComponent(query));
        assistantRow.innerHTML =
          '<div class="ge-omnibar-error-card">' +
            '<p class="ge-omnibar-error-title">Could not complete inline search (' +
              escapeHtml(err && err.message ? err.message : "unknown_error") +
            ")</p>" +
            '<p class="ge-omnibar-error-sub">You can still run this query directly in the Gemini Enterprise web app:</p>' +
            '<a class="ge-omnibar-btn ge-omnibar-btn--primary" href="' +
              escapeHtml(fallbackUrl) +
              '" target="_blank" rel="noopener noreferrer">' +
              "Open in Gemini Enterprise App ↗" +
            "</a>" +
          "</div>";
        threadEl.scrollTop = threadEl.scrollHeight;
        input.focus();
      });
  });

  syncSubmitButton();
  return {
    state,
    resetSession,
    openDrawer,
    closeDrawer
  };
}
