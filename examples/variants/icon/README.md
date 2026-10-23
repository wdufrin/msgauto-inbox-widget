# Search Bar Variant 3: Expandable Icon Trigger (`variant="icon"`)

The **Icon** variant starts as a compact `40px × 40px` circular button displaying the Gemini 4-point gradient sparkle (`✦`). On hover, keyboard focus, or click, it smoothly animates (`cubic-bezier(0.22, 1, 0.36, 1)`) to `290px` wide (modeled after `.news-search`), revealing the search input, mode selector, and submit button, and opens a **floating tethered popover drawer** for the conversation.

## When to Use
- Tight widget/section headers (e.g., News or Announcements card headers)
- Dense application toolbars with limited horizontal space
- Mobile or responsive header bars

## HTML Drop-In Snippet

```html
<script src="https://your-proxy.a.run.app/gemini-omnibar.js" defer></script>

<gemini-omnibar
  variant="icon"
  api-url="https://your-proxy.a.run.app"
  placeholder="Ask Gemini…"
  theme="dark"
  default-mode="streamAssist"
  widget-config-id="00000000-0000-0000-0000-000000000000">
</gemini-omnibar>
```

## Custom CSS Properties
```css
gemini-omnibar[variant="icon"] {
  --ge-icon-expanded-width: 290px;
  --ge-popover-width: 580px;
}
```
