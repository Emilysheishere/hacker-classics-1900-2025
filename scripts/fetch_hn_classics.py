#!/usr/bin/env python3
"""Fetch Hacker News classics by title year marker.

This script collects HN stories whose titles contain a year marker like
``(1990)`` and whose score is at least a configurable threshold. Results are
written as paged JSON chunks plus a manifest, so a static page can load them
without pulling one very large file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ALGOLIA_URL = "https://hn.algolia.com/api/v1/search"
DEFAULT_START_YEAR = 1900
DEFAULT_END_YEAR = 2025
DEFAULT_MIN_POINTS = 4
DEFAULT_HITS_PER_PAGE = 100
DEFAULT_PAGE_SIZE = 1000
DEFAULT_REQUEST_DELAY = 0.15
MAX_RETRIES = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch HN submissions whose titles contain markers like (1990)."
    )
    parser.add_argument("--start-year", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end-year", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--min-points", type=int, default=DEFAULT_MIN_POINTS)
    parser.add_argument("--hits-per-page", type=int, default=DEFAULT_HITS_PER_PAGE)
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "chunks",
        help="Directory for manifest.json and chunk files.",
    )
    parser.add_argument(
        "--request-delay",
        type=float,
        default=DEFAULT_REQUEST_DELAY,
        help="Seconds to sleep between Algolia requests.",
    )
    parser.add_argument(
        "--max-pages-per-year",
        type=int,
        default=None,
        help="Optional cap for tests. Full runs should leave this unset.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and summarize without writing files.",
    )
    return parser.parse_args()


def title_year_pattern(year: int) -> re.Pattern[str]:
    # HN classics usually end like "(1990)" or "(1990) [pdf]".
    return re.compile(rf"\({year}\)(?:\s*(?:\[[^\]]+\]|\([^\)]*\)))?\s*$")


def algolia_search(year: int, page: int, hits_per_page: int) -> dict[str, Any]:
    params = urlencode(
        {
            "tags": "story",
            "query": f'"{year}"',
            "page": page,
            "hitsPerPage": hits_per_page,
            "advancedSyntax": "true",
        }
    )
    url = f"{ALGOLIA_URL}?{params}"
    request = Request(url, headers={"User-Agent": "hn-classics-fetcher/1.0"})

    for attempt in range(MAX_RETRIES):
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as exc:
            if attempt == MAX_RETRIES - 1:
                raise RuntimeError(f"Failed to fetch {url}: {exc}") from exc
            time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(f"Failed to fetch {url}")


def compact_story(hit: dict[str, Any], year: int) -> dict[str, Any]:
    return {
        "year": year,
        "title": hit.get("title") or hit.get("story_title") or "",
        "url": hit.get("url") or hit.get("story_url"),
        "points": hit.get("points") or 0,
        "author": hit.get("author") or "",
        "created_at": hit.get("created_at"),
        "objectID": hit.get("objectID"),
        "num_comments": hit.get("num_comments") or 0,
    }


def fetch_year(
    year: int,
    min_points: int,
    hits_per_page: int,
    request_delay: float,
    max_pages_per_year: int | None,
) -> list[dict[str, Any]]:
    pattern = title_year_pattern(year)
    stories: list[dict[str, Any]] = []
    page = 0

    while True:
        data = algolia_search(year, page, hits_per_page)
        hits = data.get("hits", [])
        if not hits:
            break

        for hit in hits:
            title = hit.get("title") or hit.get("story_title") or ""
            points = hit.get("points") or 0
            if points >= min_points and pattern.search(title):
                stories.append(compact_story(hit, year))

        page += 1
        nb_pages = int(data.get("nbPages") or 0)
        if page >= nb_pages:
            break
        if max_pages_per_year is not None and page >= max_pages_per_year:
            break
        time.sleep(request_delay)

    return stories


def dedupe_and_sort(stories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for story in stories:
        key = str(story.get("objectID") or f"{story.get('title')}|{story.get('url')}")
        previous = deduped.get(key)
        if previous is None or story.get("points", 0) > previous.get("points", 0):
            deduped[key] = story

    return sorted(
        deduped.values(),
        key=lambda item: (
            int(item.get("year") or 0),
            -int(item.get("points") or 0),
            item.get("title") or "",
        ),
    )


def write_chunks(
    stories: list[dict[str, Any]],
    out_dir: Path,
    page_size: int,
    start_year: int,
    end_year: int,
    min_points: int,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old_chunk in out_dir.glob("*.json"):
        old_chunk.unlink()

    chunks = []
    for chunk_index, start in enumerate(range(0, len(stories), page_size), start=1):
        chunk = stories[start : start + page_size]
        filename = f"{chunk_index:02d}.json"
        with (out_dir / filename).open("w", encoding="utf-8") as handle:
            json.dump(chunk, handle, ensure_ascii=False, separators=(",", ":"))

        years = [int(item["year"]) for item in chunk]
        chunks.append(
            {
                "file": filename,
                "count": len(chunk),
                "yearStart": min(years),
                "yearEnd": max(years),
            }
        )

    manifest = {
        "source": "Algolia HN Search API",
        "total": len(stories),
        "pageSize": page_size,
        "totalPages": len(chunks),
        "startYear": start_year,
        "endYear": end_year,
        "minPoints": min_points,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "chunks": chunks,
    }
    with (out_dir / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)


def main() -> int:
    args = parse_args()
    if args.start_year > args.end_year:
        print("--start-year must be <= --end-year", file=sys.stderr)
        return 2

    all_stories: list[dict[str, Any]] = []
    for year in range(args.start_year, args.end_year + 1):
        stories = fetch_year(
            year=year,
            min_points=args.min_points,
            hits_per_page=args.hits_per_page,
            request_delay=args.request_delay,
            max_pages_per_year=args.max_pages_per_year,
        )
        all_stories.extend(stories)
        print(f"{year}: {len(stories)} stories", flush=True)

    stories = dedupe_and_sort(all_stories)
    print(f"Total after dedupe: {len(stories)}", flush=True)

    if not args.dry_run:
        write_chunks(
            stories=stories,
            out_dir=args.out_dir,
            page_size=args.page_size,
            start_year=args.start_year,
            end_year=args.end_year,
            min_points=args.min_points,
        )
        print(f"Wrote chunks to {args.out_dir}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
