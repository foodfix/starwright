#!/usr/bin/env python3
"""Extract translatable display strings from data/starforged.json.

Produces:
  data/i18n/en_strings.json   deduped source strings with context
  data/i18n/work/slice_NN.json  translation work slices (~N entries each)

Usage: python3 scripts/i18n_extract.py [--slice-size 400]
"""

from __future__ import annotations

import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "starforged.json"
OUT_DIR = ROOT / "data" / "i18n"
WORK_DIR = OUT_DIR / "work"

# display fields whose values are shown to players; everything else
# (ids, enums, dice, urls, dates, colors, icons, _i18n hints) stays untouched
TRANS_FIELDS = {
    "text",
    "text2",
    "name",
    "title",
    "summary",
    "description",
    "label",
    "quest_starter",
    "requirement",
    "your_character",
    "canonical_name",
    "nature",
    "category",
    "roll",
}


def walk(node: object, path: str, out: list[tuple[str, str, str]]) -> None:
    if isinstance(node, list):
        for item in node:
            walk(item, path, out)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key in TRANS_FIELDS and isinstance(value, str):
                segments = [seg for seg in path.split("/") if seg][-2:]
                ctx = "/".join(segments) if segments else key
                out.append((key, ctx, value))
            elif isinstance(value, (dict, list)):
                walk(value, f"{path}/{key}", out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slice-size", type=int, default=400)
    args = parser.parse_args()

    data = json.loads(SRC.read_text(encoding="utf-8"))
    found: list[tuple[str, str, str]] = []
    walk(data, "", found)

    # dedupe by exact string: identical English always maps to one Chinese term
    seen: dict[str, tuple[str, str, str]] = {}
    for field, ctx, text in found:
        seen.setdefault(text, (field, ctx, text))

    entries = [
        {"i": i, "field": field, "ctx": ctx, "en": text}
        for i, (field, ctx, text) in enumerate(seen.values())
    ]

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "en_strings.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8"
    )

    slices = [
        entries[start : start + args.slice_size]
        for start in range(0, len(entries), args.slice_size)
    ]
    for n, chunk in enumerate(slices):
        (WORK_DIR / f"slice_{n:02d}.json").write_text(
            json.dumps(chunk, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8"
        )

    total = sum(len(s) for s in slices)
    chars = sum(len(e["en"]) for e in entries)
    print(f"unique strings: {len(entries)} ({chars} chars) -> {len(slices)} slices")


if __name__ == "__main__":
    main()
