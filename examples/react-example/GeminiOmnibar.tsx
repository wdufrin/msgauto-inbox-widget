import React, { useEffect, useRef } from "react";
import "../../packages/omnibar-wc/src/index";

export interface GeminiOmnibarProps {
  apiUrl?: string;
  variant?: "large" | "small" | "icon";
  mode?: "proxy" | "direct";
  defaultMode?: "streamAssist" | "answer";
  placeholder?: string;
  theme?: "dark" | "light" | "auto";
  googleClientId?: string;
  projectId?: string;
  location?: string;
  engineId?: string;
  widgetConfigId?: string;
  identityStrategy?: "passthrough" | "domain_rewrite" | "claim_template";
  identityDomain?: string;
  identitySourceDomain?: string;
  onSearchSuccess?: (detail: {
    query: string;
    mode: string;
    session: string;
    sessionId: string;
    deepLinkUrl: string;
    summary: string;
    results: Array<{ index?: number; title?: string; url?: string; snippet?: string }>;
  }) => void;
  onSearchError?: (detail: { query: string; mode: string; error: string }) => void;
}

export const GeminiOmnibar: React.FC<GeminiOmnibarProps> = ({
  apiUrl,
  variant = "large",
  mode = "proxy",
  defaultMode = "streamAssist",
  placeholder = "Ask Gemini Enterprise",
  theme = "dark",
  googleClientId,
  projectId,
  location = "global",
  engineId,
  widgetConfigId,
  identityStrategy = "passthrough",
  identityDomain,
  identitySourceDomain,
  onSearchSuccess,
  onSearchError
}) => {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleSuccess = (e: Event) => {
      if (onSearchSuccess) {
        onSearchSuccess((e as CustomEvent).detail);
      }
    };
    const handleError = (e: Event) => {
      if (onSearchError) {
        onSearchError((e as CustomEvent).detail);
      }
    };

    el.addEventListener("ge-search-success", handleSuccess);
    el.addEventListener("ge-search-error", handleError);
    return () => {
      el.removeEventListener("ge-search-success", handleSuccess);
      el.removeEventListener("ge-search-error", handleError);
    };
  }, [onSearchSuccess, onSearchError]);

  return React.createElement("gemini-omnibar", {
    ref,
    "api-url": apiUrl,
    variant,
    mode,
    "default-mode": defaultMode,
    placeholder,
    theme,
    "google-client-id": googleClientId,
    "project-id": projectId,
    location,
    "engine-id": engineId,
    "widget-config-id": widgetConfigId,
    "identity-strategy": identityStrategy,
    "identity-domain": identityDomain,
    "identity-source-domain": identitySourceDomain
  });
};
