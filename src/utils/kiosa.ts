import {
  kiosaVisualTokens,
  getKiosaAccentForPath,
  type KiosaAccentName,
} from "./theme.js";

export type { KiosaAccentName };
export { getKiosaAccentForPath };

/**
 * Render the standard kiosa <head> assets for a route.
 * Just sets the per-route accent variable and links the shared stylesheet.
 */
export function getKiosaStylesheetLink(accent: KiosaAccentName): string {
  return `
<style>:root { --kiosa-accent: ${kiosaVisualTokens.colors.accents[accent]}; }</style>
<link rel="stylesheet" href="/kiosa.css">`.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface TopbarOptions {
  title: string;
  subtitle?: string;
  chips?: string[];
  tabs?: { label: string; href: string; active?: boolean }[];
  rightMeta?: string;
}

/**
 * Render the kiosa topbar HTML.
 */
export function getKiosaTopbarHTML(options: TopbarOptions): string {
  const chipsHtml = (options.chips ?? [])
    .map((chip) => `<span class="kiosa-chip">${chip}</span>`)
    .join("");
  const tabsHtml = options.tabs?.length
    ? `<nav class="kiosa-tabs">${options.tabs
        .map(
          (tab) =>
            `<a href="${escapeHtml(tab.href)}"${tab.active ? ' aria-current="page"' : ""}>${escapeHtml(tab.label)}</a>`,
        )
        .join("")}</nav>`
    : "";
  return `
<div class="kiosa-topbar">
  <a href="/" class="kiosa-topbar__brand" aria-label="Home">
    <span class="kiosa-topbar__glyph"></span>
    <span class="kiosa-topbar__title">${escapeHtml(options.title)}</span>
  </a>
  ${options.subtitle ? `<span class="kiosa-topbar__subtitle">${escapeHtml(options.subtitle)}</span>` : ""}
  ${chipsHtml ? `<div class="kiosa-topbar__chips">${chipsHtml}</div>` : ""}
  <div class="kiosa-topbar__right">
    ${options.rightMeta ? `<span class="kiosa-topbar__meta">${escapeHtml(options.rightMeta)}</span>` : ""}
  </div>
</div>
${tabsHtml}
`;
}

/**
 * Generic kiosa panel with micro-label header.
 */
export function getKiosaPanelHTML(label: string, content: string): string {
  return `
<div class="kiosa-panel">
  <div class="kiosa-panel__label"><span>${escapeHtml(label)}</span></div>
  ${content}
</div>`;
}

/**
 * Kiosa chip readout.
 */
export function getKiosaChipHTML(
  text: string,
  options: { accent?: boolean; faint?: boolean; html?: boolean } = {},
): string {
  const classes = ["kiosa-chip"];
  if (options.accent) classes.push("kiosa-chip--accent");
  if (options.faint) classes.push("kiosa-chip--faint");
  const content = options.html ? text : escapeHtml(text);
  return `<span class="${classes.join(" ")}">${content}</span>`;
}

/**
 * Kiosa rank stream row.
 */
export function getKiosaRankRowHTML(
  index: number,
  tag: string,
  score: string,
): string {
  const idx = String(index).padStart(3, "0");
  return `
<div class="kiosa-rank-row">
  <span class="kiosa-rank-row__index">#${idx}</span>
  <span class="kiosa-tag">${escapeHtml(tag)}</span>
  <span class="kiosa-rank-row__score">${escapeHtml(score)}</span>
</div>`;
}

/**
 * Kiosa exec / event log entry.
 */
export function getKiosaLogHTML(index: number, text: string, ok = true): string {
  const idx = String(index).padStart(4, "0");
  return `
<div class="kiosa-log">
  <span class="kiosa-log__index">${idx}</span>
  <span class="kiosa-log__text">&gt; ${escapeHtml(text)}</span>
  ${ok ? `<span class="kiosa-log__status">[ok]</span>` : ""}
</div>`;
}

/**
 * Kiosa uplink bar.
 */
export function getKiosaUplinkHTML(label: string, pct: number, value: string): string {
  return `
<div class="kiosa-uplink">
  <span class="kiosa-uplink__label">${escapeHtml(label)}</span>
  <div class="kiosa-uplink__bar"><i style="width:${pct}%"></i></div>
  <span class="kiosa-uplink__value">${escapeHtml(value)}</span>
</div>`;
}

/**
 * Kiosa spectrum (28 vertical bars).
 */
export function getKiosaSpectrumHTML(bars: number[] = []): string {
  const values = bars.length
    ? bars.slice(0, 28)
    : Array.from({ length: 28 }, () => Math.floor(Math.random() * 92) + 8);
  while (values.length < 28) values.push(Math.floor(Math.random() * 92) + 8);
  const barsHtml = values
    .map((h) => `<i style="height:${h}%"></i>`)
    .join("");
  return `<div class="kiosa-spectrum">${barsHtml}</div>`;
}

/**
 * Kiosa scan acquire strip.
 */
export function getKiosaScanHTML(pct: number, meta: string): string {
  const lit = Math.round((pct / 100) * 24);
  const segments = Array.from({ length: 24 }, (_, i) => {
    const isLit = i < lit;
    return `<i${isLit ? ' class="lit"' : ""}></i>`;
  }).join("");
  return `
<div class="kiosa-scan">
  <div class="kiosa-scan__header">
    <span class="kiosa-scan__label">SCAN ACQUIRE</span>
    <span class="kiosa-scan__meta">${escapeHtml(meta)}</span>
  </div>
  <div class="kiosa-scan__segments">${segments}</div>
</div>`;
}

/**
 * Kiosa hero wireframe visualization placeholder.
 */
export function getKiosaWireframeHTML(caption: string): string {
  return `
<div class="kiosa-wireframe">
  <svg width="100%" height="160" viewBox="0 0 320 160">
    <rect x="80" y="40" width="160" height="80" stroke-dasharray="4 4" />
    <line x1="80" y1="120" x2="160" y2="160" />
    <line x1="240" y1="120" x2="160" y2="160" />
    <line x1="80" y1="40" x2="160" y2="0" />
    <line x1="240" y1="40" x2="160" y2="0" />
    <circle cx="160" cy="80" r="28" />
    <path d="M120 80 Q160 40 200 80 T120 80" opacity="0.5" />
  </svg>
  <div class="kiosa-wireframe__caption">${escapeHtml(caption)}</div>
</div>`;
}

/**
 * Kiosa page footer.
 */
export function getKiosaFooterHTML(left: string, right: string): string {
  return `
<footer class="kiosa-footer">
  <span>${escapeHtml(left)}</span>
  <span>${escapeHtml(right)}</span>
</footer>`;
}
