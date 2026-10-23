/**
 * Variant 2: Small Compact Header / Navbar Search Bar (`variant="small"`)
 *
 * Form Factor:
 *   - Single-line compact pill/box (height: 40px, border-radius: 999px or 10px, padding: 4px 6px 4px 12px)
 *   - Inline layout: 18x18 Gemini sparkle icon + input + compact `Auto ⌄` pill + 28x28 circular submit button (`↑`)
 *   - Conversation Drawer: Floating tethered popover overlay (`position: absolute; top: calc(100% + 8px); right: 0`)
 *     so opening the chat never shifts or breaks the host application's top navigation bar.
 *
 * Best For:
 *   - Global top navigation bars (e.g. `.soc-header__search-wrap`), SharePoint suite headers, ServiceNow navbars
 */

export const SMALL_VARIANT_CSS = `
/* Variant: Small (Single-Line Compact Header / Navbar Bar) */
:host([variant="small"]) {
  display: inline-block;
  width: var(--ge-small-width, 340px);
  max-width: 100%;
  vertical-align: middle;
}

.ge-omnibar-shell[data-variant="small"] {
  border-radius: var(--ge-radius, 999px);
  padding: 4px 6px 4px 14px;
  min-height: 40px;
  display: flex;
  align-items: center;
}

.ge-omnibar-shell[data-variant="small"] .ge-omnibar-form {
  width: 100%;
  border-top: 0 !important;
  padding-top: 0 !important;
  order: 1 !important;
}

.ge-omnibar-shell[data-variant="small"] .bottom-search-container {
  flex-wrap: nowrap;
  column-gap: 8px;
  row-gap: 0;
  min-height: 30px;
}

.ge-omnibar-shell[data-variant="small"] .prefix-icon,
.ge-omnibar-shell[data-variant="small"] .prefix-icon svg,
.ge-omnibar-shell[data-variant="small"] .prefix-icon .gemini-logo {
  width: 18px;
  height: 18px;
}

.ge-omnibar-shell[data-variant="small"] .input-and-weaveform-container input {
  font-size: 0.85rem;
}

.ge-omnibar-shell[data-variant="small"] .multiline-input-actions-buttons {
  flex: 0 0 auto;
  width: auto;
  gap: 2px;
}

.ge-omnibar-shell[data-variant="small"] .actions-gap {
  display: none;
}

.ge-omnibar-shell[data-variant="small"] .action-model-selector {
  padding: 3px 6px;
  border-radius: 6px;
}

.ge-omnibar-shell[data-variant="small"] .model-selector-label {
  font-size: 0.78rem;
}

.ge-omnibar-shell[data-variant="small"] .send-button {
  width: 28px;
  height: 28px;
}

.ge-omnibar-shell[data-variant="small"] .send-button svg {
  width: 14px;
  height: 14px;
}

/* Floating Tethered Popover Drawer for Small Variant */
.ge-omnibar-shell[data-variant="small"] .ge-omnibar-drawer {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 1000;
  width: var(--ge-popover-width, min(620px, 92vw));
  margin-top: 0;
  padding: 14px 16px 12px;
  background: var(--_bg);
  border: 1px solid var(--_border-open);
  border-radius: 20px;
  box-shadow: var(--_shadow-open);
  max-height: min(520px, 68vh);
}
`;

export const VARIANT_SMALL_CSS = SMALL_VARIANT_CSS;

export const VARIANT_SMALL_METADATA = Object.freeze({
  variant: "small" as const,
  label: "Small Compact Header / Navbar Search Bar",
  drawerPosition: "floating-popover" as const
});

