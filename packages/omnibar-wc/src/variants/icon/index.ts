/**
 * Variant 3: Icon Expandable Search Trigger (`variant="icon"`)
 *
 * Form Factor:
 *   - Collapsed state: 40x40 circular/rounded icon button (`✦` Gemini gradient sparkle)
 *   - Hover / Focus / Expanded state: Smoothly animates width (`40px` -> `280px` via `cubic-bezier(0.22, 1, 0.36, 1)`)
 *     revealing the search input, mode selector, and submit button (modeled after `.news-search`)
 *   - Conversation Drawer: Floating tethered popover overlay (`position: absolute; top: calc(100% + 10px); right: 0`)
 *
 * Best For:
 *   - Section headers (e.g. News widget header `.news-search`), compact utility toolbars, mobile headers
 */

export const ICON_VARIANT_CSS = `
/* Variant: Icon (40x40 Icon Trigger that Smoothly Expands on Hover/Focus/Click) */
:host([variant="icon"]) {
  display: inline-block;
  width: auto;
  vertical-align: middle;
}

.ge-omnibar-shell[data-variant="icon"] {
  --_icon-ease: cubic-bezier(0.22, 1, 0.36, 1);
  width: 40px;
  height: 40px;
  min-height: 40px;
  padding: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: visible;
  transition:
    width 0.42s var(--_icon-ease),
    padding 0.32s var(--_icon-ease),
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.ge-omnibar-shell[data-variant="icon"]:hover,
.ge-omnibar-shell[data-variant="icon"]:focus-within,
.ge-omnibar-shell[data-variant="icon"].is-icon-expanded,
.ge-omnibar-shell[data-variant="icon"].has-open-drawer {
  width: var(--ge-icon-expanded-width, 290px);
  padding: 4px 6px 4px 12px;
  cursor: default;
}

.ge-omnibar-shell[data-variant="icon"] .ge-omnibar-form {
  width: 100%;
  border-top: 0 !important;
  padding-top: 0 !important;
  order: 1 !important;
}

.ge-omnibar-shell[data-variant="icon"] .bottom-search-container {
  flex-wrap: nowrap;
  column-gap: 8px;
  row-gap: 0;
  justify-content: center;
}

.ge-omnibar-shell[data-variant="icon"] .prefix-icon {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.ge-omnibar-shell[data-variant="icon"] .input-and-weaveform-container,
.ge-omnibar-shell[data-variant="icon"] .multiline-input-actions-buttons {
  opacity: 0;
  max-width: 0;
  overflow: hidden;
  pointer-events: none;
  transition: opacity 0.25s ease, max-width 0.38s var(--_icon-ease);
}

.ge-omnibar-shell[data-variant="icon"]:hover .input-and-weaveform-container,
.ge-omnibar-shell[data-variant="icon"]:focus-within .input-and-weaveform-container,
.ge-omnibar-shell[data-variant="icon"].is-icon-expanded .input-and-weaveform-container,
.ge-omnibar-shell[data-variant="icon"].has-open-drawer .input-and-weaveform-container {
  opacity: 1;
  max-width: 200px;
  pointer-events: auto;
}

.ge-omnibar-shell[data-variant="icon"]:hover .multiline-input-actions-buttons,
.ge-omnibar-shell[data-variant="icon"]:focus-within .multiline-input-actions-buttons,
.ge-omnibar-shell[data-variant="icon"].is-icon-expanded .multiline-input-actions-buttons,
.ge-omnibar-shell[data-variant="icon"].has-open-drawer .multiline-input-actions-buttons {
  opacity: 1;
  max-width: 110px;
  overflow: visible;
  pointer-events: auto;
  flex: 0 0 auto;
}

.ge-omnibar-shell[data-variant="icon"] .actions-gap {
  display: none;
}

.ge-omnibar-shell[data-variant="icon"] .input-and-weaveform-container input {
  font-size: 0.84rem;
}

.ge-omnibar-shell[data-variant="icon"] .action-model-selector {
  padding: 2px 5px;
}

.ge-omnibar-shell[data-variant="icon"] .model-selector-label {
  font-size: 0.75rem;
}

.ge-omnibar-shell[data-variant="icon"] .send-button {
  width: 28px;
  height: 28px;
}

.ge-omnibar-shell[data-variant="icon"] .send-button svg {
  width: 14px;
  height: 14px;
}

/* Floating Tethered Popover Drawer for Icon Variant */
.ge-omnibar-shell[data-variant="icon"] .ge-omnibar-drawer {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 1000;
  width: var(--ge-popover-width, min(580px, 92vw));
  margin-top: 0;
  padding: 14px 16px 12px;
  background: var(--_bg);
  border: 1px solid var(--_border-open);
  border-radius: 20px;
  box-shadow: var(--_shadow-open);
  max-height: min(500px, 65vh);
}
`;

export const VARIANT_ICON_CSS = ICON_VARIANT_CSS;

export const VARIANT_ICON_METADATA = Object.freeze({
  variant: "icon" as const,
  label: "Expandable 40x40 Icon Trigger",
  drawerPosition: "floating-popover" as const
});

