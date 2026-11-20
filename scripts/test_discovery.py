"""Offline examples for widened discovery, including strict transaction types."""
import unittest
import build_discovery as d


class DiscoveryTests(unittest.TestCase):
    region = {"regions": [{"code": "11680", "name": "서울 강남구"}]}
    @staticmethod
    def sample(kind="sale", method="brokered", cancelled=False, lease_type="new", rent_category="jeonse", amount=21.1):
        return {
            "record_kind": kind,
            "region_code": "11680",
            "legal_dong": "대치동",
            "jibun": "123",
            "apartment_name": "검증대기테스트단지",
            "area_m2": 114.72,
            "floor": 12,
            "contract_date": "2026-11-10",
            "method": method,
            "cancelled": cancelled,
            "price_100m": amount,
            "deposit_100m": 9.1,
            "lease_type": lease_type,
            "rent_category": rent_category,
            "provisional_record_hash": "fixture",
        }
    def build(self, records):
        return d.build({"generated_at_utc": "2026-11-20T10:00:00Z", "periods": ["202611"], "records": records}, self.region)

    def test_public_first_source_never_claims_household_eligibility(self):
        a = self.build([self.sample()])
        self.assertEqual(len(a["entries"]), 1)
        self.assertIsNone(a["entries"][0]["households"])
        self.assertFalse(a["entries"][0]["verified"])
        self.assertFalse(a["entries"][0]["households_confirmed_500_plus"])

    def test_direct_and_cancelled_not_used_in_price(self):
        a = self.build([self.sample(method="direct",amount=13),self.sample(cancelled=True,amount=12),self.sample(amount=21.1)])
        self.assertEqual(a["entries"][0]["sale_count_displayed"], 1)
        self.assertEqual(a["entries"][0]["sale_median"], 21.1)

    def test_only_new_jeonse_is_lease(self):
        vals=[self.sample(),self.sample(kind="rent"),self.sample(kind="rent",lease_type="renewal"),self.sample(kind="rent",rent_category="monthly_or_unknown")]
        a=self.build(vals)
        self.assertEqual(a["entries"][0]["new_jeonse_count_all_in_period"], 1)
        self.assertEqual(a["entries"][0]["jeonse_ratio_reference"], round(9.1/21.1*100,1))

    def test_separate_lots_do_not_merge(self):
        p=self.sample();q=self.sample()
        q["jibun"]="124"
        a=self.build([p,q])
        self.assertEqual(len(a["entries"]),2)

    def test_excludes_unnamed_apartment(self):
        p=self.sample();p["apartment_name"]=""
        a=self.build([p])
        self.assertEqual(len(a["entries"]),0)

    def test_budget_range_uses_last_five_non_cancelled_sales(self):
        rows=[self.sample(amount=n) for n in [22,23,24,25,26,27]]
        a=self.build(rows)
        self.assertEqual(a["entries"][0]["sale_count_displayed"],5)
        self.assertEqual(a["entries"][0]["sale_min"],22)
        self.assertEqual(a["entries"][0]["sale_max"],26)
        self.assertEqual(a["entries"][0]["sale_median"],24)
        self.assertIn("20-30-large",a["entries"][0]["budget_groups"])

if __name__=="__main__":
    unittest.main()
