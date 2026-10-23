# Search Bar Variant 1: Large Hero Omnibar (`variant="large"`)

The **Large** variant (default) renders a full-width, two-row rounded hero pill bar (`border-radius: 28px`) with an inline expand-down conversation drawer that docks the input bar at the bottom of the expanded card.

## When to Use
- Corporate intranet homepages and hero banners
- Dedicated AI knowledge portals
- Departmental landing pages (Engineering, HR, Legal, Finance)

## HTML Drop-In Snippet

```html
<script src="https://your-proxy.a.run.app/gemini-omnibar.js" defer></script>

<gemini-omnibar
  variant="large"
  api-url="https://your-proxy.a.run.app"
  placeholder="Ask Gemini Enterprise"
  theme="dark"
  default-mode="streamAssist"
  widget-config-id="00000000-0000-0000-0000-000000000000">
</gemini-omnibar>
```

## Custom CSS Properties
```css
gemini-omnibar[variant="large"] {
  --ge-radius: 28px;
  --ge-bg: #1e1f20;
  --ge-border: #3c4043;
  --ge-accent: #1a73e8;
}
```
