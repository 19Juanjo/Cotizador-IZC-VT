#!/usr/bin/env python3
import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0"}
url = "https://izc.com.co/es/catalogsearch/result/?q=" + urllib.parse.quote("zebra")
req = urllib.request.Request(url, headers=UA)
with urllib.request.urlopen(req, timeout=60) as r:
    html = r.read().decode("utf-8", "replace")
Path(r"C:\IZC Server\tools\_zebra_search.html").write_text(html, encoding="utf-8")
print("len", len(html))
print("product-item", len(re.findall(r'class="[^"]*product-item[^"]*"', html)))
print("Sku:", len(re.findall(r"Sku:\s*[0-9\-]+", html, re.I)))
# Extract cards roughly
for m in re.finditer(r"Sku:\s*([0-9\-]+)", html, re.I):
    start = max(0, m.start() - 800)
    chunk = html[start : m.end() + 200]
    href = re.search(r'href="((?:https://izc\.com\.co)?/es/[^"]+\.html)"', chunk)
    img = re.search(r'src="(https://izc\.com\.co/pub/media/catalog/product[^"]+)"', chunk)
    name = re.search(r'product-item-link[^>]*>\s*([^<]+)', chunk, re.I)
    print(m.group(1), "href", href.group(1) if href else None, "img", bool(img), "name", (name.group(1).strip()[:50] if name else None))
    if m.start() > 50000:  # limit
        break
# pager?
print("pager", re.findall(r"p=\d+", html)[:10])
print("toolbar-amount", re.search(r"toolbar-number[^>]*>([^<]+)", html))
