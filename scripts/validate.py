#!/usr/bin/env python3
"""Validate data without asserting independent source verification automatically."""
import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "data/complexes.json").read_text(encoding="utf-8"))
meta = json.loads((ROOT / "data/site-meta.json").read_text(encoding="utf-8"))
complexes = data["complexes"]
assert isinstance(complexes, list)
ids = set()
errors = []
for c in complexes:
    i = c.get("id")
    if not i or i in ids:
        errors.append(f"Duplicate/missing ID: {i}")
    ids.add(i)
    status = c.get("verification", {}).get("status")
    if status not in {"pending", "verified", "excluded"}:
        errors.append(f"{i}: invalid verification status {status}")
    if not isinstance(c.get("types"), list):
        errors.append(f"{i}: area types list missing")
    if status != "verified":
        continue
    if not c.get("address") or not c.get("lot_address") or not c.get("built_year"):
        errors.append(f"{i}: static fields missing")
    if c.get("households", 0) < 500:
        errors.append(f"{i}: fewer than 500 households")
    if not c.get("verification", {}).get("checked_at"):
        errors.append(f"{i}: missing verification date")
    for field in ("static_sources", "sales_sources", "lease_sources"):
        src = c.get(field, [])
        orgs = {s.get("organization") for s in src if s.get("url") and s.get("organization")}
        if len(orgs) < 2:
            errors.append(f"{i}: {field} needs 2 independent evidenced organizations")
    sales = [r for r in c.get("sales", []) if r.get("verified") is True and r.get("type") == "brokered" and not r.get("cancelled")]
    leases = [r for r in c.get("leases", []) if r.get("verified") is True and r.get("type") == "new" and not r.get("cancelled")]
    if not (3 <= len(sales) or len(sales) >= 3):
        errors.append(f"{i}: fewer than 3 verified brokered sales")
    if len(leases) < 3:
        errors.append(f"{i}: fewer than 3 verified new leases")
    if not any(t.get("status") == "verified" for t in c.get("types", [])):
        errors.append(f"{i}: no verified area type")
    for group,arr in [("sale",sales),("lease",leases)]:
        for r in arr:
            if not all(r.get(k) is not None for k in ("date", "floor", "area_m2", "price_100m")):
                errors.append(f"{i}: incomplete {group}")
            else:
                try:
                    date.fromisoformat(r["date"])
                except ValueError:
                    errors.append(f"{i}: malformed {group} date")
            if not r.get("evidence") or len(set(r.get("evidence", []))) < 2:
                errors.append(f"{i}: {group} record lacks two evidence references")
if errors:
    print("Validation failed:")
    print("\n".join("  - "+x for x in errors))
    raise SystemExit(1)
print(f"Validation OK: {len(complexes)} candidates, {sum(x['verification']['status']=='verified' for x in complexes)} verified.")
print("Data collection and independent review are NOT part of this validation task.")
