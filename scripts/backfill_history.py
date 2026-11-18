#!/usr/bin/env python3
"""Backfill 24 calendar contract months for known candidate subtypes.

This is a separate FIRST-SOURCE historical dataset, not a recommendation,
valuation, independent verification, or replacement for current staging.
Only strict region+legal lot+exact subtype area+normalized name is included.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

import collect_molit as molit
import match_candidates as match

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "history" / "latest.json"
REGISTRY = ROOT / "data" / "complexes.json"


def median(values: list[float]) -> float:
    items = sorted(values)
    if not items:
        raise ValueError("No values for median")
    middle = len(items) // 2
    return items[middle] if len(items) % 2 else round((items[middle-1] + items[middle]) / 2, 4)


def build_history(months=24) -> dict:
    key = molit.clean(os.environ.get("MOLIT_API_KEY"))
    if not key:
        raise ValueError("MOLIT_API_KEY must be set in GitHub Actions secrets")
    from urllib.parse import unquote
    if "%" in key:
        key = unquote(key)
    complexes = json.loads(REGISTRY.read_text(encoding="utf-8"))["complexes"]
    index = defaultdict(list)
    for c in complexes:
        k = match.registry_key(c)
        if k:
            index[k].append(c)
    region_codes = sorted({key[0] for key in index})
    counter = [0]
    periods = molit.month_list(months)
    output = {}
    count = 0
    name_conflicts = 0
    for code in region_codes:
        region = {"code": code, "name": code}
        for month in periods:
            for kind in ("sale", "rent"):
                for raw in molit.fetch_all(kind, code, month, key, counter):
                    r = molit.normalize(kind, region, month, raw)
                    if not r:
                        continue
                    options = []
                    for c in index.get(match.raw_key(r), []):
                        unit_area = match.exact_area(c, r)
                        if unit_area is not None:
                            options.append((c, unit_area))
                    if len(options) != 1:
                        continue
                    c, area = options[0]
                    # If name not equal, hold for human alias review instead
                    # of silently assuming an identical complex.
                    if not match.name_matches(c, r):
                        name_conflicts += 1
                        continue
                    record = {
                        "date": r["contract_date"],
                        "month": r["contract_date"][:7],
                        "floor": r["floor"],
                        "area_m2": r["area_m2"],
                        "source": "MOLIT_OPEN_API_ONLY",
                        "verified_independently": False,
                    }
                    if kind == "sale":
                        record.update({
                            "price_100m": r["price_100m"],
                            "method": r["method"],
                            "cancelled": r["cancelled"],
                            "record_kind": "sale",
                        })
                    else:
                        record.update({
                            "deposit_100m": r["deposit_100m"],
                            "monthly_rent_10k_krw": r["monthly_rent_10k_krw"],
                            "lease_type": r["lease_type"],
                            "rent_category": r["rent_category"],
                            "record_kind": "rent",
                        })
                    identity = (c["id"], f"{area:.4f}")
                    group = output.setdefault(identity, {
                        "complex_id": c["id"],
                        "name": c["name"],
                        "region": c["region"],
                        "neighborhood": c.get("neighborhood"),
                        "registered_area_m2": area,
                        "sales": [],
                        "new_jeonse": [],
                        "other_rent": [],
                    })
                    if kind == "sale":
                        group["sales"].append(record)
                    elif record["lease_type"] == "new" and record["rent_category"] == "jeonse":
                        group["new_jeonse"].append(record)
                    else:
                        group["other_rent"].append(record)
                    count += 1
            print(f"history {code} {month}: requests so far {counter[0]}",flush=True)
    units = []
    for x in output.values():
        for field in ("sales", "new_jeonse", "other_rent"):
            x[field].sort(key=lambda v: (v["date"], v["floor"] or 0), reverse=True)
        current = [s for s in x["sales"] if s["method"] == "brokered" and not s["cancelled"]]
        month_values = defaultdict(list)
        for s in current:
            month_values[s["month"]].append(s["price_100m"])
        x["trend"] = [
            {"month": month, "median_price_100m": median(prices), "count": len(prices)}
            for month, prices in sorted(month_values.items())
        ]
        x["counts"] = {"brokered_sales": len(current), "new_jeonse": len(x["new_jeonse"]),
                       "all_sales": len(x["sales"]), "other_rent": len(x["other_rent"])}
        units.append(x)
    units.sort(key=lambda x: (x["region"], x["name"], x["registered_area_m2"]))
    return {
        "schema_version": "1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "months": periods,
        "data_scope": "24-month MOLIT first-source historical filings for currently registered candidate complexes and listed unit subtypes",
        "verification_status": "primary_only",
        "independent_source_verified": False,
        "api_calls": counter[0],
        "matched_records": count,
        "pending_name_conflicts_excluded": name_conflicts,
        "units": units,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--months", type=int, default=24)
    args = ap.parse_args()
    if args.months < 1 or args.months > 24:
        ap.error("--months must be between 1 and 24")
    data = build_history(args.months)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    path = OUTPUT.with_suffix(".tmp")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
    path.replace(OUTPUT)
    print(f"Backfill done: {data['api_calls']} API calls, {data['matched_records']} primary-only matched rows, {len(data['units'])} unit groups")
    print("No approved complex, TOP5 ranking or pricing fields were modified")


if __name__ == "__main__":
    try:
        main()
    except (molit.APIError, ValueError) as exc:
        print(f"History backfill failed: {exc}",file=sys.stderr)
        sys.exit(1)
