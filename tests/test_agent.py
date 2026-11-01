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


class Terms(unittest.TestCase):
    def raw(self, **kw):
        d = {"propertyLabel": "x", "tenantLabel": "", "baseRent": 1000, "startDate": "2026-01-01", "dueDay": 10, "index": "IPC", "periodMonths": 3,
             "lagMonths": 2, "fixedPct": 0, "sweepBps": 5000, "payout": "0x8EE66fcd89e2cb492B9B19B1380D93E792Df9aAa"}
        d.update(kw)
        return d

    def test_good_terms_pass(self):
        self.assertTrue(ops.valid_terms(self.raw()))

    def test_addresses_the_contract_would_refuse_are_stopped_here(self):
        for bad in ("0x" + "0" * 39 + "1", "0x" + "0" * 40, "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"):
            with self.assertRaises(AssertionError):
                ops.valid_terms(self.raw(payout=bad))


class Isolation(unittest.TestCase):
    """Review finding: one lease that cannot settle used to stop every other lease and every save."""

    def agent(self, store):
        import time, types, loop
        a = loop.Agent.__new__(loop.Agent)
        a.store, a.changed, a.indices = store, set(), None
        a.indices_at = a.last_health = a.last_inflows = a.last_recover = time.time()
        a.last_stats = ""
        a.notifier = types.SimpleNamespace(poll=lambda *x: None)
        a.stats = lambda: None
        self.patch(loop.webapp, "publish", lambda items: None)
        self.patch(loop.ops, "public_view", lambda lease: {})
        self.patch(loop, "save", lambda store: None)
        return a

    def patch(self, obj, name, value):
        old = getattr(obj, name)
        setattr(obj, name, value)
        self.addCleanup(setattr, obj, name, old)

    def test_a_failing_lease_does_not_stop_the_others(self):
        import time
        a = self.agent({"bad": {"id": "bad"}, "good": {"id": "good"}})
        a.pull = lambda: None
        seen = []

        def watch(lease):
            seen.append(lease["id"])
            if lease["id"] == "bad":
                raise RuntimeError("createLease reverted")      # the exact failure a reserved payout causes
        a.watch = watch
        a.tick()
        self.assertEqual(seen, ["bad", "good"])                  # the bad one really ran and really failed
        self.assertEqual(a.store["bad"]["fails"], 1)
        self.assertGreater(a.store["bad"]["retryAt"], time.time())
        a.tick()
        self.assertEqual(seen, ["bad", "good", "good"])          # held back on its timer, the other still served

    def test_a_lease_is_saved_before_the_queue_forgets_it(self):
        import loop
        a = self.agent({})
        order = []
        self.patch(loop.webapp, "queue", lambda: {"leases": [{"id": "abc"}], "reads": []})
        self.patch(loop.webapp, "ack", lambda *x: order.append("ack"))
        self.patch(loop, "save", lambda store: order.append("save"))
        self.patch(loop.ops, "open_lease", lambda raw: {"id": raw["id"], "collector": "0x0"})
        a.pull()
        self.assertEqual(order, ["save", "ack"])

    def test_a_list_as_contract_reference_cannot_crash_the_clause_check(self):
        a = self.agent({})
        a.reads = {"0123456789abcdef": "clause"}
        month = ops.ar_month()
        lease = {"contractRef": ["0123456789abcdef"], "charges": {month: {"month": month, "status": "pendiente"}}}
        a.check_clause(lease)                                    # used to raise TypeError: unhashable type

    def test_open_lease_drops_a_reference_that_is_not_a_string(self):
        raw = {"id": "abc", "createdAt": "x", "propertyLabel": "x", "tenantLabel": "", "baseRent": 1000, "startDate": "2026-01-01", "dueDay": 10,
               "index": "IPC", "periodMonths": 3, "lagMonths": 2, "fixedPct": 0, "sweepBps": 0,
               "payout": "0x8EE66fcd89e2cb492B9B19B1380D93E792Df9aAa", "contractRef": ["0123456789abcdef"]}
        self.patch(ops.celo, "eth_call", lambda *x, **k: bytes(32))
        self.assertIsNone(ops.open_lease(raw)["contractRef"])


class Digest(unittest.TestCase):
    def test_local_digest_matches_the_deployed_contract(self):
        import celo, market
        lease = "0x5372c6A1Df42340ba4ACaE73b738A5dd70892322"
        nonce = bytes(range(32))
        issued = 1793000000000
        try:
            onchain = celo.eth_call(lease, celo.sel("takerControlDigest(bytes32,uint256)") + nonce + issued.to_bytes(32, "big"))
        except Exception:
            self.skipTest("no network")
        self.assertEqual(market.taker_control_digest(lease, nonce, issued), onchain)


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
