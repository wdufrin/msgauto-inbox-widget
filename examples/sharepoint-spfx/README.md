# SharePoint Online (SPFx) Integration

Use [`GeminiOmnibarWebPart.ts`](./GeminiOmnibarWebPart.ts) inside your SPFx WebPart `render()` method to mount `<gemini-omnibar>` and automatically bridge SharePoint's `pageContext.user` and `aadTokenProviderFactory` into `<gemini-omnibar>`.
