#!/usr/bin/env python3
"""Try slug guesses and family inheritance for missing Zebra images."""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0"}
root = Path(r"C:\IZC Server\assets\files")
cat = json.loads((root / "catalogo.json").read_text(encoding="utf-8"))
zebra = [p for p in cat["products"] if str(p.get("brand", "")).lower() == "zebra"]
bad = [p for p in zebra if "imgmarcas" in str(p.get("img") or "") or not str(p.get("img") or "").strip()]
good = [p for p in zebra if "catalog/product" in str(p.get("img") or "")]

def slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[áàä]", "a", s)
    s = re.sub(r"[éèë]", "e", s)
    s = re.sub(r"[íìï]", "i", s)
    s = re.sub(r"[óòö]", "o", s)
    s = re.sub(r"[úùü]", "u", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def head_ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, headers=UA, method="GET")
        with urllib.request.urlopen(req, timeout=20) as r:
            code = getattr(r, "status", 200)
            body = r.read(2000).decode("utf-8", "replace")
            return code == 200 and "404" not in body[:200].lower()
    except Exception:
        return False

# Try a few slug URLs
for p in bad[:8]:
    slug = slugify(p["name"])[:80]
    url = f"https://izc.com.co/es/{slug}.html"
    ok = head_ok(url)
    print("SLUG", p["sku"], ok, url[:90])

# Model token inheritance candidates
MODEL_RE = re.compile(r"\b(TC\d{2,4}|MC\d{3,4}|LS\d{3,4}|ZD\d{2,4}|ZT\d{2,4}|DS\d{3,4}|ZC\d{2,4}|ZXP\d|ZQ\d{2,4}|WR\d{3}|RS\d{2,4})\b", re.I)

def models(name):
    return {m.upper() for m in MODEL_RE.findall(name or "")}

good_by_model = {}
for p in good:
    for m in models(p["name"]):
        good_by_model.setdefault(m, []).append(p)

print("models with images", sorted(good_by_model.keys())[:30], "count", len(good_by_model))
inheritable = 0
for p in bad:
    ms = models(p["name"])
    donors = []
    for m in ms:
        donors.extend(good_by_model.get(m, []))
    if donors:
        inheritable += 1
        print("INHERIT", p["sku"], "models", ms, "from", donors[0]["sku"], (donors[0].get("img") or "")[:70])
print("inheritable", inheritable, "/", len(bad))
