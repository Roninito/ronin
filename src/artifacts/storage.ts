/**
 * Binary asset storage for Artifacts (screenshots, PDFs, downloaded files).
 * Structured artifact data lives in SQLite (see store.ts); this handles the
 * one thing SQLite is a poor fit for — actual file bytes — via a small
 * per-artifact directory under the existing system.dataDir convention
 * (same root already used elsewhere in Ronin, e.g. ~/.ronin/data).
 */

import { existsSync, mkdirSync } from "fs";
import { join, resolve, sep } from "path";
import type { DutyAPI } from "../types/index.js";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function getArtifactsRoot(api: DutyAPI): string {
  const dataDir = api.config.getSystem().dataDir;
  return join(dataDir, "artifacts");
}

export function getArtifactAssetsDir(api: DutyAPI, artifactId: string): string {
  const dir = join(getArtifactsRoot(api), artifactId, "assets");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Strips any path components, keeping only the basename, so a caller-supplied
 * filename can never escape the artifact's assets directory.
 */
export function sanitizeAssetFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/^\.+/, "").trim();
  if (!cleaned) throw new Error(`Invalid asset filename: ${filename}`);
  return cleaned;
}

/**
 * Resolves a caller-supplied storedPath to an absolute path inside the
 * artifact's assets directory, defense-in-depth checked to ensure the
 * resolved path never escapes that directory.
 */
export function resolveStoredAssetPath(api: DutyAPI, artifactId: string, storedPath: string): string {
  const dir = resolve(getArtifactAssetsDir(api, artifactId));
  const safeName = sanitizeAssetFilename(storedPath);
  const resolved = resolve(dir, safeName);
  if (!resolved.startsWith(dir + sep)) {
    throw new Error(`Resolved asset path escapes artifact assets directory: ${storedPath}`);
  }
  return resolved;
}

export function assetFileExists(api: DutyAPI, artifactId: string, storedPath: string): boolean {
  try {
    return existsSync(resolveStoredAssetPath(api, artifactId, storedPath));
  } catch {
    return false;
  }
}

export function guessMimeType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function isImageAsset(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}
