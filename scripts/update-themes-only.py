#!/usr/bin/env python3
"""
One-off script to fetch RSS feeds and update themes.json with theme counts
for the current month (all source posts). Use when the main Node script
cannot run locally (e.g. Node/simdjson issue). Requires: sources.json.
"""
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_PATH = ROOT / "sources.json"
THEMES_PATH = ROOT / "themes.json"

# Namespaces commonly used in RSS/Atom
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "media": "http://search.yahoo.com/mrss/",
}


def to_iso_date(dt):
    return dt.strftime("%Y-%m-%d")


def parse_date(s):
    if not s or not s.strip():
        return None
    s = s.strip().replace("Z", "+00:00").replace("GMT", "+0000")
    # Try common RSS/Atom formats (with and without timezone)
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d %b %Y %H:%M:%S %z",
        "%d %b %Y",
    ):
        try:
            t = s[:30] if len(s) > 30 else s
            return datetime.strptime(t.strip(), fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")[:26])
    except ValueError:
        return None


def infer_category(title, description):
    """Mirror of JS inferCategory: AI-application themes only."""
    text = f"{title or ''} {description or ''}".lower()
    if re.search(r"\b(synthetic\s+user|synthetic\s+participant|LLM\s+persona|AI\s+persona|concept\s+test.*(AI|LLM)|AI.*concept\s+test)\b", text):
        return "Synthetic users"
    if re.search(r"\b(transcript\s+summar|summariz|theme\s+extraction|one-?click\s+summar|synthesis.*(AI|from\s+transcript)|affinity.*AI|thematic.*AI)\b", text):
        return "AI summarization"
    if re.search(r"\b(automated\s+usability|scan\s+prototype|usability\s+issue\s+detection|AI.*(a11y|accessibility)|heuristic.*AI|flag.*usability)\b", text):
        return "Automated usability checks"
    if re.search(r"\b(survey.*(AI|optimiz)|questionnaire.*AI|AI.*survey|clearer\s+survey|reduce\s+bias.*survey|adaptive\s+(survey|follow-?up))\b", text):
        return "Survey optimization"
    if re.search(r"\b(session\s+replay.*AI|AI.*session\s+replay|behavioral\s+pattern.*AI|drop-?off.*detection|rage\s+click|heatmap.*AI)\b", text):
        return "Session replay + AI"
    if re.search(r"\b(recruit.*AI|AI.*recruit|screener.*AI|participant\s+recruitment.*AI)\b", text):
        return "AI-assisted recruitment"
    if re.search(r"\b(interview.*(AI|transcript)|transcript.*interview|qualitative.*AI)\b", text):
        return "Interview analysis"
    return "Other AI in research"


def text_of(el):
    if el is None:
        return ""
    return (el.text or "") + "".join(ET.tostring(c, encoding="unicode", method="text") for c in el).strip()


def fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": "AI-UX-Research-Updates-Bot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return ET.parse(r).getroot()
    except Exception as e:
        print(f"Skip feed {url}: {e}", flush=True)
        return None


def item_month_key(dt):
    if dt is None:
        return None
    return dt.strftime("%Y-%m")


def collect_items_from_feed(root, feed_url):
    items = []
    # RSS 2.0: channel -> item
    for item in root.findall(".//item"):
        title_el = item.find("title")
        desc_el = item.find("description") or item.find("content:encoded", NS) or item.find("content", NS)
        pub_el = item.find("pubDate") or item.find("dc:date", NS)
        title = text_of(title_el) if title_el is not None else ""
        desc = text_of(desc_el) if desc_el is not None else ""
        pub_s = text_of(pub_el) if pub_el is not None else None
        pub_dt = parse_date(pub_s) if pub_s else None
        items.append({"title": title, "description": desc, "pub": pub_dt})
    # Atom: feed -> entry
    for entry in root.findall(".//{%s}entry" % NS["atom"]):
        title_el = entry.find("{%s}title" % NS["atom"]) or entry.find("title")
        desc_el = entry.find("{%s}summary" % NS["atom"]) or entry.find("{%s}content" % NS["atom"]) or entry.find("summary") or entry.find("content", NS)
        pub_el = entry.find("{%s}published" % NS["atom"]) or entry.find("{%s}updated" % NS["atom"]) or entry.find("published") or entry.find("updated")
        title = text_of(title_el) if title_el is not None else ""
        desc = text_of(desc_el) if desc_el is not None else ""
        pub_s = text_of(pub_el) if pub_el is not None else None
        pub_dt = parse_date(pub_s) if pub_s else None
        items.append({"title": title, "description": desc, "pub": pub_dt})
    return items


def main():
    import os
    with open(SOURCES_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    feeds = data.get("feeds") or []
    if not feeds:
        print("No feeds in sources.json")
        return

    today = datetime.now()
    # Allow override so you can run for a specific month (e.g. THEMES_MONTH=2025-02)
    current_month_key = os.environ.get("THEMES_MONTH") or today.strftime("%Y-%m")
    theme_counts = defaultdict(int)

    for feed_config in feeds:
        url = feed_config.get("url")
        name = feed_config.get("name", url)
        if not url:
            continue
        root = fetch_feed(url)
        if root is None:
            continue
        for item in collect_items_from_feed(root, url):
            pub = item.get("pub")
            if pub is None:
                continue
            item_month = item_month_key(pub)
            if item_month != current_month_key:
                continue
            theme = infer_category(item["title"], item["description"])
            theme_counts[theme] += 1

    total = sum(theme_counts.values())
    sorted_themes = sorted(
        [{"name": k or "Other AI in research", "count": v} for k, v in theme_counts.items()],
        key=lambda x: -x["count"],
    )[:5]
    # If no posts this month, show the five application themes with 0 so the section still looks right
    if not sorted_themes:
        sorted_themes = [
            {"name": "Synthetic users", "count": 0},
            {"name": "AI summarization", "count": 0},
            {"name": "Automated usability checks", "count": 0},
            {"name": "Survey optimization", "count": 0},
            {"name": "Session replay + AI", "count": 0},
        ]

    payload = {
        "month": current_month_key,
        "updated": to_iso_date(today),
        "themes": sorted_themes,
        "note": "Based on how often each theme appears in posts from our RSS sources this month. Social media (e.g. LinkedIn) is not included—no public API.",
    }
    with open(THEMES_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"Updated {THEMES_PATH} with top {len(sorted_themes)} themes for {current_month_key} (from {total} source posts this month).")


if __name__ == "__main__":
    main()
