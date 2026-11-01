"""Offline tests for the agent's arithmetic, index checks and input handling."""
import json, os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "agent"))
import indices, rent, reader
import lease_ops as ops

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


class Charges(unittest.TestCase):
    def lease(self):
        return {"terms": {"baseRent": 1000, "startDate": "2026-01-01", "periodMonths": 3, "index": "FIJO", "fixedPct": 10, "lagMonths": 2,
                          "dueDay": 10, "propertyLabel": "x", "sweepBps": 0}, "charges": {}}

    def test_a_month_that_ended_unpaid_turns_late(self):
        l = self.lease()
        l["charges"]["2020-01"] = {"month": "2020-01", "status": "pendiente", "dueDate": "2020-01-10", "amount": 1000, "received": 0}
        self.assertTrue(ops.refresh_charges(l, {"ok": True, "ipc": {}, "icl": {}}, month="2030-01"))
        self.assertEqual(l["charges"]["2020-01"]["status"], "vencido")

    def test_no_new_amount_when_sources_disagree(self):
        l = self.lease()
        ops.refresh_charges(l, {"ok": False, "ipc": {}, "icl": {}}, month="2026-11")
        self.assertEqual(l["charges"]["2026-11"]["status"], "sin-indice")
        self.assertIsNone(l["charges"]["2026-11"]["amount"])


class Indices(unittest.TestCase):
    def test_disagreeing_sources_are_reported(self):
        ipc = {"2026-08": 12276.766, "2026-09": 12514.1508}
        self.assertEqual(indices.check(ipc, {"2026-08": 12276.766}, {"2026-09-30": 1.9}), [])
        self.assertTrue(indices.check(ipc, {"2026-08": 12300.0}, {}))           # level differs from the series API
        self.assertTrue(indices.check(ipc, {}, {"2026-09-30": 2.4}))            # rate differs from BCRA

    def test_indec_layout_change_stops_the_parser(self):
        with self.assertRaises(ValueError):
            indices.parse_indec("Codigo;Otra;Cosa\n".encode("latin-1"))


class EnvFile(unittest.TestCase):
    def test_errors_name_the_key_and_never_the_value(self):
        import envfile, tempfile, traceback
        secret = "9163:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.env")
            fd = os.open(p, os.O_WRONLY | os.O_CREAT, 0o600)
            os.write(fd, f"BOT_TOKEN={secret}\nBOT_USERNAME=x\n".encode())
            os.close(fd)
            self.assertEqual(envfile.read_env(p, "BOT_TOKEN"), secret)
            try:
                envfile.read_env(p, "OTHER")
            except envfile.EnvFileError:
                self.assertNotIn(secret, traceback.format_exc())
            os.chmod(p, 0o644)                                  # positive control: a loose file is refused
            with self.assertRaises(envfile.EnvFileError):
                envfile.read_env(p, "BOT_TOKEN")


class Reader(unittest.TestCase):
    def test_only_valid_fields_survive(self):
        good = {"baseRent": 550000, "startDate": "2026-03-01", "dueDay": 10, "index": "IPC", "periodMonths": 4}
        self.assertEqual(reader.validate(good), good)
        bad = {"baseRent": "todo tu dinero", "startDate": "mañana", "dueDay": 45, "index": "<script>", "periodMonths": 7, "payout": "0xevil"}
        self.assertEqual(reader.validate(bad), {})


if __name__ == "__main__":
    unittest.main(verbosity=1)
