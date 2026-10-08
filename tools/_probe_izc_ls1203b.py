#!/usr/bin/env python3
import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0"}
q = "LS1203"
url = "https://izc.com.co/es/catalogsearch/result/?q=" + urllib.parse.quote(q)
req = urllib.request.Request(url, headers=UA)
with urllib.request.urlopen(req, timeout=60) as r:
    html = r.read().decode("utf-8", "replace")
Path(r"C:\IZC Server\tools\_ls1203_search.html").write_text(html, encoding="utf-8")
# find product-item-link contexts
for m in re.finditer(r"product-item-link", html, re.I):
    start = max(0, m.start() - 300)
    end = min(len(html), m.end() + 400)
    print("---")
    print(html[start:end].replace("\n", " ")[:700])
    print()
# also try looking for data-product-id
ids = re.findall(r'data-product-id="(\d+)"', html)
print("data-product-id", ids[:20])
hrefs = re.findall(r'href="(/es/[^"]*zebra[^"]*\.html)"', html, re.I)
print("zebra hrefs", hrefs[:10])
hrefs2 = re.findall(r'href="(https://izc\.com\.co/es/[^"]+\.html)"', html)
print("abs hrefs", len(hrefs2), hrefs2[:10])
