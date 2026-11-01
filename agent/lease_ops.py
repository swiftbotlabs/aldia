"""Everything the agent does to one lease: terms, charges, payments, settlement, receipts."""
import json
import os
import re
import time
import urllib.parse
import urllib.request

from eth_abi import decode, encode
from eth_utils import keccak, to_checksum_address

import celo
import market
import rent

FACTORY = "0x4690e265fd2d542e1b44ac7ba41f796a474b11c1"
TOPIC_SETTLED = "0x" + keccak(text="RentSettled(uint64,uint256,uint256,uint256,uint256,uint8,bytes32)").hex()
FEE_BPS = 30
MAX_SLIPPAGE_BPS = 100
PAID_TOLERANCE = 0.98     # Ripio can deliver a hair under the requested pesos
OUR_WALLETS = {"0xed120aec2240a25125b3f32eb8bff9c5f688121b",   # agent wallet
               "0x8ee66fcd89e2cb492b9b19b1380d93e792df9aaa"}   # builder-test landlord
ROUTE = {"none": 0, "uniswap": 1, "textile": 2}
ROUTE_NAME = {0: "sin conversión", 1: "Uniswap", 2: "Textile FX"}


def ar_now():
    return time.gmtime(time.time() - 3 * 3600)


def ar_month():
    return time.strftime("%Y-%m", ar_now())


def valid_terms(raw):
    """The Worker validated this already; the agent does not trust that and checks again."""
    t = {k: raw.get(k) for k in ("propertyLabel", "tenantLabel", "baseRent", "startDate", "dueDay", "index", "periodMonths",
                                 "lagMonths", "fixedPct", "sweepBps", "payout")}
    assert isinstance(t["propertyLabel"], str) and 0 < len(t["propertyLabel"]) <= 60
    assert isinstance(t["tenantLabel"], str) and len(t["tenantLabel"]) <= 40
    assert isinstance(t["baseRent"], int) and 1000 <= t["baseRent"] <= 100_000_000
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", t["startDate"])
    assert isinstance(t["dueDay"], int) and 1 <= t["dueDay"] <= 28
    assert t["index"] in ("IPC", "ICL", "FIJO")
    assert t["periodMonths"] in (1, 2, 3, 4, 6, 12)
    assert t["lagMonths"] in (1, 2)
    assert isinstance(t["sweepBps"], int) and 0 <= t["sweepBps"] <= 10000
    t["payout"] = to_checksum_address(t["payout"])
    return t


def terms_hash(t):
    keep = {k: t[k] for k in ("baseRent", "startDate", "dueDay", "index", "periodMonths", "lagMonths", "fixedPct")}
    return keccak(json.dumps(keep, sort_keys=True, separators=(",", ":")).encode())


def _lease_args(lease):
    t = lease["terms"]
    return [t["payout"], t["sweepBps"], FEE_BPS, MAX_SLIPPAGE_BPS, bytes.fromhex(lease["termsHash"]), bytes.fromhex(lease["salt"])]


ARGS = ["address", "uint16", "uint16", "uint16", "bytes32", "bytes32"]


def open_lease(raw):
    t = valid_terms(raw)
    lease = {"id": raw["id"], "terms": t, "createdAt": raw["createdAt"], "termsHash": terms_hash(t).hex(),
             "salt": keccak(text="aldia:" + raw["id"]).hex(), "deployed": False, "charges": {}, "payments": [],
             "builderTest": t["payout"].lower() in OUR_WALLETS}
    data = celo.sel("predict(address,uint16,uint16,uint16,bytes32,bytes32)") + encode(ARGS, _lease_args(lease))
    lease["collector"] = to_checksum_address("0x" + celo.eth_call(FACTORY, data)[-20:].hex())
    return lease


def due_date(lease, month):
    return f"{month}-{lease['terms']['dueDay']:02d}"


def refresh_charges(lease, indices, month=None):
    """Issues this month's charge, and keeps it honest if the index is not out yet."""
    month = month or ar_month()
    t = lease["terms"]
    if month < t["startDate"][:7]:
        return False
    c = lease["charges"].get(month)
    if c and c["status"] == "pagado":
        return False
    before = json.dumps(c, sort_keys=True)
    try:
        if not indices or not indices.get("ok"):
            raise rent.NotPublished("las fuentes no coinciden")
        d = rent.rent_for_month(t, month, indices)
    except rent.NotPublished as e:
        c = c or {"month": month, "amount": None, "received": 0, "dueDate": due_date(lease, month)}
        c.update(status="sin-indice", waitingFor=str(e))
        lease["charges"][month] = c
        return before != json.dumps(c, sort_keys=True)
    c = c or {"month": month, "received": 0, "dueDate": due_date(lease, month)}
    c.update(amount=d["amount"], detail=d)
    c.pop("waitingFor", None)
    today = time.strftime("%Y-%m-%d", ar_now())
    if c.get("received", 0) > 0:
        c["status"] = "parcial"
    else:
        c["status"] = "vencido" if today > c["dueDate"] else "pendiente"
    lease["charges"][month] = c
    return before != json.dumps(c, sort_keys=True)


def incoming(collector):
    """wARS transfers into the lease: (tx, from, amount in wei), newest first."""
    q = urllib.parse.urlencode({"type": "ERC-20", "filter": "to"})
    url = f"https://celo.blockscout.com/api/v2/addresses/{collector}/token-transfers?{q}"
    req = urllib.request.Request(url, headers={"user-agent": "aldia/1"})
    d = json.load(urllib.request.urlopen(req, timeout=30))
    out = []
    for it in d.get("items", []):
        if (it.get("token") or {}).get("address_hash", (it.get("token") or {}).get("address", "")).lower() == market.WARS.lower():
            out.append((it.get("transaction_hash") or it.get("tx_hash"), it["from"]["hash"], int(it["total"]["value"])))
    return out


def ensure_deployed(lease, sender):
    if lease["deployed"]:
        return
    if celo.rpc("eth_getCode", [lease["collector"], "latest"]) in ("0x", "0x0"):
        data = celo.sel("createLease(address,uint16,uint16,uint16,bytes32,bytes32)") + encode(ARGS, _lease_args(lease))
        h, rc = sender.send(FACTORY, data, note=f"open lease {lease['id']}")
        if not rc or rc["status"] != "0x1":
            raise RuntimeError(f"lease deployment failed: {h}")
        lease["deployTx"] = h
    lease["deployed"] = True


def read_uint(addr, sig, *args_bytes):
    """A read can land on a node a block behind a contract we just deployed, and come back empty. Empty is not zero."""
    for i in range(6):
        raw = celo.eth_call(addr, celo.sel(sig) + b"".join(args_bytes))
        if raw:
            return int.from_bytes(raw, "big")
        time.sleep(2)
    raise RuntimeError(f"empty reply from {addr} {sig}")


def force_textile():
    """Builder-test leases listed here take the Textile route even when Uniswap is a hair better, to exercise that path."""
    p = os.path.join(celo.STATE_DIR, "force_textile.json")
    return json.load(open(p)) if os.path.exists(p) else []


def plan_route(lease, sender, sweep):
    """Picks the better venue, firm for Textile. Returns (route, minOut, textileCall, note)."""
    c = lease["collector"]
    floor = read_uint(c, "quoteFloor(uint256)", sweep.to_bytes(32, "big"))
    uni = 0
    try:
        uni = market.uni_quote(market.WARS, market.USDT, sweep)
    except celo.RpcError:
        pass
    tex_prev = market.textile_preview(market.WARS, market.USDT, sweep)
    note = {"floor": floor, "uniswap": uni, "textilePreview": tex_prev}
    force = lease["builderTest"] and lease["id"] in force_textile()
    if tex_prev and tex_prev >= floor and (tex_prev >= uni or force):
        firm = market.textile_firm(c, sender.acct, market.WARS, market.USDT, sweep)
        note["textileFirm"] = {k: firm.get(k) for k in ("ok", "buyAmount", "reason", "rfqId")}
        if firm.get("ok") and firm["buyAmount"] >= floor and (firm["buyAmount"] >= uni or force):
            return "textile", firm["buyAmount"], bytes.fromhex(firm["swapData"][2:]), note
    if uni >= floor:
        return "uniswap", (uni * 9990) // 10000, b"", note
    return "none", 0, b"", note


def settle(lease, month, sender):
    """Splits whatever the lease holds against the charge of `month`."""
    c = lease["charges"][month]
    ensure_deployed(lease, sender)
    addr = lease["collector"]
    if read_uint(addr, "agent()") == 0:
        lease["closed"] = True      # the landlord removed the agent; their funds stay theirs to withdraw
        return None
    held = celo.erc20_balance(market.WARS, addr)
    sweep_bps = read_uint(addr, "sweepBps()")
    fee_bps = read_uint(addr, "feeBps()")
    fee = held * fee_bps // 10000
    sweep = (held - fee) * sweep_bps // 10000
    route, min_out, call, note = ("none", 0, b"", {})
    # The agent wallet must not receive dollars from a sweep. A lease paying it only ever settles in pesos.
    if sweep > 0 and lease["terms"]["payout"].lower() != sender.address.lower():
        route, min_out, call, note = plan_route(lease, sender, sweep)
    else:
        sweep = 0
    pays = incoming(addr)
    pay_txs = sorted({p[0] for p in pays if p[0] not in lease.get("settledPayments", [])})
    receipt = {"lease": lease["id"], "month": month, "amount": c["amount"], "received": held // 10**18, "paymentTxs": pay_txs,
               "detail": c.get("detail"), "termsHash": lease["termsHash"]}
    r_hash = keccak(json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode())
    seq = len([p for p in lease.get("settlements", [])]) + 1
    sid = int(month.replace("-", "")) * 100 + seq
    args = encode(["uint64", "uint256", "uint8", "uint256", "bytes", "bytes32"], [sid, held, ROUTE[route], min_out, call, r_hash])
    data = celo.sel("settle(uint64,uint256,uint8,uint256,bytes,bytes32)") + args
    try:
        h, rc = sender.send(addr, data, note=f"settle {lease['id']} {month} via {route}", gas_margin=1.4)
    except celo.RpcError as e:
        if route != "textile":
            raise
        note["textileFailed"] = str(e)[:200]      # the quote may have gone stale; retry on the pool
        route, min_out, call = "none", 0, b""
        uni = market.uni_quote(market.WARS, market.USDT, sweep)
        if uni >= note["floor"]:
            route, min_out = "uniswap", (uni * 9990) // 10000
        args = encode(["uint64", "uint256", "uint8", "uint256", "bytes", "bytes32"], [sid, held, ROUTE[route], min_out, call, r_hash])
        data = celo.sel("settle(uint64,uint256,uint8,uint256,bytes,bytes32)") + args
        h, rc = sender.send(addr, data, note=f"settle {lease['id']} {month} via {route} (fallback)", gas_margin=1.4)
    if not rc or rc["status"] != "0x1":
        raise RuntimeError(f"settle failed: {h}")
    ev = next(l for l in rc["logs"] if l["topics"][0] == TOPIC_SETTLED)
    peso_in, fee_paid, peso_out, dollar_out, rt, _ = decode(["uint256"] * 4 + ["uint8", "bytes32"], bytes.fromhex(ev["data"][2:]))
    dollar_out = int(dollar_out)
    swept_peso = peso_in - fee_paid - peso_out
    done = {**receipt, "builderTest": lease["builderTest"], "propertyLabel": lease["terms"]["propertyLabel"], "index": lease["terms"]["index"],
            "paidAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "settleTx": h, "receiptHash": "0x" + r_hash.hex(),
            "fee": fee_paid // 10**18, "pesoToLandlord": peso_out // 10**18, "dollarToLandlord": dollar_out / 1e6,
            "route": ROUTE_NAME[rt], "rate": round((swept_peso / 1e18) / (dollar_out / 1e6), 2) if dollar_out else None, "execution": note}
    lease.setdefault("settlements", []).append({"sid": sid, "tx": h, "month": month})
    lease.setdefault("settledPayments", []).extend(pay_txs)
    for tx, frm, amt in pays:
        if tx in pay_txs:
            lease["payments"].append({"tx": tx, "from": frm, "amount": amt // 10**18, "ours": frm.lower() in OUR_WALLETS, "month": month})
    c.update(status="pagado", received=peso_in // 10**18, receipt=done)
    return done


def public_view(lease):
    month = ar_month()
    charges = lease["charges"]
    cur = charges.get(month) or (charges[max(charges)] if charges else None)
    t = lease["terms"]
    next_adj = None
    if month >= t["startDate"][:7] and t["index"] in ("IPC", "ICL", "FIJO"):
        next_adj = rent.next_adjustment(t, month)
    view = {"id": lease["id"], "propertyLabel": t["propertyLabel"], "collector": lease["collector"], "deployed": lease["deployed"],
            "builderTest": lease["builderTest"], "index": t["index"], "periodMonths": t["periodMonths"], "sweepBps": t["sweepBps"],
            "feeBps": FEE_BPS, "nextAdjustment": next_adj, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "current": None, "history": []}
    if cur:
        view["current"] = {k: cur.get(k) for k in ("month", "amount", "dueDate", "status", "received", "detail")}
    view["history"] = [{"month": m, "amount": c.get("amount"), "status": c["status"]} for m, c in sorted(charges.items(), reverse=True) if c.get("amount")]
    return view


def repair_first_payment(lease, tx, frm, amount):
    """One-off for the first demo receipt, settled before the explorer had indexed its payment. The hashed receipt body
    keeps its empty list; the payment is recorded next to it, so the published hash still matches what went onchain."""
    lease["payments"].append({"tx": tx, "from": frm, "amount": amount, "ours": frm.lower() in OUR_WALLETS, "month": "2026-11"})
    lease.setdefault("settledPayments", []).append(tx)
