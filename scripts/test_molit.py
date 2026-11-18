"""Offline fixture tests; no API key or network calls needed."""
import unittest

import collect_molit as m


SALE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><aptNm>Example Complex</aptNm><dealAmount>185,000</dealAmount>
<dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>15</dealDay>
<excluUseAr>84.91</excluUseAr><floor>12</floor><dealingGbn>중개거래</dealingGbn>
<jibun>789</jibun><umdNm>성복동</umdNm></item></items>
<numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>""".decode().encode()

RENT_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><aptNm>Example Complex</aptNm><deposit>90,000</deposit>
<monthlyRent>0</monthlyRent><contractType>신규</contractType>
<dealYear>2026</dealYear><dealMonth>10</dealMonth><dealDay>19</dealDay>
<excluUseAr>84.91</excluUseAr><floor>10</floor><jibun>789</jibun></item></items>
<totalCount>1</totalCount></body></response>""".decode().encode()


class MolicCollectorTests(unittest.TestCase):
    region = {"code": "41465", "name": "경기 용인시 수지구"}

    def test_sale_xml_parse(self):
        rows, total = m.parse_page(SALE_XML)
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]["dealAmount"], "185,000")
        record = m.normalize("sale", self.region, "202610", rows[0])
        self.assertEqual(record["method"], "brokered")
        self.assertEqual(record["price_100m"], 18.5)
        self.assertEqual(record["verification_status"], "primary_only")
        self.assertIsNone(record["complex_id"])
        self.assertFalse(record["cancelled"])

    def test_rent_xml_parse(self):
        rows, total = m.parse_page(RENT_XML)
        self.assertEqual(total, 1)
        record = m.normalize("rent", self.region, "202610", rows[0])
        self.assertEqual(record["deposit_100m"], 9.0)
        self.assertEqual(record["lease_type"], "new")
        self.assertEqual(record["rent_category"], "jeonse")
        self.assertEqual(record["source_verified_independently"], False)

    def test_cancellation_is_not_eligible(self):
        raw, _ = m.parse_page(SALE_XML)
        raw[0]["cdealType"] = "O"
        record = m.normalize("sale", self.region, "202610", raw[0])
        self.assertTrue(record["cancelled"])

    def test_direct_not_brokered(self):
        raw, _ = m.parse_page(SALE_XML)
        raw[0]["dealingGbn"] = "직거래"
        record = m.normalize("sale", self.region, "202610", raw[0])
        self.assertEqual(record["method"], "direct")

    def test_contract_type_unknown_not_new(self):
        raw, _ = m.parse_page(RENT_XML)
        raw[0]["contractType"] = ""
        record = m.normalize("rent", self.region, "202610", raw[0])
        self.assertEqual(record["lease_type"], "unknown")

    def test_failure_response_cannot_publish_as_empty(self):
        payload = b"<response><header><resultCode>20</resultCode><resultMsg>ACCESS DENIED</resultMsg></header></response>"
        with self.assertRaises(m.APIError):
            m.parse_page(payload)

    def test_filter_other_area(self):
        raw, _ = m.parse_page(SALE_XML)
        raw[0]["excluUseAr"] = "59.99"
        self.assertIsNone(m.normalize("sale", self.region, "202610", raw[0]))

    def test_number_currency(self):
        self.assertEqual(m.number(" 150,500 "), 150500)
        self.assertIsNone(m.number("unknown"))

    def test_months_count(self):
        a = m.month_list(3)
        self.assertEqual(len(a), 3)
        self.assertTrue(all(len(x) == 6 and x.isdigit() for x in a))


if __name__ == "__main__":
    unittest.main()
