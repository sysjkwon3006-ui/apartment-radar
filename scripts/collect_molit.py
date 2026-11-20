#!/usr/bin/env python3
"""Collect MOLIT reported apartment sales and rent into UNVERIFIED staging only.

NO independent secondary source check, complex auto-matching, valuation,
or promotion to data/complexes.json takes place here.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REGIONS_PATH = ROOT / "data" / "regions.json"
STAGING_PATH = ROOT / "data" / "molit" / "latest.json"
META_PATH = ROOT / "data" / "site-meta.json"

ENDPOINTS = {
    "sale": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
}
SOURCE_PAGES = {
    "sale": "https://www.data.go.kr/data/15126468/openapi.do",
    "rent": "https://www.data.go.kr/data/15126474/openapi.do",
}
PAGE_SIZE = 1000
MAX_PAGES = 100
MAX_CALLS = 2000
RETRY_COUNT = 3


class APIError(RuntimeError):
    pass


def clean(s: str | None) -> str:
    return (s or "").strip()


def first(record: dict, *keys: str) -> str:
    for k in keys:
        if clean(record.get(k)):
            return clean(record[k])
    return ""


def number(s: str | None) -> int | None:
    v = re.sub(r"[\s,]", "", clean(s))
    return int(v) if v and re.fullmatch(r"-?\d+", v) else None


def decimal(s: str | None) -> float | None:
    v = re.sub(r"[\s,]", "", clean(s))
    try:
        return float(v) if v else None
    except ValueError:
        return None


def contract_date(raw: dict) -> str | None:
    y = number(first(raw, "dealYear", "year"))
    m = number(first(raw, "dealMonth", "month"))
    d = number(first(raw, "dealDay", "day"))
    if y is None or m is None or d is None:
        return None
    try:
        return datetime(y, m, d).date().isoformat()
    except ValueError:
        return None


def month_list(n: int) -> list[str]:
    today = datetime.now(timezone.utc).astimezone().date()
    # GitHub runner is UTC; for contract month use KST.
    from datetime import timedelta
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    index = today.year * 12 + today.month - 1
    result = []
    for offset in range(n):
        year, month_zero = divmod(index - offset, 12)
        result.append(f"{year:04d}{month_zero + 1:02d}")
    return result


def parse_page(payload: bytes) -> tuple[list[dict], int]:
    try:
        xml = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise APIError("Unparseable API XML response; no staged data written") from exc

    code = xml.findtext(".//resultCode")
    message = xml.findtext(".//resultMsg") or "API response error"
    if code is not None and clean(code) not in ("00", "000", "0", "NORMAL_SERVICE"):
        raise APIError(f"MOLIT response error {clean(code)}: {clean(message)[:90]}")
    body = xml.find(".//body")
    if body is None:
        raise APIError("MOLIT API response has no body; refusing empty success")
    items_node = body.find("items")
    records = []
    if items_node is not None:
        for item in items_node.findall("item"):
            records.append({node.tag.split("}")[-1]: clean(node.text) for node in item})
    total_str = body.findtext("totalCount")
    if total_str is None:
        raise APIError("MOLIT API response has no totalCount; refusing partial result")
    try:
        total = int(total_str)
    except ValueError as exc:
        raise APIError("MOLIT totalCount is malformed") from exc
    return records, total


def fetch_xml(endpoint: str, params: dict) -> bytes:
    # serviceKey is included in the URL for the agency gateway. NEVER log URL.
    query = urlencode(params)
    req = Request(endpoint + "?" + query, headers={"User-Agent": "ApartmentRadar/0.2", "Accept": "application/xml"})
    for attempt in range(RETRY_COUNT):
        try:
            with urlopen(req, timeout=30) as response:
                payload = response.read(15_000_000)
                if len(payload) >= 15_000_000:
                    raise APIError("API response exceeds safety size cap")
                return payload
        except HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == RETRY_COUNT - 1:
                raise APIError(f"MOLIT HTTP status {exc.code}") from None
        except (URLError, TimeoutError) as exc:
            if attempt == RETRY_COUNT - 1:
                raise APIError("MOLIT transport/timeout error") from None
        time.sleep(2 ** attempt)
    raise APIError("MOLIT request failed")


def fetch_all(kind: str, code: str, month: str, key: str, counter: list[int]) -> list[dict]:
    collected = []
    for page in range(1, MAX_PAGES + 1):
        counter[0] += 1
        if counter[0] > MAX_CALLS:
            raise APIError("API call safety limit exceeded")
        params = {
            "serviceKey": key,
            "LAWD_CD": code,
            "DEAL_YMD": month,
            "pageNo": page,
            "numOfRows": PAGE_SIZE,
        }
        rows, total = parse_page(fetch_xml(ENDPOINTS[kind], params))
        if total > 0 and not rows and len(collected) < total:
            raise APIError(f"{kind} {code} {month}: unexpectedly empty page {page}")
        collected.extend(rows)
        if len(collected) >= total:
            return collected
        time.sleep(0.2)
    raise APIError(f"{kind} {code} {month}: incomplete pagination after {MAX_PAGES} pages")


def normalize(kind: str, region: dict, month: str, raw: dict) -> dict | None:
    date = contract_date(raw)
    area = decimal(first(raw, "excluUseAr", "excluUseArea", "exclusiveArea"))
    apt = first(raw, "aptNm", "aptName")
    if not date or not apt or area is None or not ((80 <= area <= 90) or (100 <= area <= 135)):
        return None
    core = {
        "source": "MOLIT_OPEN_API",
        "source_page": SOURCE_PAGES[kind],
        "source_verified_independently": False,
        "verification_status": "primary_only",
        "region_code": region["code"],
        "region_name": region["name"],
        "requested_month": month,
        "contract_date": date,
        "apartment_name": apt,
        "apartment_seq": first(raw, "aptSeq"),
        "legal_dong": first(raw, "umdNm"),
        "jibun": first(raw, "jibun"),
        "road_name": first(raw, "roadNm"),
        "road_main_no": first(raw, "roadNmBonbun"),
        "road_sub_no": first(raw, "roadNmBubun"),
        "area_m2": area,
        "floor": number(first(raw, "floor")),
        "build_year": number(first(raw, "buildYear")),
        "record_kind": kind,
        "complex_id": None,
        "match_status": "not_matched",
    }
    if kind == "sale":
        amount = number(first(raw, "dealAmount"))
        if amount is None:
            return None
        method = first(raw, "dealingGbn")
        cancelled_flag = first(raw, "cdealType", "cdealDay")
        core.update({
            "amount_10k_krw": amount,
            "price_100m": round(amount / 10000, 4),
            "method": "brokered" if "중개" in method else ("direct" if "직거래" in method else "unknown"),
            "cancelled": cancelled_flag in ("O", "Y", "1", "해제") or bool(first(raw, "cdealDay")),
            "cancelled_on": first(raw, "cdealDay") or None,
        })
    else:
        deposit = number(first(raw, "deposit"))
        rent = number(first(raw, "monthlyRent"))
        if deposit is None:
            return None
        contract_type = first(raw, "contractType")
        core.update({
            "deposit_10k_krw": deposit,
            "deposit_100m": round(deposit / 10000, 4),
            "monthly_rent_10k_krw": rent,
            "lease_type": "new" if "신규" in contract_type else ("renewal" if "갱신" in contract_type else "unknown"),
            "rent_category": "jeonse" if rent == 0 else "monthly_or_unknown",
            "renewal_right": first(raw, "useRRRight") or None,
        })
    identity = "|".join(str(core[k]) for k in (
        "record_kind", "region_code", "contract_date", "apartment_seq",
        "apartment_name", "jibun", "area_m2", "floor"
    ))
    # Include relevant reported attributes to avoid silently treating distinct
    # contracts as one. This isn't an official unique transaction identifier.
    identity += "|" + str(core.get("amount_10k_krw", core.get("deposit_10k_krw"))) + "|" + str(core.get("monthly_rent_10k_krw", ""))
    core["provisional_record_hash"] = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return core


def atomic_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    # Large public staging files are served by static hosting: keep them compact.
    packed = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if path == STAGING_PATH else json.dumps(obj, ensure_ascii=False, indent=2)
    temp.write_text(packed + "\n", encoding="utf-8")
    temp.replace(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--months", type=int, default=3, help="Look back N contract months incl. current; 1..24")
    ap.add_argument("--region-codes", default="", help="Optional comma-separated region codes for local diagnostics")
    args = ap.parse_args()
    if not 1 <= args.months <= 24:
        ap.error("--months must be 1..24")
    key = clean(os.getenv("MOLIT_API_KEY"))
    if not key:
        print("MOLIT_API_KEY missing. Add repository Actions secret. No changes made.", file=sys.stderr)
        return 2
    # Public data portal users may copy the percent-encoded 'encoding key'.
    if re.search(r"%[0-9a-fA-F]{2}", key):
        key = unquote(key)
    config = json.loads(REGIONS_PATH.read_text(encoding="utf-8"))
    codes = set(x.strip() for x in args.region_codes.split(",") if x.strip())
    regions = [r for r in config["regions"] if not codes or r["code"] in codes]
    if codes and {r["code"] for r in regions} != codes:
        ap.error("--region-codes includes a code not present in data/regions.json")
    if not regions:
        ap.error("No regions configured")
    selected_months = month_list(args.months)
    counter = [0]
    records = []
    per_region = []
    counts = {"sale": 0, "rent": 0, "sale_in_scope": 0, "rent_in_scope": 0}
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for region in regions:
        region_counts = {"region_code": region["code"], "region_name": region["name"], "sale": 0, "rent": 0}
        for month in selected_months:
            for kind in ("sale", "rent"):
                rows = fetch_all(kind, region["code"], month, key, counter)
                counts[kind] += len(rows)
                for raw in rows:
                    record = normalize(kind, region, month, raw)
                    if record:
                        records.append(record)
                        counts[kind + "_in_scope"] += 1
                        region_counts[kind] += 1
        per_region.append(region_counts)
        print(f"{region['name']}: staged relevant {region_counts['sale']} sales and {region_counts['rent']} rents")
    if not counts["sale"] and not counts["rent"]:
        raise APIError("All regions returned 0 records; aborting publication to prevent empty overwrite")
    records.sort(key=lambda r: (r["contract_date"], r["region_code"], r["record_kind"], r["provisional_record_hash"]), reverse=True)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    staging = {
        "schema_version": "1.0",
        "generated_at_utc": generated,
        "source": "MOLIT APIs only; NO independent secondary source check",
        "disclaimer": "Automated public filings only, NOT verified market prices, no matching to confirmed complexes",
        "periods": selected_months,
        "region_count": len(regions),
        "request_count": counter[0],
        "counts": counts,
        "regions": per_region,
        "records": records,
    }
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    meta.update({
        "last_pipeline_run": generated,
        "pipeline_state": "primary_collected_needs_independent_review",
        "message": f"국토부 1차 수집 완료 · 매매 {counts['sale_in_scope']:,}건 / 전월세 {counts['rent_in_scope']:,}건 (선택 면적) · 2차 검증 대기",
        "data_version": "molit-" + generated[:10],
    })
    # Only persist after all API pages have succeeded.
    atomic_json(STAGING_PATH, staging)
    atomic_json(META_PATH, meta)
    print(f"Success: {counter[0]} API calls, {len(records)} unverified staged rows, generated {generated}")
    print("No entries in data/complexes.json were modified or marked verified.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except APIError as exc:
        print(f"Collection aborted: {exc}", file=sys.stderr)
        raise SystemExit(1)
