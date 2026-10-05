/**
 * Renders the per-artifact dashboard page, styled consistently with the rest
 * of Ronin's dashboards (see duties/db-cleanup.ts's handleCleanupUI for the
 * same theme-helper pattern).
 */

import { kiosaTheme } from "../utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../utils/kiosa.js";
import { calculateCompletion } from "./types.js";
import type { ArtifactFile } from "./types.js";
import { isImageAsset } from "./storage.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProgressBars(assets: ArtifactFile["metadata"]["assets"]): string {
  const categories = Object.values(assets);
  if (categories.length === 0) return `<p style="font-family:${kiosaTheme.fonts.mono};font-size:11px;color:${kiosaTheme.colors.textSecondary};">No asset categories tracked yet.</p>`;
  return categories
    .map((a) => {
      const pct = a.target > 0 ? Math.min(100, Math.round((a.collected / a.target) * 100)) : 100;
      return `<div class="stat">
        <strong style="font-family:${kiosaTheme.fonts.primary};font-size:11px;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(a.category)}</strong>
        <div style="font-size:10px;color:${kiosaTheme.colors.textSecondary};margin-top:4px;">${a.collected} / ${a.target} (${a.pending} pending)</div>
        <div style="background:${kiosaTheme.colors.backgroundTertiary};border-radius:2px;overflow:hidden;height:6px;margin-top:6px;">
          <div style="background:${kiosaTheme.colors.success};width:${pct}%;height:100%;box-shadow:0 0 6px ${kiosaTheme.colors.success};"></div>
        </div>
      </div>`;
    })
    .join("");
}

function renderActivityLog(logs: ArtifactFile["logs"]): string {
  if (logs.length === 0) return `<p style="font-family:${kiosaTheme.fonts.mono};font-size:11px;color:${kiosaTheme.colors.textSecondary};">No activity yet.</p>`;
  return `<ul style="font-family:${kiosaTheme.fonts.mono};font-size:11px;color:${kiosaTheme.colors.textSecondary};padding-left:0;list-style:none;">${logs
    .slice(0, 20)
    .map((l) => `<li style="border-bottom:1px dashed ${kiosaTheme.colors.border};padding:6px 0;"><span style="color:${kiosaTheme.colors.textTertiary};">${escapeHtml(l.timestamp)}</span> · <strong style="color:${kiosaTheme.colors.textPrimary};">${escapeHtml(l.action)}</strong> — ${escapeHtml(l.details)}</li>`)
    .join("")}</ul>`;
}

function renderAssetRecords(artifactId: string, records: ArtifactFile["assetRecords"]): string {
  if (records.length === 0) return `<p>No assets collected yet.</p>`;

  const images = records.filter((r) => r.storedPath && isImageAsset(r.storedPath));
  const others = records.filter((r) => !(r.storedPath && isImageAsset(r.storedPath)));

  const gallery =
    images.length > 0
      ? `<div class="stats">${images
          .slice(0, 24)
          .map((r) => {
            const url = `/api/artifact/${artifactId}/asset/${encodeURIComponent(r.storedPath!)}`;
            return `<a href="${url}" target="_blank" rel="noopener" style="text-decoration:none;color:${kiosaTheme.colors.textSecondary};font-family:${kiosaTheme.fonts.mono};font-size:10px;">
              <img src="${url}" alt="${escapeHtml(r.filename)}" style="width:100%;border-radius:2px;display:block;border:1px solid ${kiosaTheme.colors.border};" />
              <div style="font-size:10px;margin-top:4px;letter-spacing:.04em;">${escapeHtml(r.filename)}</div>
            </a>`;
          })
          .join("")}</div>`
      : "";

  const list =
    others.length > 0
      ? `<ul>${others
          .slice(0, 50)
          .map((r) => {
            const stored = r.storedPath
              ? ` — <a href="/api/artifact/${artifactId}/asset/${encodeURIComponent(r.storedPath)}">download</a>`
              : "";
            return `<li style="border-bottom:1px dashed ${kiosaTheme.colors.border};padding:6px 0;">[${escapeHtml(r.type)}] ${escapeHtml(r.filename)} — from ${escapeHtml(r.source)}${r.license ? ` (${escapeHtml(r.license)})` : ""}${stored}</li>`;
          })
          .join("")}</ul>`
      : "";

  return gallery + list;
}

export function generateIndexHTML(artifact: ArtifactFile): string {
  const meta = artifact.metadata;
  const completion = calculateCompletion(meta.assets);
  const statusClass = completion >= meta.completionThreshold ? "complete" : completion >= 50 ? "in-progress" : "early";
  const accent = getKiosaAccentForPath("/artifacts");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.name)}</title>
  ${getKiosaStylesheetLink(accent)}
  <style>
    body { margin: 0; }
    .kiosa-page { max-width: 900px; margin: 0 auto; padding: 22px; }
    .kiosa-card { border: 1px solid ${kiosaTheme.colors.border}; border-radius: 3px; padding: 12px; margin-bottom: 10px; background: ${kiosaTheme.colors.backgroundSecondary}; font-family: ${kiosaTheme.fonts.mono}; }
    .kiosa-card h3 { font-family: ${kiosaTheme.fonts.primary}; font-size: 14px; letter-spacing: .06em; margin: 0 0 10px 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px,1fr)); gap: 10px; }
    .stat { padding: 10px; border: 1px solid ${kiosaTheme.colors.border}; border-radius: 3px; background: ${kiosaTheme.colors.background}; }
    .kiosa-badge { display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; margin-left:8px; letter-spacing:.1em; text-transform:uppercase; border:1px solid; }
    .kiosa-badge.complete { border-color: color-mix(in srgb, ${kiosaTheme.colors.success} 50%, transparent); color: ${kiosaTheme.colors.success}; background: color-mix(in srgb, ${kiosaTheme.colors.success} 10%, transparent); }
    .kiosa-badge.in-progress { border-color: color-mix(in srgb, ${kiosaTheme.colors.warning} 50%, transparent); color: ${kiosaTheme.colors.warning}; background: color-mix(in srgb, ${kiosaTheme.colors.warning} 10%, transparent); }
    .kiosa-badge.early { border-color: ${kiosaTheme.colors.border}; color: ${kiosaTheme.colors.textSecondary}; background: ${kiosaTheme.colors.backgroundTertiary}; }
    ul { padding-left: 0; list-style: none; }
    li { margin-bottom: 0; }
    .meta-row { margin-bottom: 6px; font-size: 11px; color: ${kiosaTheme.colors.textSecondary}; }
    .meta-row strong { color: ${kiosaTheme.colors.textPrimary}; }
  </style>
</head>
<body>
  ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "ARTIFACT / " + meta.name.toUpperCase(), chips: [`COMPLETION ${completion}%`] })}
  <div class="kiosa-page">
    <div class="kiosa-card">
      <div class="meta-row"><strong>STATE:</strong> ${escapeHtml(meta.state)}</div>
      <div class="meta-row"><strong>TYPE:</strong> ${escapeHtml(meta.type)}</div>
      ${meta.description ? `<div class="meta-row"><strong>DESCRIPTION:</strong> ${escapeHtml(meta.description)}</div>` : ""}
      ${meta.tags.length > 0 ? `<div class="meta-row"><strong>TAGS:</strong> ${meta.tags.map(escapeHtml).join(", ")}</div>` : ""}
      <div class="meta-row"><strong>UPDATED:</strong> ${escapeHtml(meta.updated)}</div>
    </div>
    <div class="kiosa-card">
      <h3>PROGRESS</h3>
      <div class="stats">${renderProgressBars(meta.assets)}</div>
    </div>
    <div class="kiosa-card">
      <h3>COLLECTED ASSETS</h3>
      ${renderAssetRecords(meta.id, artifact.assetRecords)}
    </div>
    <div class="kiosa-card">
      <h3>ACTIVITY LOG</h3>
      ${renderActivityLog(artifact.logs)}
    </div>
    ${getKiosaFooterHTML("RONIN · ARTIFACT", `COMPLETION ${completion}% · ${statusClass.toUpperCase()}`)}
  </div>
</body>
</html>`;
}
