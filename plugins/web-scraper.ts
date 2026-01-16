import type { Plugin } from "../src/plugins/base.js";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

export type ScrapeToMarkdownOptions = {
  /** Optional guidance for extraction or filtering; kept generic on purpose. */
  instructions?: string;
  /** Optional CSS selector to target the main content area. */
  selector?: string;
  /** Include images as markdown links (default: true). */
  includeImages?: boolean;
  /** Request timeout in ms (default: 20000). */
  timeoutMs?: number;
  /** Custom user agent (default: Ronin-WebScraper/1.0). */
  userAgent?: string;
};

type ScrapeToMarkdownResult = {
  url: string;
  finalUrl: string;
  title?: string;
  markdown: string;
  images: string[];
  links: string[];
};

function absolutize(baseUrl: string, maybeUrl: string): string | null {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function stripNoise($: cheerio.CheerioAPI): void {
  $(
    [
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "nav",
      "header",
      "footer",
      "form",
      ".cookie",
      ".cookie-banner",
      ".cookie-consent",
      ".ad",
      ".ads",
      ".advert",
      ".advertisement",
      ".newsletter",
      ".subscribe",
    ].join(",")
  ).remove();
}

function makeTurndown(baseUrl: string, images: Set<string>): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**",
  });

  // Convert images to markdown and capture absolute URLs
  turndown.addRule("imageLinks", {
    filter: (node) => node.nodeName === "IMG",
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src =
        el.getAttribute("src") ||
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        "";
      const alt = (el.getAttribute("alt") || "Image").trim() || "Image";
      const abs = src ? absolutize(baseUrl, src) : null;
      if (!abs) return "";
      images.add(abs);
      return `![${alt}](${abs})`;
    },
  });

  // Prefer absolute links in markdown
  turndown.addRule("absoluteLinks", {
    filter: (node) => node.nodeName === "A",
    replacement: (content, node) => {
      const el = node as HTMLElement;
      const href = el.getAttribute("href") || "";
      const abs = href ? absolutize(baseUrl, href) : null;
      if (!abs) return content;
      const text = content.trim() || abs;
      return `[${text}](${abs})`;
    },
  });

  return turndown;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scrapeToMarkdown(
  url: string,
  options: ScrapeToMarkdownOptions = {}
): Promise<ScrapeToMarkdownResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const includeImages = options.includeImages ?? true;
  const userAgent = options.userAgent || "Ronin-WebScraper/1.0 (personal use)";

  const res = await fetchWithTimeout(url, timeoutMs, {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const finalUrl = res.url || url;
  const html = await res.text();
  const $ = cheerio.load(html);
  stripNoise($);

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().trim() ||
    undefined;

  const images = new Set<string>();
  const links = new Set<string>();

  // Collect links (absolute)
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = absolutize(finalUrl, href);
    if (abs) links.add(abs);
  });

  const selector = options.selector?.trim();
  const root =
    (selector && $(selector).first()) ||
    $("main").first() ||
    $("article").first() ||
    $(".content").first() ||
    $("body").first();

  // If we disable images, remove <img> tags before conversion.
  if (!includeImages) {
    root.find("img").remove();
  }

  const turndown = makeTurndown(finalUrl, images);
  const markdown = turndown.turndown(root.html() || "");

  // Tiny hook: if instructions exist, prepend them as a blockquote for traceability.
  // (Filtering/interpretation should live in the agent.)
  const instructions = options.instructions?.trim();
  const finalMarkdown = instructions
    ? `> Instructions: ${instructions}\n\n${markdown}`.trim()
    : markdown.trim();

  return {
    url,
    finalUrl,
    title,
    markdown: finalMarkdown || "(No meaningful content extracted)",
    images: Array.from(images),
    links: Array.from(links),
  };
}

const webScraperPlugin: Plugin = {
  // Use a short, ergonomic name so tool calling becomes `scrape_to_markdown`.
  name: "scrape",
  description: "Fetch a URL and convert HTML to clean Markdown (images preserved as markdown links)",
  methods: {
    scrape_to_markdown: async (url: string, options?: ScrapeToMarkdownOptions) => {
      return await scrapeToMarkdown(url, options || {});
    },
  },
};

export default webScraperPlugin;

