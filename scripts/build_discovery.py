#!/usr/bin/env python3
"""Make a broad, clearly UNVERIFIED region/subtype discovery index from MOLIT staging.

This index contains NO apartment household counts, no trusted complex ID,
no final top-five recommendation, and NO independent second-source checks.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IN = ROOT / "data" / "molit" / "latest.json"
OUT = ROOT / "data" / "discovery" / "latest.json"
REGIONS = ROOT / "data" / "regions.json"

BUDGETS = {
    "10-15-84": (10, 15, 80, 90),
    "15-20-84": (15, 20, 80, 90),
    "20-30-84": (20, 30, 80, 90),
    "20-30-large": (20, 30, 100, 135)
}


def median(vals):
    vals = sorted(vals)
    if not vals:
        return None
    middle = len(vals)//2
    return vals[middle] if len(vals) % 2 else round((vals[middle-1] + vals[middle])/2, 4)


def comparable(r, kind):
    if r.get("record_kind") != kind:
        return False
    if not r.get("legal_dong") or not r.get("jibun") or not r.get("apartment_name"):
        return False
    if r.get("floor") is None or r.get("area_m2") is None:
        return False
    if kind == "sale":
        return (r.get("method") == "brokered"
                and not r.get("cancelled")
                and isinstance(r.get("price_100m"), (int, float)))
    return (r.get("lease_type") == "new"
            and r.get("rent_category") == "jeonse"
            and isinstance(r.get("deposit_100m"), (int, float)))


def identity(r):
    return (
        r.get("region_code"), r.get("legal_dong"), r.get("jibun"),
        r.get("apartment_name"), round(r["area_m2"], 4)
    )


def compact(r):
    return {
        "date": r["contract_date"], "floor": r["floor"],
        "area_m2": r["area_m2"],
        "price_100m": r.get("price_100m"),
        "deposit_100m": r.get("deposit_100m"),
        "record_id": r.get("provisional_record_hash"),
        "source": "MOLIT_FIRST_SOURCE_ONLY",
    }


def build(staging, region_config):
    rows = staging.get("records")
    if not isinstance(rows, list):
        raise ValueError("MOLIT staging needs records")
    region_map = {r["code"]: r for r in region_config.get("regions", [])}
    groups = defaultdict(lambda: {"sales": [], "leases": []})
    skipped = defaultdict(int)
    for r in rows:
        if not comparable(r, "sale") and not comparable(r, "rent"):
            skipped["not_eligible_for_public_exploration"] += 1
            continue
        code = r["region_code"]
        if code not in region_map:
            skipped["region_not_configured"] += 1
            continue
        typ = "sales" if r["record_kind"] == "sale" else "leases"
        groups[identity(r)][typ].append(compact(r))
    entries = []
    for (code,dong,lot,name,area),g in groups.items():
        s = sorted(g["sales"],key=lambda x:x["date"],reverse=True)[:5]
        l = sorted(g["leases"],key=lambda x:x["date"],reverse=True)[:5]
        prices = [x["price_100m"] for x in s]
        rents = [x["deposit_100m"] for x in l]
        if not s:
            continue
        scopes = []
        for key,(low,high,amin,amax) in BUDGETS.items():
            if amin <= area <= amax and prices and low <= median(prices) <= high and max(prices) <= high:
                scopes.append(key)
        entry={
            "id": hashlib.sha256("|".join(map(str,(code,dong,lot,name,area))).encode()).hexdigest()[:18],
            "region_code": code,
            "region": region_map[code]["name"],
            "region_class": region_map[code].get("class","우선 검토"),
            "legal_dong": dong,
            "jibun": lot,
            "apartment_name": name,
            "area_m2": area,
            "households": None,
            "households_confirmed_500_plus": False,
            "verified": False,
            "verification_status": "PRIMARY_SOURCE_ONLY_HOUSEHOLDS_UNKNOWN",
            "sale_count_all_in_period": len(g["sales"]),
            "new_jeonse_count_all_in_period": len(g["leases"]),
            "sale_count_displayed": len(s),
            "new_jeonse_count_displayed": len(l),
            "sale_min": min(prices),
            "sale_max": max(prices),
            "sale_median": median(prices),
            "lease_min": min(rents) if rents else None,
            "lease_max": max(rents) if rents else None,
            "lease_median": median(rents),
            "jeonse_ratio_reference": round(median(rents)/median(prices)*100,1) if rents and prices else None,
            "latest_sale_date": s[0]["date"],
            "budget_groups": scopes,
            "sale_sample": s,
            "new_jeonse_sample": l,
        }
        entries.append(entry)
    entries.sort(key=lambda x:(x["sale_count_all_in_period"],x["latest_sale_date"]),reverse=True)
    return {
        "schema_version":"1.0",
        "generated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "underlying_molit_run":staging.get("generated_at_utc"),
        "periods":staging.get("periods",[]),
        "coverage_district_count":len(region_config.get("regions",[])),
        "candidate_unit_count":len(entries),
        "skipped":dict(skipped),
        "disclaimer":"NOT 500+ verified, NOT independently checked. Unranked candidates for review; displayed values are public-first-source filings only.",
        "entries":entries,
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--input",type=Path,default=IN)
    ap.add_argument("--output",type=Path,default=OUT)
    args=ap.parse_args()
    staging=json.loads(args.input.read_text(encoding="utf-8"))
    regions=json.loads(REGIONS.read_text(encoding="utf-8"))
    index=build(staging,regions)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temp=args.output.with_suffix(".tmp")
    temp.write_text(json.dumps(index,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    temp.replace(args.output)
    # Pages frontend only needs this compact unverified search index, not every raw transaction.
    brief_fields = (
        "region_code", "legal_dong", "jibun", "apartment_name", "area_m2",
        "sale_median", "sale_max", "sale_count_all_in_period", "latest_sale_date"
    )
    summary = {
        "schema_version": "1.0",
        "generated_at_utc": index["generated_at_utc"],
        "underlying_molit_run": index["underlying_molit_run"],
        "coverage_district_count": index["coverage_district_count"],
        "candidate_unit_count": index["candidate_unit_count"],
        "disclaimer": "MOLIT FIRST SOURCE ONLY. Household count unknown, 500+ not confirmed; no independent transaction cross-check",
        "entries": [
            {**{k: row[k] for k in brief_fields}, "households": None, "verified": False}
            for row in index["entries"]
        ],
    }
    summary_path = args.output.parent / "summary.json"
    summary_tmp = summary_path.with_suffix(".tmp")
    summary_tmp.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    summary_tmp.replace(summary_path)
    print(f"Discovery: {len(index['entries'])} unverified exact-apartment/subtype groups from {len(staging['records'])} staged records")
    print("No household-size or independent-source evidence inferred.")


if __name__=="__main__":
    main()
