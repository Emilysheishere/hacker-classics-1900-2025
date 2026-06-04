#!/usr/bin/env python3
"""Merge translated titles from Owen Young's HN Vault chunks.

The local archive keeps its own fetch rules. This helper only copies
``title_zh`` into matching local stories when a translated public chunk has the
same HN objectID, or the same English title as a weaker fallback.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Directory containing Owen's manifest.json and chunk JSON files.",
    )
    parser.add_argument(
        "--target-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "chunks",
        help="Local chunks directory to update in place.",
    )
    return parser.parse_args()


def load_translations(source_dir: Path) -> tuple[dict[str, str], dict[str, str]]:
    manifest = json.load((source_dir / "manifest.json").open(encoding="utf-8"))
    by_id: dict[str, str] = {}
    by_title: dict[str, str] = {}
    for chunk in manifest["chunks"]:
        stories = json.load((source_dir / chunk["file"]).open(encoding="utf-8"))
        for story in stories:
            title_zh = story.get("title_zh")
            if not title_zh:
                continue
            object_id = story.get("objectID")
            title = story.get("title")
            if object_id:
                by_id[str(object_id)] = title_zh
            if title:
                by_title.setdefault(title, title_zh)
    return by_id, by_title


def merge(source_dir: Path, target_dir: Path) -> tuple[int, int]:
    by_id, by_title = load_translations(source_dir)
    manifest = json.load((target_dir / "manifest.json").open(encoding="utf-8"))
    matched = 0
    total = 0

    for chunk in manifest["chunks"]:
        path = target_dir / chunk["file"]
        stories = json.load(path.open(encoding="utf-8"))
        changed = False
        for story in stories:
            total += 1
            title_zh = by_id.get(str(story.get("objectID"))) or by_title.get(story.get("title"))
            if title_zh and story.get("title_zh") != title_zh:
                story["title_zh"] = title_zh
                matched += 1
                changed = True
        if changed:
            with path.open("w", encoding="utf-8") as handle:
                json.dump(stories, handle, ensure_ascii=False, separators=(",", ":"))

    manifest["translatedCount"] = count_translated(target_dir, manifest)
    with (target_dir / "manifest.json").open("w", encoding="utf-8") as handle:
      json.dump(manifest, handle, ensure_ascii=False, indent=2)
    return matched, total


def count_translated(target_dir: Path, manifest: dict) -> int:
    count = 0
    for chunk in manifest["chunks"]:
        stories = json.load((target_dir / chunk["file"]).open(encoding="utf-8"))
        count += sum(1 for story in stories if story.get("title_zh"))
    return count


def main() -> int:
    args = parse_args()
    matched, total = merge(args.source_dir, args.target_dir)
    print(f"Merged translations: {matched}/{total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
