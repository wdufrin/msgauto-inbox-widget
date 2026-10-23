# React Wrapper Example (`<GeminiOmnibar />`)

Import `<GeminiOmnibar />` in any React / Next.js / Vite application:

```tsx
import { GeminiOmnibar } from "./GeminiOmnibar";

export function HeaderSearch() {
  return (
    <GeminiOmnibar
      apiUrl="https://gemini-omnibar-proxy-xxxxx.a.run.app"
      theme="dark"
      placeholder="Ask Gemini Enterprise"
      onSearchSuccess={(e) => console.log("Synced session:", e.sessionId, e.deepLinkUrl)}
    />
  );
}
```
