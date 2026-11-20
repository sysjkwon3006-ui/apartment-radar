#!/usr/bin/env python3
"""One-time public staging migration preserving all filings while dropping redundant keys."""
from __future__ import annotations
import json
from pathlib import Path
import collect_molit as c

path=Path(__file__).resolve().parents[1]/"data"/"molit"/"latest.json"
source=json.loads(path.read_text(encoding="utf-8"))
before=path.stat().st_size
count=len(source["records"])
c.atomic_json(path,source)
after=path.stat().st_size
check=json.loads(path.read_text(encoding="utf-8"))
assert len(check["records"])==count, "Unexpected record loss"
assert check.get("independently_verified") is False, "Safety flag missing"
assert after < 25*1024*1024, "Still above 25 MiB Cloudflare Pages asset limit"
print(f"SAFE COMPACTION: {count:,} records, {before:,} -> {after:,} bytes, saved {100*(before-after)/before:.1f}%")
