/**
 * Regex-based Markdown & Grounded Citation Formatter for <gemini-omnibar>.
 *
 * Technical Note: This module uses Regex Pattern Matching (not a full CommonMark AST parser)
 * to keep the Web Component bundle zero-dependency and <25 KB.
 * Known limits of regex formatting: deeply nested blockquotes/lists or multi-line table cells
 * are rendered as flat blocks. All user/model strings are HTML-escaped prior to tag injection
 * and all URLs are restricted to http(s) schemes to prevent XSS.
 */

export interface GroundedSource {
  index?: number;
  title?: string;
  url?: string;
  snippet?: string;
}

export const DEFAULT_WIDGET_CONFIG_ID = "default_search_widget_config";

export function escapeHtml(raw: unknown): string {
  return String(raw == null ? "" : raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeUrl(url: unknown): string {
  const trimmed = String(url == null ? "" : url).trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

export function buildDeepLinkUrl(
  widgetConfigId?: string,
  sessionId?: string,
  includeSessionInDeepLink: boolean = true
): string {
  const cid = String(widgetConfigId || "").trim();
  if (!cid) {
    return "https://vertexaisearch.cloud.google.com/u/0/home";
  }
  const base = "https://vertexaisearch.cloud.google.com/u/0/home/cid/" + encodeURIComponent(cid);
  const sid = String(sessionId || "").trim();
  if (!includeSessionInDeepLink || !sid || sid === "-") {
    return base;
  }
  return base + "/r/session/" + encodeURIComponent(sid);
}

export function formatInlineMarkdown(escapedText: string, results?: GroundedSource[]): string {
  const sources = Array.isArray(results) ? results : [];
  let out = String(escapedText || "");

  // Inline code `code`
  out = out.replace(/`([^`\n]+)`/g, '<code class="ge-omnibar-inline-code">$1</code>');

  // Bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic *text*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  // Markdown links [label](https://...)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    const unescapedUrl = String(rawUrl).replace(/&amp;/g, "&");
    const safe = sanitizeUrl(unescapedUrl);
    if (!safe) {
      return label;
    }
    return (
      '<a class="ge-omnibar-link" href="' +
      escapeHtml(safe) +
      '" target="_blank" rel="noopener noreferrer">' +
      label +
      "</a>"
    );
  });

  // Citation badges [1], [2]
  out = out.replace(/\[(\d{1,2})\]/g, (_full, numStr: string) => {
    const idx = parseInt(numStr, 10);
    const source = idx >= 1 && idx <= sources.length ? sources[idx - 1] : null;
    const safeUrl = source ? sanitizeUrl(source.url) : "";
    const titleAttr = source && source.title ? ' title="' + escapeHtml(source.title) + '"' : "";
    if (safeUrl) {
      return (
        '<a class="ge-omnibar-cite-badge" href="' +
        escapeHtml(safeUrl) +
        '" target="_blank" rel="noopener noreferrer"' +
        titleAttr +
        ">" +
        idx +
        "</a>"
      );
    }
    return '<span class="ge-omnibar-cite-badge"' + titleAttr + ">" + idx + "</span>";
  });

  return out;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && t.indexOf("|") !== -1 && /^\|?.+\|.+/.test(t);
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?[\s:-]+\|[\s|:-]+$/.test(t);
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Convert Gemini Markdown response text into XSS-safe formatted HTML using Regex Pattern Matching.
 */
export function formatGeminiMarkdown(markdownText: string, results?: GroundedSource[]): string {
  const raw = String(markdownText == null ? "" : markdownText).replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return '<p class="ge-omnibar-empty-answer">No summary text was returned for this query.</p>';
  }

  const codeBlocks: string[] = [];
  const withPlaceholders = raw.replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      const idx = codeBlocks.length;
      const langBadge = lang
        ? '<div class="ge-omnibar-code-lang">' + escapeHtml(lang) + "</div>"
        : "";
      codeBlocks.push(
        '<div class="ge-omnibar-code-wrap">' +
          langBadge +
          '<pre class="ge-omnibar-pre"><code>' +
          escapeHtml(code.replace(/\n$/, "")) +
          "</code></pre></div>"
      );
      return "\n@@GE_OMNIBAR_CODE_BLOCK_" + idx + "@@\n";
    }
  );

  const lines = withPlaceholders.split("\n");
  const html: string[] = [];
  let inUl = false;
  let inOl = false;

  function closeLists(): void {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeLists();
      continue;
    }

    const codeMatch = trimmed.match(/^@@GE_OMNIBAR_CODE_BLOCK_(\d+)@@$/);
    if (codeMatch) {
      closeLists();
      html.push(codeBlocks[parseInt(codeMatch[1], 10)] || "");
      continue;
    }

    // Markdown table
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeLists();
      const headers = splitTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(splitTableCells(lines[i]));
        i += 1;
      }
      i -= 1;

      let tableHtml =
        '<div class="ge-omnibar-table-wrap"><table class="ge-omnibar-table"><thead><tr>';
      headers.forEach((h) => {
        tableHtml += "<th>" + formatInlineMarkdown(escapeHtml(h), results) + "</th>";
      });
      tableHtml += "</tr></thead><tbody>";
      rows.forEach((r) => {
        tableHtml += "<tr>";
        headers.forEach((_h, colIdx) => {
          tableHtml += "<td>" + formatInlineMarkdown(escapeHtml(r[colIdx] || ""), results) + "</td>";
        });
        tableHtml += "</tr>";
      });
      tableHtml += "</tbody></table></div>";
      html.push(tableHtml);
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeLists();
      const level = Math.min(4, headingMatch[1].length + 1);
      html.push(
        "<h" +
          level +
          ' class="ge-omnibar-heading">' +
          formatInlineMarkdown(escapeHtml(headingMatch[2]), results) +
          "</h" +
          level +
          ">"
      );
      continue;
    }

    // Blockquote
    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      closeLists();
      html.push(
        '<blockquote class="ge-omnibar-quote">' +
          formatInlineMarkdown(escapeHtml(quoteMatch[1]), results) +
          "</blockquote>"
      );
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push('<ul class="ge-omnibar-list">');
        inUl = true;
      }
      html.push("<li>" + formatInlineMarkdown(escapeHtml(ulMatch[1]), results) + "</li>");
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push('<ol class="ge-omnibar-list ge-omnibar-list--ordered">');
        inOl = true;
      }
      html.push("<li>" + formatInlineMarkdown(escapeHtml(olMatch[1]), results) + "</li>");
      continue;
    }

    closeLists();
    html.push(
      '<p class="ge-omnibar-para">' +
        formatInlineMarkdown(escapeHtml(trimmed), results) +
        "</p>"
    );
  }

  closeLists();
  return html.join("\n");
}

export function renderSourcesHtml(results?: GroundedSource[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return "";
  }
  const items = results
    .map((src, idx) => {
      const num = src.index || idx + 1;
      const title = escapeHtml(src.title || "Source " + num);
      const snippet = escapeHtml(src.snippet || "");
      const safeUrl = sanitizeUrl(src.url);
      const badge = '<span class="ge-omnibar-source-num">' + num + "</span>";
      if (safeUrl) {
        return (
          '<a class="ge-omnibar-source-chip" href="' +
          escapeHtml(safeUrl) +
          '" target="_blank" rel="noopener noreferrer" title="' +
          snippet +
          '">' +
          badge +
          '<span class="ge-omnibar-source-title">' +
          title +
          '</span><span aria-hidden="true">↗</span></a>'
        );
      }
      return (
        '<span class="ge-omnibar-source-chip" title="' +
        snippet +
        '">' +
        badge +
        '<span class="ge-omnibar-source-title">' +
        title +
        "</span></span>"
      );
    })
    .join("");

  return (
    '<div class="ge-omnibar-sources">' +
    '<div class="ge-omnibar-sources-label">Grounded Sources</div>' +
    '<div class="ge-omnibar-sources-list">' +
    items +
    "</div></div>"
  );
}
