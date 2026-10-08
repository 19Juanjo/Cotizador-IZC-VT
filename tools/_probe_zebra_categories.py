#!/usr/bin/env python3
"""Discover Zebra products currently listed on izc.com.co category pages."""
import json
import re
import time
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0"}
# Common Zebra category URLs on IZC
urls = [
    "https://izc.com.co/es/zebra.html",
    "https://izc.com.co/es/marcas/zebra.html",
    "https://izc.com.co/es/catalogsearch/result/?q=zebra",
    "https://izc.com.co/es/impresoras-zebra.html",
    "https://izc.com.co/es/lectores-zebra.html",
]

def fetch(u):
    req = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")

found = {}
for u in urls:
    try:
        final, html = fetch(u)
        hrefs = re.findall(r'href="((?:https://izc\.com\.co)?/es/[^"]*zebra[^"]*\.html)"', html, re.I)
        hrefs += re.findall(r'href="(https://izc\.com\.co/es/[^"]+\.html)"', html)
        print(u, "->", final, "len", len(html), "hrefs", len(hrefs))
        for h in hrefs:
            if "catalogsearch" in h or "customer" in h:
                continue
            if not h.startswith("http"):
                h = "https://izc.com.co" + h
            found[h] = True
    except Exception as e:
        print("ERR", u, e)

print("unique zebraish urls", len(found))
for h in list(found)[:30]:
    print(" ", h)
