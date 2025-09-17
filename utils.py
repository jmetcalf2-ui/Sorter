# utils.py
import re, urllib.parse
from tldts import get_domain
from selectolax.parser import HTMLParser

HARD_EXCLUDES = ["https://www.artadvisors.org/art-advisor-directory"]
BANNED_HOSTS = {
    "artadvisors.org",
    "aboutus.com",
    "allbiz.com",
    "trustpilot.com",
    "mapquest.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "instagram.com",
}

def canonicalize(url: str) -> str:
    try:
        u = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(u.query)
        for k in ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"]:
            query.pop(k, None)
        new_q = urllib.parse.urlencode({k: v[0] for k,v in query.items()})
        return urllib.parse.urlunsplit(("https", u.netloc, u.path, new_q, ""))
    except Exception:
        return url

def is_hard_excluded(url: str) -> bool:
    c = canonicalize(url)
    if any(c.startswith(x) for x in HARD_EXCLUDES):
        return True
    try:
        host = urllib.parse.urlsplit(c).hostname or ""
    except Exception:
        host = ""
    return host in BANNED_HOSTS

def classify(url: str, title: str = "", site_name: str = "") -> str | None:
    host = urllib.parse.urlsplit(url).hostname or ""
    d = get_domain(host) or host
    path = url.lower()
    if re.search(r"museum|gallery|foundation|university|collection", d) and re.search(r"exhibition|project|artist|profile", path):
        return "project"
    if re.search(r"nytimes|wsj|artnews|artforum|ft\.com|newyorker|theguardian|bloomberg|forbes", d):
        return "article"
    if re.search(r"press|newsroom|press-release|media", path):
        return "press"
    if re.search(r"image|photo|media|collection/ images", path):
        return "images"
    if re.search(r"about|team|people|advis", path) or re.search(r"official|homepage", f"{title} {site_name}", re.I):
        return "website"
    if re.search(r"\.org$|\.edu$", d):
        return "project"
    return "article"

def select_label(kind: str, title: str, url: str) -> str:
    if kind == "website": return "Official site"
    if kind == "press": return "Press release"
    if kind == "project": return "Project page"
    if kind == "images": return "Image resource"
    if kind == "article":
        return "Interview article" if re.search(r"interview|q&a|conversation", title or "", re.I) else "Article"
    return "Article"

def short_notes(kind: str, domain: str) -> str:
    base = {
        "website": "Authoritative profile",
        "press": "Institutional press source",
        "project": "Official project/exhibition page",
        "images": "Institutional media/images",
        "article": "Credible media coverage"
    }[kind]
    msg = f"{base} ({domain})"
    return msg if len(msg) <= 140 else (msg[:137] + "...")

def extract_published_at(html: str) -> str | None:
    try:
        dom = HTMLParser(html)
        og = dom.css_first('meta[property="article:published_time"]')
        if og and og.attributes.get("content"):
            return to_iso(og.attributes["content"])
        for sel in ['meta[name="pubdate"]','meta[name="date"]']:
            m = dom.css_first(sel)
            if m and m.attributes.get("content"):
                return to_iso(m.attributes["content"])
        t = dom.css_first("time[datetime]")
        if t and t.attributes.get("datetime"):
            return to_iso(t.attributes["datetime"])
        text = dom.text() or ""
        m = re.search(r"\b(20\d{2}|19\d{2})[-/\.](0?[1-9]|1[0-2])[-/\.](0?[1-9]|[12]\d|3[01])\b", text)
        if m:
            return to_iso(m.group(0))
    except Exception:
        pass
    return None

def to_iso(s: str) -> str | None:
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.replace("Z","")).isoformat() + "Z"
    except Exception:
        try:
            from datetime import datetime
            return datetime.strptime(s, "%Y-%m-%d").isoformat() + "Z"
        except Exception:
            return None
