#!/usr/bin/env python3
"""Genera .data.js junto a cada JSON de assets/files para apertura file://."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES_DIR = ROOT / "assets" / "files"
TARGETS = [
    "catalogo.json",
    "precios.json",
    "brand_filters.json",
    "product_details.json",
    "productos.json",
    "estelar_flete.json",
]


def to_data_js(json_path: Path) -> Path:
    rel = json_path.relative_to(ROOT).as_posix()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    payload = json.dumps(data, ensure_ascii=False)
    out = json_path.with_suffix(".data.js")
    # path key must match what JS requests (posix relative)
    out.write_text(
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_DATA__[{json.dumps(rel)}]={payload};\n",
        encoding="utf-8",
    )
    return out


def main() -> None:
    for name in TARGETS:
        path = FILES_DIR / name
        if not path.exists():
            print("skip", name)
            continue
        out = to_data_js(path)
        print("wrote", out.name, f"({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
