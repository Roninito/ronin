import type { Plugin } from "../src/plugins/base.js";
import WebTorrent from "webtorrent";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync } from "fs";

// TypeScript interfaces
interface TorrentSearchResult {
  title: string;
  magnet: string;
  size: string;
  seeders: number;
  leechers: number;
  uploadDate: string;
  category: string;
  url: string;
}

interface TorrentStatus {
  infoHash: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
  timeRemaining: number;
  peers: number;
  length: number;
  ready: boolean;
  done: boolean;
}

interface TorrentAddResult {
  infoHash: string;
  name: string;
  status: TorrentStatus;
}

// Singleton WebTorrent client
let client: WebTorrent.Instance | null = null;

function getClient(): WebTorrent.Instance {
  if (!client) {
    client = new WebTorrent();
  }
  return client;
}

// Ensure download directory exists
function ensureDownloadDir(downloadPath: string): void {
  if (!existsSync(downloadPath)) {
    mkdirSync(downloadPath, { recursive: true });
  }
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

// Parse size string to bytes
function parseSize(sizeStr: string): number {
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase() || "B";
  return value * (units[unit] || 1);
}

// Fetch with timeout and user agent
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 20000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Scrape 1337x search results
async function search1337x(
  query: string,
  limit: number = 20
): Promise<TorrentSearchResult[]> {
  try {
    const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
    const response = await fetchWithTimeout(searchUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching search results`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results: TorrentSearchResult[] = [];

    // 1337x uses a table structure for search results
    $("table.table-list tbody tr").each((index, element) => {
      if (results.length >= limit) return false; // Stop iterating

      const $row = $(element);
      const $nameCell = $row.find("td.name a:last-child");
      const title = $nameCell.text().trim();
      const detailUrl = $nameCell.attr("href");

      if (!title || !detailUrl) return;

      const size = $row.find("td.size").text().trim();
      const seeders = parseInt($row.find("td.seeds").text().trim()) || 0;
      const leechers = parseInt($row.find("td.leeches").text().trim()) || 0;
      const uploadDate = $row.find("td.coll-date").text().trim();
      const category = $row.find("td.coll-1 a").text().trim();

      // We need to fetch the detail page to get the magnet link
      // For now, we'll return the detail URL and fetch magnet in a separate step
      results.push({
        title,
        magnet: "", // Will be populated when fetching detail page
        size,
        seeders,
        leechers,
        uploadDate,
        category,
        url: detailUrl.startsWith("http")
          ? detailUrl
          : `https://1337x.to${detailUrl}`,
      });
    });

    // Fetch magnet links from detail pages (limit to first 5 to avoid rate limiting)
    const detailLimit = Math.min(results.length, 5);
    for (let i = 0; i < detailLimit; i++) {
      try {
        const detailResponse = await fetchWithTimeout(results[i].url);
        if (detailResponse.ok) {
          const detailHtml = await detailResponse.text();
          const $detail = cheerio.load(detailHtml);

          // Find magnet link
          const magnetLink = $detail('a[href^="magnet:"]').attr("href");
          if (magnetLink) {
            results[i].magnet = magnetLink;
          }

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.warn(`Failed to fetch magnet for ${results[i].title}:`, error);
      }
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to search 1337x: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Get torrent status from WebTorrent torrent object
function getTorrentStatus(torrent: WebTorrent.Torrent): TorrentStatus {
  const progress = torrent.progress;
  const downloadSpeed = torrent.downloadSpeed || 0;
  const uploadSpeed = torrent.uploadSpeed || 0;
  const downloaded = torrent.downloaded || 0;
  const uploaded = torrent.uploaded || 0;
  const peers = torrent.numPeers || 0;
  const length = torrent.length || 0;

  let timeRemaining = Infinity;
  if (downloadSpeed > 0 && !torrent.done) {
    const remaining = length - downloaded;
    timeRemaining = Math.floor(remaining / downloadSpeed);
  }

  return {
    infoHash: torrent.infoHash,
    name: torrent.name || "Unknown",
    progress: Math.round(progress * 100 * 100) / 100, // Percentage with 2 decimals
    downloadSpeed,
    uploadSpeed,
    downloaded,
    uploaded,
    timeRemaining: timeRemaining === Infinity ? -1 : timeRemaining,
    peers,
    length,
    ready: torrent.ready,
    done: torrent.done,
  };
}

/**
 * Torrent plugin for searching, downloading, and managing torrents
 */
const torrentPlugin: Plugin = {
  name: "torrent",
  description:
    "Search torrents on 1337x, download via magnet links, and manage active downloads",
  methods: {
    /**
     * Search for torrents on 1337x
     */
    search: async (
      query: string,
      options?: { site?: string; limit?: number }
    ): Promise<TorrentSearchResult[]> => {
      try {
        const limit = options?.limit || 20;
        const site = options?.site || "1337x";

        if (site !== "1337x") {
          throw new Error(`Unsupported site: ${site}. Only 1337x is currently supported.`);
        }

        return await search1337x(query, limit);
      } catch (error) {
        throw new Error(
          `Torrent search failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Add a torrent via magnet link or .torrent file path
     */
    add: async (
      magnetOrPath: string,
      options?: { downloadPath?: string }
    ): Promise<TorrentAddResult> => {
      try {
        const downloadPath = options?.downloadPath || "./downloads";
        ensureDownloadDir(downloadPath);

        const torrentClient = getClient();

        return new Promise((resolve, reject) => {
          torrentClient.add(
            magnetOrPath,
            { path: downloadPath },
            (torrent) => {
              // Wait for metadata to be ready
              torrent.on("ready", () => {
                const status = getTorrentStatus(torrent);
                resolve({
                  infoHash: torrent.infoHash,
                  name: torrent.name || "Unknown",
                  status,
                });
              });

              torrent.on("error", (error) => {
                reject(
                  new Error(
                    `Torrent error: ${error instanceof Error ? error.message : String(error)}`
                  )
                );
              });
            }
          );

          // Handle client-level errors
          torrentClient.on("error", (error) => {
            reject(
              new Error(
                `WebTorrent client error: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          });
        });
      } catch (error) {
        throw new Error(
          `Failed to add torrent: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * List all active torrents
     */
    list: async (): Promise<TorrentStatus[]> => {
      try {
        const torrentClient = getClient();
        return torrentClient.torrents.map((torrent) =>
          getTorrentStatus(torrent)
        );
      } catch (error) {
        throw new Error(
          `Failed to list torrents: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get status for a specific torrent
     */
    status: async (infoHash: string): Promise<TorrentStatus> => {
      try {
        const torrentClient = getClient();
        const torrent = torrentClient.get(infoHash);

        if (!torrent) {
          throw new Error(`Torrent not found: ${infoHash}`);
        }

        return getTorrentStatus(torrent);
      } catch (error) {
        throw new Error(
          `Failed to get torrent status: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Pause a torrent download
     */
    pause: async (infoHash: string): Promise<{ success: boolean; message: string }> => {
      try {
        const torrentClient = getClient();
        const torrent = torrentClient.get(infoHash);

        if (!torrent) {
          throw new Error(`Torrent not found: ${infoHash}`);
        }

        torrent.pause();
        return { success: true, message: `Torrent ${infoHash} paused` };
      } catch (error) {
        throw new Error(
          `Failed to pause torrent: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Resume a paused torrent
     */
    resume: async (infoHash: string): Promise<{ success: boolean; message: string }> => {
      try {
        const torrentClient = getClient();
        const torrent = torrentClient.get(infoHash);

        if (!torrent) {
          throw new Error(`Torrent not found: ${infoHash}`);
        }

        torrent.resume();
        return { success: true, message: `Torrent ${infoHash} resumed` };
      } catch (error) {
        throw new Error(
          `Failed to resume torrent: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Remove a torrent from the client
     */
    remove: async (
      infoHash: string,
      options?: { removeFiles?: boolean }
    ): Promise<{ success: boolean; message: string }> => {
      try {
        const torrentClient = getClient();
        const torrent = torrentClient.get(infoHash);

        if (!torrent) {
          throw new Error(`Torrent not found: ${infoHash}`);
        }

        const removeFiles = options?.removeFiles || false;
        torrentClient.remove(torrent, { destroyStore: removeFiles });

        return {
          success: true,
          message: `Torrent ${infoHash} removed${removeFiles ? " (files deleted)" : ""}`,
        };
      } catch (error) {
        throw new Error(
          `Failed to remove torrent: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  },
};

export default torrentPlugin;
