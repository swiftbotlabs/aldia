"""The agent. Runs as a systemd user service; every step logs one line, and the process exits non-zero after repeated
failures so systemd restarts it rather than leaving a live process that does nothing."""
import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import celo
import indices as idx
import lease_ops as ops
import market
import reader
import webapp

STORE = os.path.join(celo.STATE_DIR, "leases.json")
TICK = 30
INDEX_EVERY = 6 * 3600
MAX_FAILS = 20


def log(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)


def load():
    return json.load(open(STORE)) if os.path.exists(STORE) else {}


def save(store):
    tmp = STORE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(store, f, indent=1)
    os.replace(tmp, STORE)


class Agent:
    def __init__(self):
        self.sender = celo.TaggedSender()
        self.store = load()
        self.indices = None
        self.indices_at = 0
        self.changed = set()
        self.last_health = 0
        self.last_stats = ""

    def refresh_indices(self):
        if time.time() - self.indices_at < INDEX_EVERY:
            return
        snap = idx.snapshot()
        self.indices, self.indices_at = snap, time.time()
        webapp.publish([{"key": "indices", "value": snap}])
        log("indices", "ok" if snap["ok"] else f"PROBLEMS {snap['problems']}", snap["ipcLast"])
        self.changed.update(self.store)

    def pull(self):
        q = webapp.queue()
        done = []
        for raw in q.get("leases", []):
            try:
                if raw["id"] not in self.store:
                    self.store[raw["id"]] = ops.open_lease(raw)
                    log("lease opened", raw["id"], self.store[raw["id"]]["collector"])
                    self.changed.add(raw["id"])
            except (AssertionError, KeyError, ValueError, TypeError) as e:
                log("lease refused", raw.get("id"), repr(e)[:120])
            done.append(raw["id"])
        reads = []
        for r in q.get("reads", []):
            reads.append(r["rid"])
            try:
                fields, tx = reader.read_contract(r["text"], acct=self.sender.acct)
                webapp.publish([{"key": f"readres:{r['rid']}", "value": {"status": "done", "fields": fields}, "ttl": 3600}])
                log("contract read", r["rid"], sorted(fields), tx)
            except Exception as e:
                webapp.publish([{"key": f"readres:{r['rid']}", "value": {"status": "failed"}, "ttl": 3600}])
                log("contract read failed", r["rid"], repr(e)[:160])
        if done or reads:
            webapp.ack(done, reads)

    def watch(self, lease):
        if lease.get("closed"):
            return
        if ops.refresh_charges(lease, self.indices):
            self.changed.add(lease["id"])
        held = celo.erc20_balance(market.WARS, lease["collector"])
        if held == 0:
            return
        open_months = sorted(m for m, c in lease["charges"].items() if c["status"] != "pagado" and c.get("amount"))
        if not open_months:
            log("funds without an open charge", lease["id"], held)
            return
        month = open_months[0]
        c = lease["charges"][month]
        got = held // 10**18
        if got != c.get("received"):
            c["received"] = got
            self.changed.add(lease["id"])
        if got >= c["amount"] * ops.PAID_TOLERANCE:
            # The explorer can lag the chain by a minute or two. Wait for it so the receipt names the payment, within reason.
            seen = c.setdefault("fundedAt", time.time())
            known = [p for p in ops.incoming(lease["collector"]) if p[0] not in lease.get("settledPayments", [])]
            if not known and time.time() - seen < 600:
                return
            done = ops.settle(lease, month, self.sender)
            self.changed.add(lease["id"])
            if done:
                webapp.publish([{"key": f"receipt:{lease['id']}:{month}", "value": done}])
                log("settled", lease["id"], month, done["settleTx"], done["route"])
        else:
            c["status"] = "parcial"

    def stats(self):
        leases = list(self.store.values())
        real = [l for l in leases if not l["builderTest"]]
        pays = [p for l in leases for p in l["payments"]]
        s = {"leasesThird": len(real), "leasesTest": len(leases) - len(real),
             "paymentsThird": sum(1 for p in pays if not p["ours"]), "paymentsTest": sum(1 for p in pays if p["ours"]),
             "leases": [{"label": l["terms"]["propertyLabel"], "kind": "prueba nuestra" if l["builderTest"] else "tercero"} for l in leases][-12:]}
        log_path = os.path.join(celo.STATE_DIR, "paidcalls.jsonl")
        if os.path.exists(log_path):
            calls = [json.loads(x) for x in open(log_path)]
            ok = [c for c in calls if c["status"] < 400]
            s["paidCalls"] = {"count": len(ok), "usd": sum(c["atomic"] for c in ok) / 1e6,
                              "recent": [{"service": c["service"], "usd": c["atomic"] / 1e6, "tx": c["tx"]} for c in ok[-8:]]}
        blob = json.dumps(s, sort_keys=True)
        if blob != self.last_stats:
            self.last_stats = blob
            s["updatedAt"] = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
            webapp.publish([{"key": "stats", "value": s}])

    def tick(self):
        self.refresh_indices()
        self.pull()
        for lease in list(self.store.values()):
            self.watch(lease)
        if self.changed:
            items = []
            for i in self.changed:
                if i in self.store:
                    items.append({"key": f"pub:{i}", "value": ops.public_view(self.store[i])})
            webapp.publish(items)
            self.changed.clear()
            save(self.store)
        self.stats()
        if time.time() - self.last_health > 900:
            webapp.publish([{"key": "health", "value": {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}}])
            self.last_health = time.time()


def main():
    agent = Agent()
    fails = 0
    log("agent up", agent.sender.address, "leases", len(agent.store))
    while True:
        try:
            agent.tick()
            fails = 0
        except Exception as e:
            fails += 1
            log("tick failed", fails, repr(e)[:300])
            traceback.print_exc(limit=3)
            if fails >= MAX_FAILS:
                sys.exit(1)
        if "--once" in sys.argv:
            return
        time.sleep(TICK)


if __name__ == "__main__":
    main()
