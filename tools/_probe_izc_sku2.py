#!/usr/bin/env python3
import re
import urllib.parse
import urllib.request

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CO,es;q=0.9",
}
sku = "5613"
url = "https://izc.com.co/es/catalogsearch/result/?q=" + urllib.parse.quote(sku)
req = urllib.request.Request(url, headers=UA)
with urllib.request.urlopen(req, timeout=60) as r:
    html = r.read().decode("utf-8", "replace")
print("len", len(html))
print("product-item count", len(re.findall(r"product-item", html, re.I)))
print("sku mentions", len(re.findall(re.escape(sku), html)))
# dump interesting snippets
for pat in [
    r"no se encontraron",
    r"No results",
    r"product-item-link",
    r"catalog/product",
    r"mage-init",
    r"searchCriteria",
]:
    print(pat, bool(re.search(pat, html, re.I)))
# save snippet around first product or message
m = re.search(r"message\s+notice|products\s+wrapper|search results", html, re.I)
if m:
    i = max(0, m.start() - 200)
    print("snippet:", html[i : i + 800].replace("\n", " ")[:800])
# try alternate: catalog product view by id?
for u in [
    f"https://izc.com.co/es/catalog/product/view/id/{sku}",
    f"https://izc.com.co/catalog/product/view/id/{sku}",
]:
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            h = r.read().decode("utf-8", "replace")
            final = r.geturl()
        print("VIEW", u, "->", final, "len", len(h), "imgs", len(re.findall(r"catalog/product", h)))
        imgs = re.findall(r"https://izc\.com\.co/pub/media/catalog/product[^\"\s<>]+", h)
        print("  sample imgs", imgs[:3])
        if re.search(rf"Sku:\s*{sku}\b", h, re.I) or re.search(rf'itemprop="sku">\s*{sku}', h, re.I):
            print("  SKU MATCH")
    except Exception as e:
        print("VIEW ERR", u, e)
