// utils.ts
import { parse as parseURL } from "node:url";
import { DOMParser } from "linkedom";
import { getDomain } from "tldts";

const HARD_EXCLUDES = [
  "https://www.artadvisors.org/art-advisor-directory",
];

const BANNED_HOSTS = new Set([
  "artadvisors.org",
  "aboutus.com",
  "allbiz.com",
  "trustpilot.com",
  "mapquest.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com"
]);

export type SourceType = "website" | "press" | "project" | "images" | "article";

/** Canonicalize URL (https, strip tracking params/fragments) */
export function canonicalize(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = "https:";
    u.hash = "";
    const tracking = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    tracking.forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return raw;
  }
}

export function isHardExcluded(url: string): boolean {
  const c = canonicalize(url);
  if (HARD_EXCLUDES.some(x => c.startsWith(x))) return true;
  try {
    const host = new URL(c).hostname.toLowerCase();
    return BANNED_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Simple heuristic classifier based on URL + domain */
export function classify(url: string, title?: string, metaSiteName?: string): SourceType | null {
  const host = safeHost(url);
  const d = getDomain(host ?? "") || host || "";
  const path = url.toLowerCase();

  if (/museum|gallery|foundation|university|collection/.test(d) && /exhibition|project|artist|profile/.test(path))
    return "project";
  if (/nytimes|wsj|artnews|artforum|ft\.com|newyorker|theguardian|bloomberg|forbes/.test(d))
    return "article";
  if (/press|newsroom|press-release|media/.test(path))
    return "press";
  if (/image|photo|media|collection\/images/.test(path))
    return "images";
  if (/about|team|people|advis/.test(path) || /official|homepage/i.test(`${title} ${metaSiteName}`))
    return "website";

  if (/\.org$|\.edu$/.test(d)) return "project";
  return "article";
}

/** Human-readable label based on source type */
export function selectLabel(kind: SourceType, title?: string, url?: string): string {
  switch (kind) {
    case "website": return "Official site";
    case "press": return "Press release";
    case "project": return "Project page";
    case "images": return "Image resource";
    case "article": return /interview|q&a|conversation/i.test(title ?? "") ? "Interview article" : "Article";
  }
}

/** Short rationale, <= 140 chars */
export function shortNotes(kind: SourceType, domain: string): string {
  const base = {
    website: "Authoritative profile",
    press: "Institutional press source",
    project: "Official project/exhibition page",
    images: "Institutional media/images",
    article: "Credible media coverage"
  }[kind];
  const msg = `${base} (${domain})`;
  return msg.length <= 140 ? msg : msg.slice(0, 137) + "...";
}

/** Extract ISO date from HTML (meta tags, <time>, fallback regex) */
export function extractPublishedAt(html: string): string | null {
  try {
    const { document } = new DOMParser().parseFromString(html, "text/html");
    const og = document.querySelector('meta[property="article:published_time"]')?.getAttribute("content")
      || document.querySelector('meta[name="pubdate"]')?.getAttribute("content")
      || document.querySelector('meta[name="date"]')?.getAttribute("content");

    if (og && isoLike(og)) return new Date(og).toISOString();

    const timeEl = document.querySelector("time[datetime]")?.getAttribute("datetime");
    if (timeEl && isoLike(timeEl)) return new Date(timeEl).toISOString();

    const text = document.body?.textContent ?? "";
    const m = text.match(/\b(20\d{2}|19\d{2})[-/\.](0?[1-9]|1[0-2])[-/\.](0?[1-9]|[12]\d|3[01])\b/);
    if (m) return new Date(m[0]).toISOString();
  } catch {}
  return null;
}

function isoLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}
