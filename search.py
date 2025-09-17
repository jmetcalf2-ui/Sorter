# search.py
import os
import httpx

def build_queries(name: str | None, firm: str | None = None, city: str | None = None):
    n = (name or "").strip()
    f = (firm or "").strip()
    c = (city or "").strip()

    parts = []
    if n: parts.append(f'"{n}"')
    if f: parts.append(f'"{f}"')

    base = [
        f'{" ".join(parts)} art advisory'.strip(),
        f'{" ".join(parts)} site:.org'.strip(),
        f'{" ".join(parts)} museum profile'.strip(),
        f'{" ".join(parts)} interview'.strip(),
        f'{" ".join(parts)} collection'.strip(),
        f'{n} (museum OR collection OR foundation OR gallery OR exhibition)'.strip()
    ]
    if c:
        base.append(f'{" ".join(parts)} {c}'.strip())

    seen, out = set(), []
    for q in base:
        q = " ".join(q.split())
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out

async def serp_search(q: str, api_key: str | None = None):
    key = api_key or os.getenv("SEARCH_API_KEY")
    if not key:
        print("WARN: SEARCH_API_KEY is not set; serp_search will return [].")
        return []

    url = "https://serper.dev/api/search"
    payload = {
        "q": q,
        "num": 10,
        "gl": "us",
        "hl": "en",
        "autocorrect": True,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, json=payload, headers={
                "X-API-KEY": key,
                "Content-Type": "application/json"
            })
            r.raise_for_status()
            j = r.json()
            organic = j.get("organic") or []
            out = []
            for o in organic:
                link = o.get("link") or o.get("url") or ""
                if not link:
                    continue
                out.append({
                    "title": o.get("title", "") or "",
                    "link": link,
                    "snippet": o.get("snippet") or o.get("snippet_highlighted") or o.get("description") or ""
                })
            return out
    except Exception as e:
        print("Serper error:", e)
        return []
