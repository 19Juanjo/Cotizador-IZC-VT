#!/usr/bin/env python3
import re
import urllib.parse
import urllib.request

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}
q = "LS1203"
url = "https://izc.com.co/es/catalogsearch/result/?q=" + urllib.parse.quote(q)
req = urllib.request.Request(url, headers=UA)
with urllib.request.urlopen(req, timeout=60) as r:
    html = r.read().decode("utf-8", "replace")
blocks = re.split(r'<li[^>]*class="[^"]*product-item[^"]*"', html, flags=re.I)
print("blocks", len(blocks) - 1)
for i, block in enumerate(blocks[1:6], 1):
    href = re.search(r'href="(https://izc\.com\.co[^"]+\.html|/es/[^"]+\.html)"', block, re.I)
    sku = re.search(r"Sku:\s*([0-9\-]+)", block, re.I)
    name = re.search(r'product-item-link[^>]*>([^<]+)', block, re.I)
    img = re.search(r'(https://izc\.com\.co/pub/media/catalog/product[^\"\s]+)', block, re.I)
    print(i, "sku", sku.group(1) if sku else None)
    print("  href", href.group(1) if href else None)
    print("  name", (name.group(1).strip() if name else None))
    print("  img", (img.group(1)[:100] if img else None))
