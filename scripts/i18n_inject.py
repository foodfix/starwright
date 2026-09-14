#!/usr/bin/env python3
"""Merge translated slices, inject them into data/starforged.zh.json, validate.

Reads data/i18n/work/zh_NN.json (parallel arrays for slice_NN.json), builds
data/i18n/zh_strings.json (en -> zh dict), then writes data/starforged.zh.json.

Checks:
  - every slice answered with the same length
  - translations non-empty
  - markdown (id:...) link targets byte-identical to the source
  - structure parity: every English path exists in the output with the same
    shape; the output may add localized versions of tables that the English
    indexer synthesizes in code (Ask the Oracle odds)

Usage: python3 scripts/i18n_inject.py
"""

from __future__ import annotations

import copy
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "starforged.json"
OUT = ROOT / "data" / "starforged.zh.json"
OUT_DIR = ROOT / "data" / "i18n"
WORK_DIR = OUT_DIR / "work"
TRANS_FIELDS = {
    "text", "text2", "name", "title", "summary", "description", "label",
    "quest_starter", "requirement", "your_character", "canonical_name",
    "nature", "category", "roll",
}
ID_LINK = re.compile(r"\(id:[^)]*\)")
TEMPLATE_MACRO = re.compile(r"\{\{[^}]*\}\}")

# localized replacements for tables synthesized in packages/data indexer.ts;
# when these exist in the data the indexer skips its English synthesis
ASK_THE_ORACLE = {
    "_id": "starforged/collections/oracles/moves/ask_the_oracle",
    "type": "oracle_collection",
    "name": "询问神谕",
    "oracle_type": "tables",
    "contents": {
        "small_chance": {
            "_id": "starforged/oracles/moves/ask_the_oracle/small_chance",
            "type": "oracle_rollable",
            "name": "询问神谕：机会渺茫",
            "oracle_type": "yes/no",
            "dice": "2d10",
            "rows": [
                {"min": 1, "max": 10, "text": "是"},
                {"min": 11, "max": 100, "text": "否"},
            ],
        },
        "unlikely": {
            "_id": "starforged/oracles/moves/ask_the_oracle/unlikely",
            "type": "oracle_rollable",
            "name": "询问神谕：不太可能",
            "oracle_type": "yes/no",
            "dice": "2d10",
            "rows": [
                {"min": 1, "max": 25, "text": "是"},
                {"min": 26, "max": 100, "text": "否"},
            ],
        },
        "fifty_fifty": {
            "_id": "starforged/oracles/moves/ask_the_oracle/fifty_fifty",
            "type": "oracle_rollable",
            "name": "询问神谕：五五开",
            "oracle_type": "yes/no",
            "dice": "2d10",
            "rows": [
                {"min": 1, "max": 50, "text": "是"},
                {"min": 51, "max": 100, "text": "否"},
            ],
        },
        "likely": {
            "_id": "starforged/oracles/moves/ask_the_oracle/likely",
            "type": "oracle_rollable",
            "name": "询问神谕：颇有可能",
            "oracle_type": "yes/no",
            "dice": "2d10",
            "rows": [
                {"min": 1, "max": 75, "text": "是"},
                {"min": 76, "max": 100, "text": "否"},
            ],
        },
        "almost_certain": {
            "_id": "starforged/oracles/moves/ask_the_oracle/almost_certain",
            "type": "oracle_rollable",
            "name": "询问神谕：几乎必然",
            "oracle_type": "yes/no",
            "dice": "2d10",
            "rows": [
                {"min": 1, "max": 90, "text": "是"},
                {"min": 91, "max": 100, "text": "否"},
            ],
        },
    },
}


def load_dict() -> dict[str, str]:
    mapping: dict[str, str] = {}
    slices = sorted(WORK_DIR.glob("slice_*.json"))
    total = 0
    for slice_path in slices:
        zh_path = slice_path.with_name(slice_path.name.replace("slice_", "zh_"))
        source = json.loads(slice_path.read_text(encoding="utf-8"))
        translated = json.loads(zh_path.read_text(encoding="utf-8"))
        if len(source) != len(translated):
            sys.exit(f"ERROR: {zh_path.name} has {len(translated)} entries, expected {len(source)}")
        for entry, zh in zip(source, translated):
            total += 1
            if not isinstance(zh, str) or not zh.strip():
                sys.exit(f"ERROR: {zh_path.name} empty/invalid translation for i={entry['i']}: {entry['en']!r}")
            en = entry["en"]
            if en in mapping and mapping[en] != zh:
                print(f"NOTE: conflicting translation kept first: {en!r}")
                continue
            if sorted(ID_LINK.findall(en)) != sorted(ID_LINK.findall(zh)):
                sys.exit(f"ERROR: (id:) links changed for {en!r} -> {zh!r}")
            if sorted(TEMPLATE_MACRO.findall(en)) != sorted(TEMPLATE_MACRO.findall(zh)):
                sys.exit(f"ERROR: {{{{...}}}} macros changed for {en!r} -> {zh!r}")
            mapping[en] = zh
    (OUT_DIR / "zh_strings.json").write_text(
        json.dumps(mapping, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8"
    )
    print(f"merged {len(mapping)} unique translations from {len(slices)} slices ({total} entries)")
    return mapping


def superset_check(en: object, zh: object, path: str) -> None:
    if isinstance(en, dict):
        if not isinstance(zh, dict):
            sys.exit(f"ERROR: type mismatch at {path}")
        for key in en:
            if key not in zh:
                sys.exit(f"ERROR: missing key {path}/{key}")
            superset_check(en[key], zh[key], f"{path}/{key}")
    elif isinstance(en, list):
        if not isinstance(zh, list) or len(en) != len(zh):
            sys.exit(f"ERROR: array mismatch at {path}")
        for i, (a, b) in enumerate(zip(en, zh)):
            superset_check(a, b, f"{path}[{i}]")
    elif isinstance(en, dict) or isinstance(en, list):
        return


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    mapping = load_dict()

    stats = {"replaced": 0, "kept": 0}

    def inject(node: object) -> object:
        if isinstance(node, list):
            return [inject(item) for item in node]
        if isinstance(node, dict):
            result = {}
            for key, value in node.items():
                if key in TRANS_FIELDS and isinstance(value, str):
                    zh = mapping.get(value)
                    if zh is not None:
                        stats["replaced"] += 1
                        result[key] = zh
                    else:
                        stats["kept"] += 1
                        result[key] = value
                else:
                    result[key] = inject(value)
            return result
        return node

    zh_data = inject(copy.deepcopy(data))
    zh_data["oracles"]["moves"]["contents"]["ask_the_oracle"] = copy.deepcopy(ASK_THE_ORACLE)
    superset_check(data, zh_data, "")
    OUT.write_text(json.dumps(zh_data, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
    print(f"replaced {stats['replaced']} strings, kept {stats['kept']} untranslated -> {OUT}")


if __name__ == "__main__":
    main()
