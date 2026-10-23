# Search Bar Variant 2: Small Compact Header Bar (`variant="small"`)

The **Small** variant renders a single-line `40px`-tall compact pill bar (`width: 340px`, customizable via `--ge-small-width`) designed for global top navigation bars. When the user submits a query, the conversation drawer opens as a **floating tethered popover** (`position: absolute; top: calc(100% + 10px); right: 0`) so it never shifts or breaks the host navbar layout.

## When to Use
- Global intranet top navigation bars (replacing legacy `.soc-header__search-wrap`)
- SharePoint Online suite bars / header placeholders
- ServiceNow or Salesforce utility headers

## HTML Drop-In Snippet

```html
<script src="https://your-proxy.a.run.app/gemini-omnibar.js" defer></script>

<gemini-omnibar
  variant="small"
  api-url="https://your-proxy.a.run.app"
  placeholder="Ask Gemini…"
  theme="dark"
  default-mode="streamAssist"
  widget-config-id="00000000-0000-0000-0000-000000000000">
</gemini-omnibar>
```

## Custom CSS Properties
```css
gemini-omnibar[variant="small"] {
  --ge-small-width: 340px;
  --ge-popover-width: 620px;
  --ge-radius: 999px;
}
```
