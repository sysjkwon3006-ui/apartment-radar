"""Safety regression tests for Cloudflare asset-sized public staging."""
import unittest
import collect_molit as c

class CompactStagingTests(unittest.TestCase):
    def test_preserves_identity_and_cancellation_status(self):
        row={
            "region_code":"41135","region_name":"경기 성남시 분당구",
            "contract_date":"2026-11-20","requested_month":"202611",
            "apartment_name":"테스트단지","apartment_seq":"APT001",
            "legal_dong":"금곡동","jibun":"141","area_m2":129.45,"floor":7,
            "record_kind":"sale","price_100m":20.4,"method":"brokered",
            "cancelled":True,"cancelled_on":"2026-11-21",
            "source":"MOLIT_OPEN_API","source_page":"https://data.go.kr/x",
            "verification_status":"primary_only","road_name":"Some road",
            "source_verified_independently":False,"provisional_record_hash":"abc",
        }
        data={"generated_at_utc":"2026-11-20T15:00:00Z","records":[row]}
        out=c.compact_staging(data)
        self.assertEqual(len(out["records"]),1)
        got=out["records"][0]
        for key in ("region_code","contract_date","requested_month","apartment_name","jibun","area_m2","floor","price_100m","cancelled","cancelled_on","provisional_record_hash"):
            self.assertEqual(got[key],row[key])
        self.assertNotIn("source_page",got)
        self.assertNotIn("road_name",got)
        self.assertFalse(out["independently_verified"])
        self.assertEqual(out["record_source"],"MOLIT_OPEN_API_PRIMARY_ONLY")
        self.assertEqual(out["generated_at_utc"],data["generated_at_utc"])

    def test_retains_lease_details(self):
        row={
            "region_code":"11680","region_name":"서울 강남구","contract_date":"2026-11-20","requested_month":"202611",
            "apartment_name":"가상단지","legal_dong":"대치동","jibun":"1","area_m2":84.9,"floor":4,
            "record_kind":"rent","deposit_100m":12.0,"monthly_rent_10k_krw":0,
            "lease_type":"new","rent_category":"jeonse","renewal_right":None
        }
        out=c.compact_staging({"records":[row]})
        r=out["records"][0]
        self.assertEqual(r["deposit_100m"],12.0)
        self.assertEqual(r["monthly_rent_10k_krw"],0)
        self.assertEqual(r["lease_type"],"new")
        self.assertEqual(r["rent_category"],"jeonse")

if __name__=="__main__":
    unittest.main()
