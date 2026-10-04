import {
  kiosaTheme,
  kiosaVisualTokens,
  getKiosaAccentForPath,
  type KiosaAccentName,
} from "./theme.js";

export type { KiosaAccentName };
export { getKiosaAccentForPath };

function getKiosaFontLinkCSS(): string {
  return `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Oswald:wght@500;700&display=swap" rel="stylesheet" />
`.trim();
}

const c = kiosaTheme.colors;
const t = kiosaTheme;

/**
 * Kiosa topbar CSS. Include in every kiosa route <head>.
 */
export function getKiosaTopbarCSS(): string {
  return `
.kiosa-topbar {
  background: ${c.backgroundSecondary};
  border-bottom: 1px solid ${c.border};
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 100;
  -webkit-app-region: drag;
}
.kiosa-topbar a,
.kiosa-topbar button,
.kiosa-topbar input,
.kiosa-topbar .kiosa-topbar__right,
.kiosa-topbar .kiosa-topbar__chips {
  -webkit-app-region: no-drag;
}
.kiosa-topbar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: ${c.textPrimary};
}
.kiosa-topbar__glyph {
  width: 12px;
  height: 12px;
  background: var(--kiosa-accent, ${c.accent});
  transform: rotate(45deg);
  flex-shrink: 0;
  box-shadow: 0 0 10px var(--kiosa-accent, ${c.accent});
}
.kiosa-topbar__title {
  font-family: ${t.fonts.primary};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.55em;
  text-transform: uppercase;
}
.kiosa-topbar__meta {
  font-family: ${t.fonts.mono};
  font-size: 10px;
  color: ${c.textSecondary};
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.kiosa-topbar__chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.kiosa-topbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.kiosa-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid ${c.border};
  padding: 0 14px;
  background: ${c.background};
}
.kiosa-tabs a {
  display: block;
  padding: 10px 12px;
  font-family: ${t.fonts.mono};
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${c.textSecondary};
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.kiosa-tabs a:hover {
  color: ${c.textPrimary};
}
.kiosa-tabs a[aria-current="page"] {
  color: var(--kiosa-accent, ${c.accent});
  border-bottom-color: var(--kiosa-accent, ${c.accent});
}
.kiosa-wrap {
  max-width: 1320px;
  margin: 0 auto;
  padding: 14px;
}
.kiosa-grid {
  display: grid;
  grid-template-columns: 2fr minmax(280px, 1fr);
  gap: 10px;
}
.kiosa-grid--single {
  grid-template-columns: 1fr;
}
.kiosa-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.kiosa-grid--4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.kiosa-bottom {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.kiosa-footer {
  margin-top: 40px;
  border-top: 1px solid ${c.border};
  padding-top: 12px;
  display: flex;
  justify-content: space-between;
  font-family: ${t.fonts.mono};
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${c.textTertiary};
}
@media (max-width: 900px) {
  .kiosa-grid,
  .kiosa-grid--3,
  .kiosa-grid--4,
  .kiosa-bottom {
    grid-template-columns: 1fr;
  }
  .kiosa-topbar {
    flex-wrap: wrap;
  }
}
`;
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
  accent: KiosaAccentName;
  chips?: string[];
  tabs?: { label: string; href: string; active?: boolean }[];
  rightMeta?: string;
}

/**
 * Render the kiosa topbar HTML.
 */
export function getKiosaTopbarHTML(options: TopbarOptions): string {
  const accentHex = kiosaVisualTokens.colors.accents[options.accent];
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
<style>
  :root { --kiosa-accent: ${accentHex}; }
</style>
<div class="kiosa-topbar">
  <a href="/" class="kiosa-topbar__brand" aria-label="Home">
    <span class="kiosa-topbar__glyph"></span>
    <span class="kiosa-topbar__title">${escapeHtml(options.title)}</span>
  </a>
  ${options.subtitle ? `<span class="kiosa-topbar__meta">${escapeHtml(options.subtitle)}</span>` : ""}
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
  tagColor: string,
  score: string,
): string {
  const idx = String(index).padStart(3, "0");
  return `
<div class="kiosa-rank-row" style="display:grid;grid-template-columns:44px 1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed ${c.border};font-family:${t.fonts.mono};font-size:12px;">
  <span style="color:${c.textTertiary};">#${idx}</span>
  <span class="kiosa-tag" style="display:inline-block;font-size:10px;letter-spacing:.12em;padding:2px 8px;border-radius:2px;border:1px solid ${tagColor}55;color:${tagColor};justify-self:start;">${escapeHtml(tag)}</span>
  <span style="text-align:right;color:${c.textPrimary};">${escapeHtml(score)}</span>
</div>`;
}

/**
 * Kiosa exec / event log entry.
 */
export function getKiosaLogHTML(index: number, text: string, ok = true): string {
  const idx = String(index).padStart(4, "0");
  return `
<div class="kiosa-log" style="display:flex;gap:8px;font-family:${t.fonts.mono};font-size:11px;line-height:1.7;color:${c.textSecondary};">
  <span style="color:${c.textTertiary};min-width:40px;">${idx}</span>
  <span style="flex:1;color:${c.textSecondary};">&gt; ${escapeHtml(text)}</span>
  ${ok ? `<span style="color:var(--kiosa-accent,${c.accent});">[ok]</span>` : ""}
</div>`;
}

/**
 * Kiosa uplink bar.
 */
export function getKiosaUplinkHTML(label: string, pct: number, value: string): string {
  return `
<div style="display:grid;grid-template-columns:110px 1fr 70px;gap:10px;align-items:center;margin:6px 0;font-family:${t.fonts.mono};font-size:10px;letter-spacing:.1em;">
  <span style="color:${c.textSecondary};">${escapeHtml(label)}</span>
  <div style="height:6px;background:rgba(255,255,255,.07);border-radius:1px;overflow:hidden;">
    <i style="display:block;height:100%;width:${pct}%;background:var(--kiosa-accent,${c.accent});box-shadow:0 0 8px var(--kiosa-accent,${c.accent});transition:width .6s ease;"></i>
  </div>
  <span style="text-align:right;color:${c.textPrimary};">${escapeHtml(value)}</span>
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
    .map(
      (h) =>
        `<i style="flex:1;height:${h}%;background:var(--kiosa-accent,${c.accent});opacity:.75;transition:height .25s ease;border-radius:1px;"></i>`,
    )
    .join("");
  return `
<div style="display:flex;align-items:flex-end;gap:2px;height:64px;padding:8px 0;">
  ${barsHtml}
</div>`;
}

/**
 * Kiosa scan acquire strip.
 */
export function getKiosaScanHTML(pct: number, meta: string): string {
  const lit = Math.round((pct / 100) * 24);
  const segments = Array.from({ length: 24 }, (_, i) => {
    const isLit = i < lit;
    return `<i style="flex:1;height:10px;border-radius:1px;background:${isLit ? `var(--kiosa-accent,${c.accent})` : "rgba(255,255,255,.08)"};${isLit ? `box-shadow:0 0 6px var(--kiosa-accent,${c.accent});` : ""}"></i>`;
  }).join("");
  return `
<div style="font-family:${t.fonts.mono};margin:8px 0;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px;">
    <span style="font-size:11px;letter-spacing:.22em;color:var(--kiosa-accent,${c.accent});">SCAN ACQUIRE</span>
    <span style="font-size:10px;color:${c.textTertiary};">${escapeHtml(meta)}</span>
  </div>
  <div style="display:flex;gap:3px;">${segments}</div>
</div>`;
}

/**
 * Kiosa hero wireframe visualization placeholder.
 */
export function getKiosaWireframeHTML(caption: string): string {
  return `
<div style="border:1px dashed ${c.border};border-radius:3px;padding:16px;display:flex;align-items:center;justify-content:center;min-height:180px;position:relative;overflow:hidden;font-family:${t.fonts.mono};">
  <svg width="100%" height="160" viewBox="0 0 320 160" style="stroke:var(--kiosa-accent,${c.accent});stroke-width:1.2;fill:none;filter:drop-shadow(0 0 6px color-mix(in srgb, var(--kiosa-accent,${c.accent}) 45%, transparent));">
    <rect x="80" y="40" width="160" height="80" stroke-dasharray="4 4" />
    <line x1="80" y1="120" x2="160" y2="160" />
    <line x1="240" y1="120" x2="160" y2="160" />
    <line x1="80" y1="40" x2="160" y2="0" />
    <line x1="240" y1="40" x2="160" y2="0" />
    <circle cx="160" cy="80" r="28" />
    <path d="M120 80 Q160 40 200 80 T120 80" opacity="0.5" />
  </svg>
  <div style="position:absolute;bottom:8px;left:10px;font-size:10px;letter-spacing:.12em;color:${c.textTertiary};">${escapeHtml(caption)}</div>
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

/**
 * Convenience: build the standard kiosa <head> assets for a route.
 */
export function getKiosaHeadHTML(accent: KiosaAccentName): string {
  return `
${getKiosaFontLinkCSS()}
<style>
  :root { --kiosa-accent: ${kiosaVisualTokens.colors.accents[accent]}; }
</style>`;
}
