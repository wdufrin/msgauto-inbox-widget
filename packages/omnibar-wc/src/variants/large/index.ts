/**
 * Variant 1: Large Hero Omnibar (`variant="large"`)
 *
 * Form Factor:
 *   - Multiline rounded hero card (border-radius: 28px, padding: 18px 20px 12px)
 *   - Top row: 22x22 Gemini gradient sparkle icon + full-width text input
 *   - Bottom row: Mode selector dropdown (`Auto ⌄` / `Quick ⌄`) + 40x40 circular submit button (`↑`)
 *   - Conversation Drawer: Inline expand-down drawer that docks the search input at the bottom of the card
 *
 * Best For:
 *   - Intranet homepages, executive portals, knowledge base hero banners
 */

export const LARGE_VARIANT_CSS = `
/* Variant: Large (Default Hero Multiline Omnibar) */
.ge-omnibar-shell[data-variant="large"] {
  border-radius: var(--ge-radius, 28px);
  padding: 18px 20px 12px;
}
`;

export const VARIANT_LARGE_CSS = LARGE_VARIANT_CSS;

export const VARIANT_LARGE_METADATA = Object.freeze({
  variant: "large" as const,
  label: "Large Hero Multiline Omnibar",
  drawerPosition: "inline-expand-down" as const
});

