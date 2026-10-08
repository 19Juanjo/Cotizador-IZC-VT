#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Encode non-ASCII in HTML (outside script/style) as numeric entities."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "tools", "data", "assets", "__pycache__", "node_modules"}
SPLIT = re.compile(r"(?is)(<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>)")


def encode_text(chunk: str) -> str:
    return "".join(f"&#{ord(ch)};" if ord(ch) > 127 else ch for ch in chunk)


def encode_html(text: str) -> str:
    parts = SPLIT.split(text)
    out = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
        else:
            out.append(encode_text(part))
    return "".join(out)


def main() -> None:
    changed = []
    for path in sorted(ROOT.glob("*.html")):
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
        new = encode_html(text)
        if new != text:
            path.write_bytes(new.encode("utf-8"))
            changed.append(path.name)
    print("UPDATED", len(changed))
    for name in changed:
        print(" ", name)


if __name__ == "__main__":
    main()
