import os, asyncio, httpx
from supabase import create_client, Client
from tldts import get_domain
from utils import canonicalize, is_hard_excluded, classify, extract_published_at, select_label, short_notes
from search import serp_search, build_queries

# Load secrets from environment variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SEARCH_API_KEY = os.getenv("SEARCH_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY or not SEARCH_API_KEY:
    raise SystemExit("❌ Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or SEARCH_API_KEY environment variables.")

CONCURRENCY = int(os.getenv("CONCURRENCY", "4"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async def fetch_light(session: httpx.AsyncClient, url: str):
    try:
        r = await session.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SupplementsBot/1.0)"}, follow_redirects=True, timeout=15)
        html = r.text
        import re
        title = re.search(r"<title>([^<]+)</title>", html, re.I)
        site_name = re.search(r'property=["\']og:site_name["\']\s+content=["\']([^"\']+)', html, re.I)
        return html, title.group(1).strip() if title else "", site_name.group(1).strip() if site_name else ""
    except Exception:
        return "", "", ""

async def get_targets():
    res = supabase.table("supplements_needing_links").select("*").limit(500).execute()
    if res.error:
        raise Exception(res.error)
    return res.data or []

async def upsert_batch(rows):
    if not rows:
        return
    res = supabase.table("supplements_rows").upsert(rows, on_conflict="lead_id,evidence_id,url").execute()
    if res.error:
        raise Exception(res.error)

async def process_one(session, t):
    q = build_queries(t.get("lead_name"), t.get("lead_firm"), t.get("lead_city"))
    seen, assembled = set(), []
    for query in q:
        serp = await serp_search(query, SEARCH_API_KEY)
        for r in serp:
            url = canonicalize(r["link"])
            if url in seen or is_hard_excluded(url):
                continue
            seen.add(url)

            domain = get_domain(url) or ""
            html, title, site_name = await fetch_light(session, url)
            kind = classify(url, title, site_name)
            if not kind:
                continue

            pub = extract_published_at(html) if html else None
            label = select_label(kind, title, url)
            notes = short_notes(kind, domain)

            assembled.append({
                "lead_id": t["lead_id"],
                "evidence_id": t["evidence_id"],
                "url": url,
                "source_type": kind,
                "label": label,
                "published_at": pub,
                "notes": notes
            })

            if len([x for x in assembled if x["lead_id"] == t["lead_id"] and x["evidence_id"] == t["evidence_id"]]) >= 3:
                break
        if len([x for x in assembled if x["lead_id"] == t["lead_id"] and x["evidence_id"] == t["evidence_id"]]) >= 3:
            break

    await upsert_batch(assembled[:3])
    return len(assembled)

async def main():
    targets = await get_targets()
    success, failures = 0, 0

    sem = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient() as session:
        async def worker(t):
            nonlocal success, failures
            async with sem:
                try:
                    inserted = await process_one(session, t)
                    success += inserted
                except Exception as e:
                    failures += 1
                    print(f"Error for lead {t['lead_id']}: {e}")

        await asyncio.gather(*(worker(t) for t in targets))

    print(f"✅ Run complete: {success} inserts, {failures} failures")

if __name__ == "__main__":
    asyncio.run(main())
