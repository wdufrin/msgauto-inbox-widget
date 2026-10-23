/**
 * SharePoint Online SPFx WebPart snippet for <gemini-omnibar>.
 *
 * Automatically bridges the signed-in SharePoint / Entra ID user's identity and token
 * into window.__geEntraAuth so <gemini-omnibar> enforces per-user ACLs seamlessly.
 */

export interface IGeminiOmnibarWebPartProps {
  apiUrl: string;
  widgetConfigId: string;
  googleClientId?: string;
  theme?: "dark" | "light" | "auto";
}

export async function renderGeminiOmnibarInSpfx(
  domElement: HTMLElement,
  spfxContext: any,
  props: IGeminiOmnibarWebPartProps
): Promise<void> {
  const user = spfxContext?.pageContext?.user;
  if (user && typeof window !== "undefined") {
    (window as any).__geEntraAuth = {
      getAccount: () => ({
        username: user.email || user.loginName || "",
        name: user.displayName || ""
      }),
      getToken: async () => {
        if (!spfxContext.aadTokenProviderFactory) {
          return "";
        }
        const provider = await spfxContext.aadTokenProviderFactory.getTokenProvider();
        return provider.getToken("https://graph.microsoft.com");
      }
    };
  }

  domElement.innerHTML = "";
  const el = document.createElement("gemini-omnibar");
  el.setAttribute("api-url", props.apiUrl || "");
  el.setAttribute("widget-config-id", props.widgetConfigId || "");
  el.setAttribute("theme", props.theme || "dark");
  if (props.googleClientId) {
    el.setAttribute("google-client-id", props.googleClientId);
  }
  domElement.appendChild(el);
}
