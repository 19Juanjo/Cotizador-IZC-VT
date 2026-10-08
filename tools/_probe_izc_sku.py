#!/usr/bin/env python3
import json
import re
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0"}
sku = "5613"
urls = [
    f"https://izc.com.co/catalogsearch/result/?q={sku}",
    f"https://izc.com.co/es/catalogsearch/result/?q={sku}",
]
for u in urls:
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", "replace")
        print("OK", u, "len", len(html))
        imgs = re.findall(
            r"https://izc\.com\.co/pub/media/catalog/product[^\"\s<>]+", html
        )
        print(" imgs", len(set(imgs)), list(dict.fromkeys(imgs))[:5])
        hrefs = re.findall(r'href="(https://izc\.com\.co/es/[^"]+\.html)"', html)
        print(" hrefs", hrefs[:8])
    except Exception as e:
        print("ERR", u, e)
