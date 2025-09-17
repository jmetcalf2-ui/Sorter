// search.ts
import fetch from "node-fetch";

export type SerpItem = { title: string; link: string; snippet?: string };

/**
 * Build a small set of focused queries using name (+ optional firm/city).
 * Tweaked for art/collection/institutional authority.
 */
export function buildQueries(name?: string, firm?: string, city?: string): string[] {
  const n = (name ?? "").trim();
  const f = (firm ?? "").trim();
  const c = (city ?? "").trim();

  const parts: string[] = [];
  if (n) parts.push(`"${n}"`);
  if (f) parts.push(`"${f}"`);

  const base = [
    `${parts.join(" ")} art advisory`,
    `${parts.join(" ")} site:.org`,
    `${parts.join(" ")} museum profile`,
    `${parts.join(" ")} interview`,
    `${parts.join(" ")} collection`,
    `${n} (museum OR collection OR foundation OR gallery OR exhibition)`.trim()
  ];
  if (c) base.push(`${parts.join(" ")} ${c}`);

  // ensure unique, non-empty
  const seen = new Set<string>();
  return base
    .map(q => q.replace(/\s+/g, " ").trim())
    .filter(q => q.length > 0 && !seen.has(q) && seen.add(q));
}

/**
 * Query Serper (https://serper.dev) Web Search API.
 * Requires env SEARCH_API_KEY.
 */
export async function serpSearch(q: string, apiKey?: string): Promise<SerpItem[]> {
  const key = apiKey || process.env.SEARCH_API_KEY;
  if (!key) {
    console.warn("SEARCH_API_KEY is not set; serpSearch will return [].");
    return [];
  }

  const url = "https://serper.dev/api/search";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q,
        num: 10,            // up to 10 organic results
        gl: "us",           // geo
        hl: "en",           // language
        autocorrect: true
      }),
      // Give Serper a sensible timeout
      // @ts-ignore node-fetch typing doesn't include this but it's supported in v3
      timeout: 15000
    });

    if (!r.ok) {
      console.warn(`Serper response not OK (${r.status}) for q="${q}"`);
      return [];
    }
    const j: any = await r.json().catch(() => ({}));
    const organic = Array.isArray(j.organic) ? j.organic : [];

    return organic.map((o: any) => ({
      title: String(o.title || ""),
      link: String(o.link || o.url || ""),
      snippet: String(o.snippet || o.snippet_highlighted || o.description || "")
    })).filter(x => x.link);
  } catch (e) {
    console.warn("Serper error:", e);
    return [];
  }
}
