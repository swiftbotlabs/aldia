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
import notify
import reader
import rent
import webapp

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ops"))
import inflows

STORE = os.path.join(celo.STATE_DIR, "leases.json")
TICK = 30
INDEX_EVERY = 6 * 3600
READS = os.path.join(celo.STATE_DIR, "reads.json")
SERVICE_NAMES = {"Cencori inference via buy": "Lectura y revisión de contrato (modelo de Cencori, vía buy)",
                 "buy browser session": "Navegador alquilado (prueba, vía buy)"}
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
        self.last_inflows = 0
        self.notifier = notify.Notifier()
        self.reads = json.load(open(READS)) if os.path.exists(READS) else {}

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
                clause = fields.pop("clause", None)
                if clause:
                    self.reads[r["rid"]] = clause
                    with open(READS, "w") as f:
                        json.dump(self.reads, f)
                webapp.publish([{"key": f"readres:{r['rid']}", "value": {"status": "done", "fields": fields, "rid": r["rid"]}, "ttl": 3600}])
                log("contract read", r["rid"], sorted(fields), tx)
            except Exception as e:
                webapp.publish([{"key": f"readres:{r['rid']}", "value": {"status": "failed"}, "ttl": 3600}])
                log("contract read failed", r["rid"], repr(e)[:160])
        if done or reads:
            webapp.ack(done, reads)

    def check_clause(self, lease):
        """Each time a rent goes up and we hold the contract's clause, a paid model call checks the increase against it."""
        c = lease["charges"].get(ops.ar_month())
        clause = self.reads.get(lease.get("contractRef") or "")
        if not c or not clause or "clauseCheck" in c or c.get("status") == "pagado":
            return
        d = c.get("detail") or {}
        if not d.get("adjustments") or d.get("adjustmentMonth") != c["month"]:
            return
        try:
            c["clauseCheck"] = reader.check_clause(clause, d, lease["terms"]["periodMonths"], acct=self.sender.acct)
            log("clause check", lease["id"], c["clauseCheck"])
            self.changed.add(lease["id"])
        except Exception as e:
            log("clause check failed", lease["id"], repr(e)[:160])

    def notices(self, lease):
        n = self.notifier
        if not n.has_subs(lease["id"]):
            return
        month = ops.ar_month()
        c = lease["charges"].get(month)
        if not c or not c.get("amount"):
            if c:
                n.tell(lease, ["landlord"], f"waiting:{month}", f"Todavía no se puede calcular {ops.month_name(month)} de {lease['terms']['propertyLabel']}: falta {c.get('waitingFor')}.")
            return
        label, amount = lease["terms"]["propertyLabel"], ops.ars(c["amount"])
        link = f"{notify.BASE}/pagar/{lease['id']}"
        today = time.strftime("%Y-%m-%d", ops.ar_now())
        d = c.get("detail") or {}
        if c["status"] == "pagado":
            return
        pct = str(d.get("stepPct", "")).replace(".", ",")
        up = f" Aumentó {pct} % por {d['index']}." if d.get("adjustmentMonth") == month and d.get("adjustments") else ""
        n.tell(lease, ["tenant", "landlord"], f"issued:{month}", f"Ya está el alquiler de {ops.month_name(month)} de {label}: {amount}.{up} Vence el {int(c['dueDate'][8:])}.\n{link}")
        days = (time.mktime(time.strptime(c["dueDate"], "%Y-%m-%d")) - time.mktime(time.strptime(today, "%Y-%m-%d"))) / 86400
        if 0 < days <= 3:
            n.tell(lease, ["tenant"], f"soon:{month}", f"Te quedan {int(days)} días para pagar el alquiler de {label}: {amount}.\n{link}")
        if days == 0:
            n.tell(lease, ["tenant"], f"today:{month}", f"Hoy vence el alquiler de {label}: {amount}.\n{link}")
        if days < 0:
            n.tell(lease, ["tenant", "landlord"], f"late:{month}", f"El alquiler de {ops.month_name(month)} de {label} venció y todavía no entró.\n{link}")
        if c["status"] == "parcial":
            n.tell(lease, ["landlord"], f"partial:{month}:{c.get('received')}", f"Entró un pago parcial de {label}: {ops.ars(c.get('received') or 0)} de {amount}.")

    def watch(self, lease):
        if lease.get("closed"):
            return
        if ops.refresh_charges(lease, self.indices):
            self.changed.add(lease["id"])
        self.check_clause(lease)
        self.notices(lease)
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
                dollars = f" y US$ {done['dollarToLandlord']:.2f}".replace(".", ",") if done["dollarToLandlord"] else ""
                rlink = f"{notify.BASE}/recibo/{lease['id']}/{month}"
                self.notifier.tell(lease, ["landlord"], f"paid:{month}", f"Entró el alquiler de {ops.month_name(month)} de {lease['terms']['propertyLabel']}: te mandamos {ops.ars(done['pesoToLandlord'])}{dollars}. Recibo:\n{rlink}")
                self.notifier.tell(lease, ["tenant"], f"paidt:{month}", f"Recibimos tu pago de {ops.month_name(month)}. Gracias. Recibo:\n{rlink}")
        else:
            c["status"] = "parcial"

    def check_inflows(self):
        """The agent wallet should receive no USD₮, USDC or CELO. Anything that arrives goes in INFLOWS.md within minutes."""
        try:
            rows = inflows.main()
            log("inflows", len(rows))
        except Exception as e:
            log("inflow scan failed", type(e).__name__)

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
                              "recent": [{"service": SERVICE_NAMES.get(c["service"], c["service"]), "usd": c["atomic"] / 1e6, "tx": c["tx"]} for c in ok[-8:]]}
        blob = json.dumps(s, sort_keys=True)
        if blob != self.last_stats:
            self.last_stats = blob
            s["updatedAt"] = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
            webapp.publish([{"key": "stats", "value": s}])

    def tick(self):
        self.refresh_indices()
        self.pull()
        self.notifier.poll(self.store, ops.status_text)
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
        if time.time() - self.last_inflows > 300:
            self.last_inflows = time.time()
            self.check_inflows()
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
