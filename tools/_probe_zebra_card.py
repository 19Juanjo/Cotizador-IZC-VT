#!/usr/bin/env python3
import re
from pathlib import Path

html = Path(r"C:\IZC Server\tools\_zebra_search.html").read_text(encoding="utf-8")
m = re.search(r"Sku:\s*10428", html, re.I)
chunk = html[max(0, m.start() - 2500) : m.end() + 500]
Path(r"C:\IZC Server\tools\_zebra_card_sample.html").write_text(chunk, encoding="utf-8")
print("data-src", re.findall(r'data-src="([^"]+)"', chunk)[:5])
print("src", [s for s in re.findall(r'src="([^"]+)"', chunk) if "catalog" in s or "media" in s][:8])
print("href", [h for h in re.findall(r'href="([^"]+)"', chunk) if ".html" in h][:8])
print("--- chunk head ---")
print(chunk[:500])
