"""Offline tests for the agent's arithmetic, index checks and input handling."""
import json, os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "agent"))
import indices, rent, reader

V = json.load(open(os.path.join(HERE, "vectors.json")))


class Rent(unittest.TestCase):
    def test_vectors(self):
        for c in V["cases"]:
            if "missing" in c:
                with self.assertRaises(rent.NotPublished):
                    rent.rent_for_month(c["lease"], c["month"], V["indices"])
            else:
                self.assertEqual(rent.rent_for_month(c["lease"], c["month"], V["indices"])["amount"], c["amount"], c)

    def test_first_period_is_the_contract_amount(self):
        L = {"baseRent": 500000, "startDate": "2026-02-01", "periodMonths": 3, "index": "IPC", "lagMonths": 2}
        self.assertEqual(rent.rent_for_month(L, "2026-04", V["indices"])["amount"], 500000)

    def test_hand_computed_ipc_case(self):
        # Quarterly IPC from February 2026, November rent: INDEC Sep 2026 12514.1508 over Dec 2025 10121.3715
        ipc = {"2025-12": 10121.3715, "2026-09": 12514.1508, "2026-06": 11826.4103}
        L = {"baseRent": 1700, "startDate": "2026-02-01", "periodMonths": 3, "index": "IPC", "lagMonths": 2}
        r = rent.rent_for_month(L, "2026-11", {"ipc": ipc, "icl": {}})
        self.assertEqual(r["amount"], 2102)                 # 1700 * 1.236409 = 2101.9
        self.assertEqual(r["monthsUsed"], ["2026-07", "2026-08", "2026-09"])

    def test_rounds_half_up(self):
        self.assertEqual(rent.round_pesos(10.5), 11)
        self.assertEqual(rent.round_pesos(10.49), 10)

    def test_month_before_start_is_refused(self):
        L = {"baseRent": 1000, "startDate": "2026-02-01", "periodMonths": 3, "index": "FIJO", "fixedPct": 10}
        with self.assertRaises(ValueError):
            rent.rent_for_month(L, "2026-01", V["indices"])


class Indices(unittest.TestCase):
    def test_disagreeing_sources_are_reported(self):
        ipc = {"2026-08": 12276.766, "2026-09": 12514.1508}
        self.assertEqual(indices.check(ipc, {"2026-08": 12276.766}, {"2026-09-30": 1.9}), [])
        self.assertTrue(indices.check(ipc, {"2026-08": 12300.0}, {}))           # level differs from the series API
        self.assertTrue(indices.check(ipc, {}, {"2026-09-30": 2.4}))            # rate differs from BCRA

    def test_indec_layout_change_stops_the_parser(self):
        with self.assertRaises(ValueError):
            indices.parse_indec("Codigo;Otra;Cosa\n".encode("latin-1"))


class Reader(unittest.TestCase):
    def test_only_valid_fields_survive(self):
        good = {"baseRent": 550000, "startDate": "2026-03-01", "dueDay": 10, "index": "IPC", "periodMonths": 4}
        self.assertEqual(reader.validate(good), good)
        bad = {"baseRent": "todo tu dinero", "startDate": "mañana", "dueDay": 45, "index": "<script>", "periodMonths": 7, "payout": "0xevil"}
        self.assertEqual(reader.validate(bad), {})


if __name__ == "__main__":
    unittest.main(verbosity=1)
