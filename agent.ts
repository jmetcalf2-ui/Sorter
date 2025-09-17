import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import pLimit from "p-limit";
import { serpSearch, buildQueries } from "./search.js";
import { canonicalize, isHardExcluded, classify, extractPublishedAt, selectLabel, shortNotes } from "./utils.js";
import { getDomain } from "tldts";

/**
 * Load secrets from environment variables
 * (Set these in GitHub Secrets or a local .env file)
 */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SEARCH_API_KEY = process.env.SEARCH_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SEARCH_API_KEY) {
  console.error("Missing required environment variables. Check SUPABASE_URL, SUPABASE_SERVICE_KEY, SEARCH_API_KEY.");
  process.exit(1);
}

const CONCURRENCY = parseInt(process.env.CONCURRENCY || "4");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

type Target = {
  lead_id: string;
  evidence_id: string;
  url: string | null;
  published_at: string | null;
  lead_name?: string | null;
  lead_firm?: string | null;
  lead_city?: string | null;
};

async function getTargets(): Promise<Target[]> {
  const { data, error } = await supabase.from("supplements_needing_links").select("*").limit(500);
  if (error) throw error;
  return data as Target[];
}

async function fetchLight(url: string): Promise<{html: string, title?: string, siteName?: string}> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SupplementsBot/1.0)" }
    });
    const html = await r.text();
    const title = (html.match(/<title>([^<]+)<\/title>/i)?.[1] || "").trim();
    const siteName = (html.match(/property=["']og:site_name["']\s+content=["']([^"']+)/i)?.[1] || "").trim();
    return { html, title, siteName };
  } catch {
    return { html: "" };
  }
}

async function upsertBatch(rows: any[]) {
  if (!rows.length) return;
  const { error } = await supabase
    .from("supplements_rows")
    .upsert(rows, { onConflict: "lead_id,evidence_id,url" });
  if (error) throw error;
}

async function processOne(t: Target) {
  const q = buildQueries(t.lead_name || "", t.lead_firm || "", t.lead_city || "");
  const seen = new Set<string>();
  const rows: any[] = [];

  for (const query of q) {
    const results = await serpSearch(query, SEARCH_API_KEY);
    for (const r of results) {
      let url = canonicalize(r.link);
      if (seen.has(url)) continue;
      seen.add(url);

      if (isHardExcluded(url)) continue;

      const domain = getDomain(url || "") || "";
      if (!domain) continue;

      const { html, title, siteName } = await fetchLight(url);
      const kind = classify(url, title, siteName);
      if (!kind) continue;

      const pub = html ? extractPublishedAt(html) : null;
      const label = selectLabel(kind, title, url);
      const notes = shortNotes(kind, domain);

      rows.push({
        lead_id: t.lead_id,
        evidence_id: t.evidence_id,
        url,
        source_type: kind,
        label,
        published_at: pub,
        notes
      });

      if (rows.filter(x => x.lead_id === t.lead_id && x.evidence_id === t.evidence_id).length >= 3) break;
    }
    if (rows.filter(x => x.lead_id === t.lead_id && x.evidence_id === t.evidence_id).length >= 3) break;
  }

  await upsertBatch(rows.slice(0, 3));
  return { inserted: rows.length };
}

export async function handler() {
  const runStart = Date.now();
  let success = 0, failures = 0;

  const targets = await getTargets();
  const limit = pLimit(CONCURRENCY);

  await Promise.all(targets.map(t => limit(async () => {
    try {
      const { inserted } = await processOne(t);
      success += inserted;
    } catch (e) {
      failures += 1;
      console.error("Error for lead", t.lead_id, e);
    }
  })));

  const ms = Date.now() - runStart;
  console.log(`Run completed: ${success} inserts, ${failures} failures in ${Math.round(ms / 1000)}s`);
}

if (import.meta.main) {
  handler().catch(e => {
    console.error("Fatal error", e);
    process.exit(1);
  });
}
