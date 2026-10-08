#!/usr/bin/env python3
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
for u in [
    "https://izc.com.co/sitemap.xml",
    "https://izc.com.co/media/sitemap/sitemap.xml",
    "https://izc.com.co/pub/media/sitemap/sitemap.xml",
    "https://izc.com.co/sitemaps/sitemap.xml",
    "https://izc.com.co/es/sitemap.xml",
]:
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read(5000).decode("utf-8", "replace")
        print("OK", u, body[:200].replace("\n", " "))
    except Exception as e:
        print("ERR", u, e)
