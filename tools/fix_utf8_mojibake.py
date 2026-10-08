#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix UTF-8 mojibake (UTF-8 read as Latin-1/cp1252) in UI sources.

Icons in HTML become numeric entities so they survive mislabeled charset on hosting.
"""
from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXTS = {".html", ".js", ".css", ".php", ".txt", ".md"}

# Accented letters and punctuation (any text file)
TEXT_REPLACEMENTS = {
    "Ã¡": "á",
    "Ãà": "à",
    "Ã©": "é",
    "Ã­": "í",
    "Ã³": "ó",
    "Ãº": "ú",
    "Ã±": "ñ",
    "Ã": "Á",
    "Ã‰": "É",
    "Ã": "Í",
    "Ã“": "Ó",
    "Ãš": "Ú",
    "Ã‘": "Ñ",
    "Ã¼": "ü",
    "Ãœ": "Ü",
    "Â¡": "¡",
    "Â¿": "¿",
    "Â°": "°",
    "Â«": "«",
    "Â»": "»",
    "â€œ": "“",
    "â€": "”",
    "â€˜": "‘",
    "â€™": "’",
    "â€“": "–",
    "â€”": "—",
    "â€¢": "•",
    "â€¦": "…",
    "â–¤": "▸",
    "â–­": "▸",
    "Ã§": "ç",
    "Ã‡": "Ç",
}

# Icon mojibake → real Unicode (JS/CSS/MD)
ICON_UNICODE = {
    "â–²": "▲",  # U+25B2
    "â–¼": "▼",  # U+25BC
    "â–¶": "▶",  # U+25B6
    "â—€": "◀",  # U+25C0
    "â®": "❮",  # U+276E
    "â¯": "❯",  # U+276F
    "â†‘": "↑",  # U+2191
    "â†“": "↓",  # U+2193
    "â†’": "→",  # U+2192
    "â†": "←",  # U+2190
    "â„¢": "™",  # U+2122
    "Â®": "®",
}

# Same icons as HTML entities (safer on misconfigured servers)
ICON_HTML_ENTITIES = {
    "â–²": "&#9650;",
    "â–¼": "&#9660;",
    "â–¶": "&#9654;",
    "â—€": "&#9664;",
    "â®": "&#10094;",
    "â¯": "&#10095;",
    "â†‘": "&#8593;",
    "â†“": "&#8595;",
    "â†’": "&#8594;",
    "â†": "&#8592;",
    "â„¢": "&trade;",
    "Â®": "&reg;",
    # Already-correct Unicode icons → entities in HTML
    "▲": "&#9650;",
    "▼": "&#9660;",
    "▶": "&#9654;",
    "◀": "&#9664;",
    "❮": "&#10094;",
    "❯": "&#10095;",
    "↑": "&#8593;",
    "↓": "&#8595;",
    "→": "&#8594;",
    "←": "&#8592;",
    "™": "&trade;",
}


def should_skip(path: pathlib.Path) -> bool:
    parts = set(path.parts)
    if parts & {".git", "__pycache__", "node_modules"}:
        return True
    if "assets" in parts and "files" in parts and path.suffix.lower() in {".js", ".json"}:
        return True
    return False


def apply_map(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    count = 0
    for bad, good in sorted(mapping.items(), key=lambda kv: -len(kv[0])):
        n = text.count(bad)
        if n:
            text = text.replace(bad, good)
            count += n
    return text, count


def try_whole_file_latin1_roundtrip(text: str) -> str | None:
    markers = (
        "Ã©", "Ã³", "Ã¡", "Ã±", "Ãº", "Ã­", "Â¡", "Â¿",
        "â€", "â–", "â†", "â", "â„¢",
    )
    if not any(m in text for m in markers):
        return None
    try:
        fixed = text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    before = sum(text.count(m) for m in markers)
    after = sum(fixed.count(m) for m in markers)
    if after < before and "\ufffd" not in fixed:
        return fixed
    return None


def fix_file_text(text: str, suffix: str) -> tuple[str, int]:
    total = 0
    roundtrip = try_whole_file_latin1_roundtrip(text)
    if roundtrip is not None:
        text = roundtrip
        total += 1

    text, n = apply_map(text, TEXT_REPLACEMENTS)
    total += n

    if suffix == ".html":
        text, n = apply_map(text, ICON_HTML_ENTITIES)
    else:
        text, n = apply_map(text, ICON_UNICODE)
    total += n
    return text, total


def main() -> None:
    changed: list[tuple[str, int]] = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or should_skip(path):
            continue
        if path.suffix.lower() not in EXTS and path.name != ".htaccess":
            continue
        raw = path.read_bytes()
        if not raw:
            continue
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue

        new_text, n = fix_file_text(text, path.suffix.lower())
        if n and new_text != text:
            path.write_bytes(new_text.encode("utf-8"))
            changed.append((str(path.relative_to(ROOT)).replace("\\", "/"), n))

    print("FIXED:", len(changed))
    for name, n in changed:
        print(f"  {name} ({n})")


if __name__ == "__main__":
    main()
