#!/usr/bin/env python3
"""Live Cloudflare Pages smoke test for Apartment Radar's public static site.

This verifies deployment + basic JSON validity; it does not assert a
transaction has undergone independent secondary-source verification.
"""
from __future__ import annotations

import json
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "https://apartment-radar.pages.dev"


def get(path):
    req = Request(BASE + path, headers={"User-Agent": "ApartmentRadar-CI-Smoke/1.0"})
    with urlopen(req, timeout=35) as res:
        if res.status != 200:
            raise RuntimeError(f"{path}: HTTP {res.status}")
        return res.read(12_000_000)


def check():
    index = get("/").decode("utf-8")
    assert 'id="price-min"' in index and 'id="price-max"' in index, "price range missing"
    assert 'id="area-min"' in index and 'id="area-max"' in index, "area range missing"
    assert 'id="province-filter"' in index and 'id="district-filter"' in index, "district filters missing"
    assert 'src="./dashboard.js"' in index, "dashboard.js is not linked"

    js = get("/dashboard.js").decode("utf-8")
    assert "discovery/summary.json" in js, "lightweight discovery index not used"
    assert "S.history" in js, "history graph integration absent"

    regions = json.loads(get("/data/regions.json"))
    codes = {row["code"] for row in regions["regions"]}
    assert len([x for x in codes if x.startswith("11")]) == 25, "not all 25 Seoul gu registered"
    assert len([x for x in codes if x.startswith("41")]) >= 20, "Gyeonggi coverage too small"

    source = json.loads(get("/data/site-meta.json"))
    assert source["pipeline_state"] == "primary_collected_needs_independent_review", "verification label incorrect"

    discovery = json.loads(get("/data/discovery/summary.json"))
    assert discovery["candidate_unit_count"] >= 1000, "extended discovery data missing"
    assert len(discovery["entries"]) >= 1000, "extended search rows missing"
    assert all(not e["verified"] and e["households"] is None for e in discovery["entries"]), "unsafe independent verification or households claim"
    historical = json.loads(get("/data/history/latest.json"))
    assert historical["verification_status"] == "primary_only"
    assert historical["matched_records"] > 0
    print("LIVE OK | Seoul gu:", 25,
          "| expanded jurisdictions:", len(codes),
          "| unverified search units:", len(discovery["entries"]),
          "| 24-month matched historical filings:", historical["matched_records"],
          "| pipeline timestamp:", source["last_pipeline_run"])


def main():
    errors = []
    for attempt in range(1, 16):
        try:
            check()
            return 0
        except (AssertionError, HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as exc:
            errors.append(str(exc))
            print(f"Live check attempt {attempt}/15: {exc}", flush=True)
            if attempt < 15:
                time.sleep(12)
    print("Live deployment check FAILED. Last issue:", errors[-1], file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
