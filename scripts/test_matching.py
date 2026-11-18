"""Offline regression tests for conservative lot/area candidate matching."""
import unittest
import match_candidates as m


def complex_info(ident="a", name="과천푸르지오벨라르테", lot="갈현동 824",
                 area=84.9763):
    return {
        "id": ident, "name": name, "region": "과천", "neighborhood": "갈현동",
        "lot_address": lot, "households": 504, "types": [{"area_m2": area}],
        "verification": {"status": "pending"},
    }


def record(name="과천푸르지오벨라르테", lot="824", area=84.9763,
           date="2026-10-30", kind="sale", code="41290"):
    return {
        "region_code": code, "legal_dong": "갈현동", "jibun": lot,
        "apartment_name": name, "area_m2": area, "contract_date": date,
        "record_kind": kind, "floor": 6, "method": "brokered", "cancelled": False,
        "price_100m": 19.0, "provisional_record_hash": "record001",
        "verification_status": "primary_only",
        "lease_type": "new", "rent_category": "jeonse",
        "deposit_100m": 9.4,
    }


class MatchingTests(unittest.TestCase):
    def build(self, apartments, records):
        return m.build_queue({"generated_at_utc": "2026-11-18T13:04:23Z", "records": records},
                             {"complexes": apartments})

    def test_exact_match_is_provisional_not_verified(self):
        q = self.build([complex_info()], [record()])
        self.assertEqual(q["totals"]["provisional_matches"], 1)
        self.assertEqual(q["totals"]["secondary_source_verified"], 0)
        g = q["candidate_groups"][0]
        self.assertEqual(g["match_reasons"]["exact_lot_area_name"], 1)
        self.assertEqual(g["units"][0]["sales"][0]["verification_status"], "FIRST_SOURCE_ONLY")
        self.assertFalse(g["units"][0]["sales"][0]["independent_source_confirmed"])

    def test_name_punctuation_and_spaces_only(self):
        self.assertEqual(m.normalize_name("과천푸르지오 (벨라르테)"),
                         m.normalize_name("과천 푸르지오벨라르테"))
        q = self.build([complex_info()], [record(name="과천푸르지오 (벨라르테)")])
        self.assertEqual(q["totals"]["address_area_name_exact"], 1)

    def test_matching_address_but_different_name_flagged(self):
        q = self.build([complex_info()], [record(name="인접 단지")])
        self.assertEqual(q["totals"]["name_needs_review"], 1)
        self.assertEqual(q["candidate_groups"][0]["units"][0]["counts"]["name_conflicts"], 1)
        self.assertIn("NAME_REVIEW", q["candidate_groups"][0]["units"][0]["sales"][0]["match_reason"])

    def test_similar_name_different_lot_not_merged(self):
        q = self.build([complex_info()], [record(lot="825")])
        self.assertEqual(q["totals"]["not_in_registry"], 1)
        self.assertFalse(q["candidate_groups"])

    def test_wrong_region_not_merged(self):
        q = self.build([complex_info()], [record(code="41135")])
        self.assertFalse(q["candidate_groups"])

    def test_wrong_subtype_not_merged(self):
        q = self.build([complex_info()], [record(area=84.95)])
        self.assertEqual(q["totals"]["registered_lot_but_area_unlisted"], 1)
        self.assertFalse(q["candidate_groups"])

    def test_marginal_rounding_is_allowed(self):
        q = self.build([complex_info(area=84.97)], [record(area=84.9763)])
        self.assertEqual(q["totals"]["provisional_matches"], 1)

    def test_multiple_candidates_same_location_area_is_ambiguous(self):
        q = self.build([complex_info("a"), complex_info("b")], [record()])
        self.assertEqual(q["totals"]["ambiguous_registry_match"], 1)
        self.assertEqual(q["totals"]["provisional_matches"], 0)
        self.assertEqual(q["sample_conflicts"][0]["reason"], "ambiguous_registry_match")

    def test_incomplete_registry_not_guessed(self):
        q = self.build([complex_info(lot=None)], [record()])
        self.assertEqual(q["totals"]["registry_without_exact_lot"], 1)
        self.assertEqual(q["totals"]["not_in_registry"], 1)

    def test_direct_and_cancelled_preserved_not_called_brokered(self):
        a, b = record(), record(date="2026-10-31")
        a["method"] = "direct"
        b["cancelled"] = True
        q = self.build([complex_info()], [a, b])
        u = q["candidate_groups"][0]["units"][0]
        self.assertEqual(u["counts"]["direct_sales"], 1)
        self.assertEqual(u["counts"]["cancelled_sales"], 1)
        self.assertEqual(u["counts"]["brokered_sales"], 0)

    def test_only_new_jeonse_counts_as_new_jeonse(self):
        a, b, c = [record(kind="rent") for _ in range(3)]
        a["lease_type"], a["rent_category"] = "new", "jeonse"
        b["lease_type"], b["rent_category"] = "renewal", "jeonse"
        c["lease_type"], c["rent_category"] = "new", "monthly_or_unknown"
        q = self.build([complex_info()], [a, b, c])
        u = q["candidate_groups"][0]["units"][0]
        self.assertEqual(u["counts"]["new_jeonse"], 1)
        self.assertEqual(u["counts"]["other_rent"], 2)

    def test_lot_normalization(self):
        self.assertEqual(m.parse_lot("갈현동 00824-0000"), ("갈현동", "824"))
        self.assertEqual(m.parse_lot("갈현동 824-1"), ("갈현동", "824-1"))
        self.assertNotEqual(m.parse_lot("갈현동 824"), m.parse_lot("갈현동 824-1"))


if __name__ == "__main__":
    unittest.main()
