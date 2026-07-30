/**
 * Renders the per-artifact dashboard page, styled consistently with the rest
 * of Ronin's dashboards (see duties/db-cleanup.ts's handleCleanupUI for the
 * same theme-helper pattern).
 */

import { getAdobeCleanFontFaceCSS, getHeaderBarCSS, getHeaderHomeIconHTML, getThemeCSS } from "../utils/theme.js";
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
  if (categories.length === 0) return `<p>No asset categories tracked yet.</p>`;
  return categories
    .map((a) => {
      const pct = a.target > 0 ? Math.min(100, Math.round((a.collected / a.target) * 100)) : 100;
      return `<div class="stat">
        <strong>${escapeHtml(a.category)}</strong>
        <div>${a.collected} / ${a.target} (${a.pending} pending)</div>
        <div style="background:#151515;border-radius:4px;overflow:hidden;height:8px;margin-top:.4rem;">
          <div style="background:#4caf7d;width:${pct}%;height:100%;"></div>
        </div>
      </div>`;
    })
    .join("");
}

function renderActivityLog(logs: ArtifactFile["logs"]): string {
  if (logs.length === 0) return `<p>No activity yet.</p>`;
  return `<ul>${logs
    .slice(0, 20)
    .map((l) => `<li><strong>${escapeHtml(l.action)}</strong> — ${escapeHtml(l.details)} <em>(${escapeHtml(l.timestamp)})</em></li>`)
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
            return `<a href="${url}" target="_blank" rel="noopener">
              <img src="${url}" alt="${escapeHtml(r.filename)}" style="width:100%;border-radius:6px;display:block;" />
              <div style="font-size:.8rem;margin-top:.3rem;">${escapeHtml(r.filename)}</div>
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
            return `<li>[${escapeHtml(r.type)}] ${escapeHtml(r.filename)} — from ${escapeHtml(r.source)}${r.license ? ` (${escapeHtml(r.license)})` : ""}${stored}</li>`;
          })
          .join("")}</ul>`
      : "";

  return gallery + list;
}

export function generateIndexHTML(artifact: ArtifactFile): string {
  const meta = artifact.metadata;
  const completion = calculateCompletion(meta.assets);
  const statusClass = completion >= meta.completionThreshold ? "complete" : completion >= 50 ? "in-progress" : "early";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.name)}</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    body { margin: 0; }
    .page { max-width: 900px; margin: 0 auto; padding: 1rem; }
    .card { border: 1px solid #333; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: #1f1f1f; }
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px,1fr)); gap: .75rem; }
    .stat { padding: .75rem; border: 1px solid #333; border-radius: 6px; background: #151515; }
    .badge { display:inline-block; padding:.2rem .6rem; border-radius:999px; font-size:.85rem; margin-left:.5rem; }
    .badge.complete { background:#1f6b3f; color:#d8ffe6; }
    .badge.in-progress { background:#6b5a1f; color:#fff3d6; }
    .badge.early { background:#3a3a3a; color:#ddd; }
    ul { padding-left: 1.2rem; }
    li { margin-bottom: .3rem; }
  </style>
</head>
<body>
  <div class="header">${getHeaderHomeIconHTML()}<h1>${escapeHtml(meta.name)}<span class="badge ${statusClass}">${completion}%</span></h1></div>
  <div class="page">
    <div class="card">
      <div><strong>State:</strong> ${escapeHtml(meta.state)}</div>
      <div><strong>Type:</strong> ${escapeHtml(meta.type)}</div>
      ${meta.description ? `<div><strong>Description:</strong> ${escapeHtml(meta.description)}</div>` : ""}
      ${meta.tags.length > 0 ? `<div><strong>Tags:</strong> ${meta.tags.map(escapeHtml).join(", ")}</div>` : ""}
      <div><strong>Updated:</strong> ${escapeHtml(meta.updated)}</div>
    </div>
    <div class="card">
      <h3>Progress</h3>
      <div class="stats">${renderProgressBars(meta.assets)}</div>
    </div>
    <div class="card">
      <h3>Collected Assets</h3>
      ${renderAssetRecords(meta.id, artifact.assetRecords)}
    </div>
    <div class="card">
      <h3>Activity Log</h3>
      ${renderActivityLog(artifact.logs)}
    </div>
    <div class="card">
      <em>Generated ${new Date().toLocaleString()}</em>
    </div>
  </div>
</body>
</html>`;
}
