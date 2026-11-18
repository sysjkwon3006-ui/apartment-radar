#!/usr/bin/env python3
"""Build a conservative, public-source ONLY candidate matching review queue.

Important:
- An exact lot/address/area/name match is only a CANDIDATE match.
- No record or apartment becomes independently verified.
- This script NEVER edits data/complexes.json or the TOP5 rankings.
- When lot/area/name is missing or ambiguous, refuse silent matching.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
STAGING = ROOT / "data" / "molit" / "latest.json"
CANDIDATES = ROOT / "data" / "complexes.json"
OUTPUT = ROOT / "data" / "matches" / "latest.json"
REGION_CODES = {
    "과천": "41290", "분당": "41135", "판교": "41135",
    "수지": "41465", "광교": "41117", "서초": "11650",
    "강남": "11680", "송파": "11710", "강동": "11740",
    "동탄": "41597",
}
AREA_TOLERANCE = 0.009  # sqm, cautious rounding allowance (<0.01); no broad 84㎡ grouping
SAMPLE_LIMIT = 8


def normalize_name(s: str | None) -> str:
    # Punctuation and spacing only. NO partial string/fuzzy similarity.
    return re.sub(r"[^0-9a-z가-힣]", "", (s or "").lower())


def parse_lot(s: str | None) -> tuple[str, str] | None:
    """Given e.g. '수내동 36', '구미동 0012-0003', return normalized lot."""
    m = re.match(r"^\s*([가-힣0-9]+(?:동|읍|면|리))\s+(\d+)(?:-(\d+))?\s*$", s or "")
    if not m:
        return None
    main = int(m.group(2))
    sub = int(m.group(3) or 0)
    return (m.group(1), str(main) + (("-" + str(sub)) if sub else ""))


def registry_key(c: dict) -> tuple[str, str, str] | None:
    code = REGION_CODES.get(c.get("region", ""))
    lot = parse_lot(c.get("lot_address"))
    if not code or not lot:
        return None
    return (code, lot[0], lot[1])


def raw_key(r: dict) -> tuple[str, str, str] | None:
    lot = parse_lot((r.get("legal_dong") or "") + " " + (r.get("jibun") or ""))
    if not lot or not r.get("region_code"):
        return None
    return (r["region_code"], lot[0], lot[1])


def exact_area(c: dict, r: dict) -> float | None:
    a = r.get("area_m2")
    if not isinstance(a, (int, float)):
        return None
    matches = []
    for t in c.get("types") or []:
        b = t.get("area_m2")
        if isinstance(b, (int, float)) and abs(a - b) <= AREA_TOLERANCE:
            matches.append((abs(a - b), b))
    if len(matches) != 1:
        return None
    return matches[0][1]


def name_matches(c: dict, r: dict) -> bool:
    name = normalize_name(r.get("apartment_name"))
    allowed = [c.get("name", "")] + (c.get("verified_aliases") or [])
    return bool(name) and name in set(map(normalize_name, allowed))


def compact_transaction(r: dict, reason: str, unit_area: float) -> dict:
    keys = ("provisional_record_hash", "contract_date", "apartment_name", "legal_dong",
            "jibun", "apartment_seq", "area_m2", "floor", "record_kind",
            "method", "cancelled", "cancelled_on", "price_100m",
            "deposit_100m", "monthly_rent_10k_krw", "lease_type", "rent_category")
    compact = {k: r[k] for k in keys if k in r}
    compact["matched_registered_area_m2"] = unit_area
    compact["match_reason"] = reason
    compact["verification_status"] = "FIRST_SOURCE_ONLY"
    compact["independent_source_confirmed"] = False
    return compact


def initial_group(c: dict) -> dict:
    return {
        "complex_id": c["id"],
        "registered_name": c["name"],
        "region": c.get("region"),
        "neighborhood": c.get("neighborhood"),
        "lot_address": c.get("lot_address"),
        "households_from_pending_registry": c.get("households"),
        "static_information_verified": c.get("verification", {}).get("status") == "verified",
        "status": "NEEDS_INDEPENDENT_REVIEW",
        "units": {},
        "match_reasons": {},
    }


def build_queue(staging: dict, candidates: dict) -> dict:
    records = staging.get("records")
    if not isinstance(records, list):
        raise ValueError("staging must contain records list")
    if not staging.get("generated_at_utc"):
        raise ValueError("missing collector run timestamp")
    index = defaultdict(list)
    missing_keys = []
    duplicate_registry_locations = Counter()
    for c in candidates.get("complexes", []):
        if not isinstance(c.get("id"), str):
            raise ValueError("candidate missing ID")
        key = registry_key(c)
        if key is None:
            missing_keys.append({"complex_id": c["id"], "name": c.get("name"), "reason": "missing_region_or_exact_lot"})
            continue
        index[key].append(c)
        duplicate_registry_locations[key] += 1

    groups = {c["id"]: initial_group(c) for c in candidates.get("complexes", [])}
    stats = Counter({"provisional_matches": 0, "name_needs_review": 0, "address_area_name_exact": 0, "ambiguous_registry_match": 0, "registered_lot_but_area_unlisted": 0, "not_in_registry": 0})
    conflicts = []
    for r in records:
        stats["staged_rows"] += 1
        key = raw_key(r)
        if key is None:
            stats["raw_missing_lot"] += 1
            continue
        possible = index.get(key, [])
        if not possible:
            stats["not_in_registry"] += 1
            continue
        options = [(c, exact_area(c, r)) for c in possible]
        options = [(c, area) for c, area in options if area is not None]
        if not options:
            stats["registered_lot_but_area_unlisted"] += 1
            if len(conflicts) < 60:
                conflicts.append({
                    "reason": "registered_lot_but_area_unlisted",
                    "region_code": key[0], "lot": key[1] + " " + key[2],
                    "raw_apartment": r.get("apartment_name"),
                    "raw_area": r.get("area_m2"),
                })
            continue
        if len(options) != 1:
            stats["ambiguous_registry_match"] += 1
            if len(conflicts) < 60:
                conflicts.append({
                    "reason": "ambiguous_registry_match",
                    "region_code": key[0], "lot": key[1] + " " + key[2],
                    "candidate_ids": [c["id"] for c, _ in options],
                    "raw_apartment": r.get("apartment_name"), "raw_area": r.get("area_m2"),
                })
            continue
        c, unit_area = options[0]
        is_name_match = name_matches(c, r)
        reason = "exact_lot_area_name" if is_name_match else "exact_lot_area_NAME_REVIEW"
        g = groups[c["id"]]
        akey = f"{unit_area:.4f}"
        unit = g["units"].setdefault(akey, {
            "registered_area_m2": unit_area,
            "counts": {"sales": 0, "new_jeonse": 0, "other_rent": 0,
                       "brokered_sales": 0, "direct_sales": 0,
                       "cancelled_sales": 0, "unknown_sale_method": 0,
                       "name_conflicts": 0},
            "sales": [], "new_jeonse": [], "other_rent": [],
        })
        if not is_name_match:
            stats["name_needs_review"] += 1
            unit["counts"]["name_conflicts"] += 1
        else:
            stats["address_area_name_exact"] += 1
        g["match_reasons"][reason] = g["match_reasons"].get(reason, 0) + 1
        compact = compact_transaction(r, reason, unit_area)
        if r.get("record_kind") == "sale":
            unit["counts"]["sales"] += 1
            if r.get("cancelled"):
                unit["counts"]["cancelled_sales"] += 1
            elif r.get("method") == "brokered":
                unit["counts"]["brokered_sales"] += 1
            elif r.get("method") == "direct":
                unit["counts"]["direct_sales"] += 1
            else:
                unit["counts"]["unknown_sale_method"] += 1
            unit["sales"].append(compact)
        elif r.get("record_kind") == "rent":
            if r.get("lease_type") == "new" and r.get("rent_category") == "jeonse":
                unit["counts"]["new_jeonse"] += 1
                unit["new_jeonse"].append(compact)
            else:
                unit["counts"]["other_rent"] += 1
                unit["other_rent"].append(compact)
        else:
            stats["unknown_record_kind"] += 1
            continue
        stats["provisional_matches"] += 1

    listed = []
    for c in candidates.get("complexes", []):
        g = groups[c["id"]]
        if not g["units"]:
            continue
        for unit in g["units"].values():
            for field in ("sales", "new_jeonse", "other_rent"):
                unit[field].sort(key=lambda r: (r.get("contract_date", ""), r.get("provisional_record_hash", "")), reverse=True)
                unit[field] = unit[field][:SAMPLE_LIMIT]
        g["units"] = [g["units"][area] for area in sorted(g["units"], key=float)]
        g["provisional_total"] = sum(sum(v for k, v in unit["counts"].items() if k in ("sales", "new_jeonse", "other_rent")) for unit in g["units"])
        listed.append(g)
    listed.sort(key=lambda c: (-c["provisional_total"], c["registered_name"]))
    return {
        "schema_version": "1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "underlying_molit_run": staging["generated_at_utc"],
        "basis": "STAGING ONLY: exact region + legal lot + subtype area; name must also match for exact-name class",
        "disclaimer": "NOT INDEPENDENTLY VERIFIED. No ranking, valuation, or approved transactions derived from this file.",
        "totals": {
            **dict(stats),
            "registry_candidates": len(candidates.get("complexes", [])),
            "registry_without_exact_lot": len(missing_keys),
            "provisional_complexes_with_rows": len(listed),
            "secondary_source_verified": 0,
        },
        "missing_registry_keys": missing_keys,
        "potential_registry_lot_collisions": [
            {"key": list(k), "count": n} for k, n in duplicate_registry_locations.items() if n > 1
        ],
        "sample_conflicts": conflicts,
        "candidate_groups": listed,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=STAGING)
    ap.add_argument("--output", type=Path, default=OUTPUT)
    args = ap.parse_args()
    if not args.input.exists():
        raise SystemExit("No collected MOLIT staging data; match queue not generated")
    data = json.loads(args.input.read_text(encoding="utf-8"))
    candidates = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    queue = build_queue(data, candidates)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(".tmp")
    temp.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(args.output)
    print("Provisional location+unit matches:", queue["totals"]["provisional_matches"])
    print("Candidate complexes with potential matching rows:", queue["totals"]["provisional_complexes_with_rows"])
    print("Names requiring review:", queue["totals"].get("name_needs_review", 0))
    print("Independent two-source verified: 0 (by design)")
    print("No modifications to approved complex prices or TOP5")


if __name__ == "__main__":
    main()
