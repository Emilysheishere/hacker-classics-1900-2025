#!/usr/bin/env python3
"""Fetch Hacker News classics by title year marker.

This script collects HN stories whose titles contain a year marker like
``(1990)`` and whose score is at least a configurable threshold. Results are
written as paged JSON chunks plus a manifest, so a static page can load them
without pulling one very large file.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ALGOLIA_URL = "https://hn.algolia.com/api/v1/search"
ALGOLIA_BY_DATE_URL = "https://hn.algolia.com/api/v1/search_by_date"
DEFAULT_START_YEAR = 1900
DEFAULT_END_YEAR = 2025
DEFAULT_MIN_POINTS = 4
DEFAULT_HITS_PER_PAGE = 1000
DEFAULT_PAGE_SIZE = 1000
DEFAULT_REQUEST_DELAY = 0.15
DEFAULT_CREATED_AFTER = "2006-10-09"
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
        "--strategy",
        choices=("time-slice", "year-query"),
        default="time-slice",
        help=(
            "time-slice is exhaustive: walk HN submission dates and filter locally. "
            "year-query is faster but can miss Algolia results due to search pagination."
        ),
    )
    parser.add_argument(
        "--created-after",
        default=DEFAULT_CREATED_AFTER,
        help="UTC date for time-slice scan start, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--created-before",
        default=None,
        help="UTC date for time-slice scan end, YYYY-MM-DD. Defaults to tomorrow UTC.",
    )
    parser.add_argument(
        "--slice-days",
        type=int,
        default=1,
        help="Initial time-slice window size in days. Overloaded windows are split recursively.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Concurrent workers for time-slice scans.",
    )
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


def any_title_year_pattern(start_year: int, end_year: int) -> re.Pattern[str]:
    return re.compile(
        rf"\((?P<year>\d{{4}})\)(?:\s*(?:\[[^\]]+\]|\([^\)]*\)))?\s*$"
    )


def parse_utc_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


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


def algolia_search_by_date(
    start_ts: int,
    end_ts: int,
    min_points: int,
    page: int,
    hits_per_page: int,
) -> dict[str, Any]:
    params = urlencode(
        {
            "tags": "story",
            "query": "",
            "numericFilters": f"points>={min_points},created_at_i>={start_ts},created_at_i<{end_ts}",
            "page": page,
            "hitsPerPage": hits_per_page,
        }
    )
    url = f"{ALGOLIA_BY_DATE_URL}?{params}"
    request = Request(url, headers={"User-Agent": "hn-classics-fetcher/2.0"})

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
    story = {
        "year": year,
        "title": hit.get("title") or hit.get("story_title") or "",
        "url": hit.get("url") or hit.get("story_url"),
        "points": hit.get("points") or 0,
        "author": hit.get("author") or "",
        "created_at": hit.get("created_at"),
        "objectID": hit.get("objectID"),
        "num_comments": hit.get("num_comments") or 0,
    }
    if hit.get("story_text"):
        story["story_text"] = hit["story_text"]
    if hit.get("comment_text"):
        story["comment_text"] = hit["comment_text"]
    return story


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


def fetch_time_range(
    start_dt: datetime,
    end_dt: datetime,
    start_year: int,
    end_year: int,
    min_points: int,
    hits_per_page: int,
    request_delay: float,
) -> list[dict[str, Any]]:
    pattern = any_title_year_pattern(start_year, end_year)
    stories: list[dict[str, Any]] = []
    start_ts = int(start_dt.timestamp())
    end_ts = int(end_dt.timestamp())
    first_page = algolia_search_by_date(start_ts, end_ts, min_points, 0, hits_per_page)
    nb_hits = int(first_page.get("nbHits") or 0)

    if nb_hits > hits_per_page:
        midpoint = start_dt + (end_dt - start_dt) / 2
        if int(midpoint.timestamp()) in (start_ts, end_ts):
            raise RuntimeError(f"Cannot split overloaded range {start_dt} to {end_dt}")
        stories.extend(
            fetch_time_range(
                start_dt,
                midpoint,
                start_year,
                end_year,
                min_points,
                hits_per_page,
                request_delay,
            )
        )
        stories.extend(
            fetch_time_range(
                midpoint,
                end_dt,
                start_year,
                end_year,
                min_points,
                hits_per_page,
                request_delay,
            )
        )
        return stories

    pages = [first_page]
    for page in range(1, int(first_page.get("nbPages") or 0)):
        time.sleep(request_delay)
        pages.append(algolia_search_by_date(start_ts, end_ts, min_points, page, hits_per_page))

    for data in pages:
        for hit in data.get("hits", []):
            title = hit.get("title") or hit.get("story_title") or ""
            match = pattern.search(title)
            if not match:
                continue
            year = int(match.group("year"))
            if start_year <= year <= end_year:
                stories.append(compact_story(hit, year))

    return stories


def fetch_by_time_slices(
    created_after: str,
    created_before: str | None,
    start_year: int,
    end_year: int,
    min_points: int,
    hits_per_page: int,
    request_delay: float,
    slice_days: int,
    workers: int,
) -> list[dict[str, Any]]:
    current = parse_utc_date(created_after)
    stop = parse_utc_date(created_before) if created_before else (
        datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        + timedelta(days=1)
    )
    if slice_days < 1:
        raise ValueError("--slice-days must be >= 1")
    if workers < 1:
        raise ValueError("--workers must be >= 1")

    ranges: list[tuple[datetime, datetime]] = []
    while current < stop:
        next_slice = min(current + timedelta(days=slice_days), stop)
        ranges.append((current, next_slice))
        current = next_slice

    stories: list[dict[str, Any]] = []
    completed = 0

    def fetch_range(date_range: tuple[datetime, datetime]) -> tuple[datetime, datetime, list[dict[str, Any]]]:
        range_start, range_end = date_range
        return (
            range_start,
            range_end,
            fetch_time_range(
                range_start,
                range_end,
                start_year,
                end_year,
                min_points,
                hits_per_page,
                request_delay,
            ),
        )

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_range = {executor.submit(fetch_range, date_range): date_range for date_range in ranges}
        for future in as_completed(future_to_range):
            range_start, range_end, slice_stories = future.result()
            completed += 1
            stories.extend(slice_stories)
            if slice_stories or completed % 100 == 0:
                print(
                    f"{completed}/{len(ranges)} {range_start.date()}..{range_end.date()}: "
                    f"{len(slice_stories)} matching stories",
                    flush=True,
                )

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
    if args.strategy == "time-slice":
        all_stories = fetch_by_time_slices(
            created_after=args.created_after,
            created_before=args.created_before,
            start_year=args.start_year,
            end_year=args.end_year,
            min_points=args.min_points,
            hits_per_page=args.hits_per_page,
            request_delay=args.request_delay,
            slice_days=args.slice_days,
            workers=args.workers,
        )
    else:
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
