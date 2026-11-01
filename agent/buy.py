"""Pays x402 services over HTTP. Plain client for the `exact` scheme with EIP-3009 on Celo. The wallet only signs an
authorization for the quoted amount; the service's facilitator settles it and pays gas.

Spending is bounded here: an allowlist of hosts, a per-call ceiling and a daily ceiling, in USD₮ base units.
"""
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import celo

ALLOWED_HOSTS = {"gateway.usebuy.ai", "agent402.tools"}
USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
MAX_PER_CALL = 30_000     # $0.03
MAX_PER_DAY = 400_000     # $0.40
LOG = os.path.join(celo.STATE_DIR, "paidcalls.jsonl")


class BuyError(RuntimeError):
    pass


def _spent_today():
    today = time.strftime("%Y-%m-%d", time.gmtime())
    total = 0
    if os.path.exists(LOG):
        for line in open(LOG):
            r = json.loads(line)
            if r["t"].startswith(today):
                total += r["atomic"]
    return total


def _post(url, body, headers, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    h = {"content-type": "application/json", "user-agent": "aldia/1"}
    h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(3_000_000)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(1_000_000)


def _authorization(acct, accept):
    if accept["asset"].lower() != USDT.lower():
        raise BuyError("asset is not USD₮")
    value = int(accept.get("maxAmountRequired") or accept["amount"])
    if value > MAX_PER_CALL:
        raise BuyError(f"quoted {value} above the per-call ceiling")
    if _spent_today() + value > MAX_PER_DAY:
        raise BuyError("daily spending ceiling reached")
    now = int(time.time())
    auth = {"from": acct.address, "to": accept["payTo"], "value": str(value), "validAfter": "0",
            "validBefore": str(now + min(int(accept.get("maxTimeoutSeconds", 60)), 300)), "nonce": "0x" + os.urandom(32).hex()}
    signed = acct.sign_typed_data(
        domain_data={"name": accept["extra"]["name"], "version": accept["extra"]["version"], "chainId": celo.CHAIN_ID,
                     "verifyingContract": USDT},
        message_types={"TransferWithAuthorization": [
            {"name": "from", "type": "address"}, {"name": "to", "type": "address"}, {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"}, {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"}]},
        message_data={**auth, "value": value, "validAfter": 0, "validBefore": int(auth["validBefore"]),
                      "nonce": bytes.fromhex(auth["nonce"][2:])})
    return auth, "0x" + bytes(signed.signature).hex(), value


def paid_call(url, body, service, acct=None, timeout=120):
    """POSTs `body`; pays the 402 if one comes back. Returns (parsed JSON or text, tx hash or None)."""
    host = urllib.parse.urlsplit(url).hostname
    if host not in ALLOWED_HOSTS:
        raise BuyError(f"host not allowed: {host}")
    acct = acct or celo.load_account()
    code, _, raw = _post(url, body, {}, timeout=30)
    if code != 402:
        raise BuyError(f"expected 402, got {code}: {raw[:200]!r}")
    ch = json.loads(raw)
    accepts = [a for a in ch.get("accepts", []) if (a.get("network") in ("celo", "eip155:42220")) and a["asset"].lower() == USDT.lower()]
    if not accepts:
        raise BuyError("service does not take USD₮ on Celo")
    accept = accepts[0]
    auth, sig, value = _authorization(acct, accept)
    version = ch.get("x402Version", 1)
    if version == 1:
        payload = {"x402Version": 1, "scheme": "exact", "network": accept["network"], "payload": {"signature": sig, "authorization": auth}}
        header = {"X-PAYMENT": base64.b64encode(json.dumps(payload).encode()).decode()}
    else:
        payload = {"x402Version": 2, "accepted": accept, "payload": {"signature": sig, "authorization": auth}}
        header = {"PAYMENT-SIGNATURE": base64.b64encode(json.dumps(payload).encode()).decode()}
    with open(LOG, "a") as f:     # written first: a call that times out after paying still counts against the ceiling
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "service": service, "atomic": value,
                            "status": None, "tx": None, "payTo": accept["payTo"]}) + "\n")
    code, headers, raw = _post(url, body, header, timeout=timeout)
    tx = None
    for k, v in headers.items():
        if k.lower() in ("x-payment-response", "payment-response"):
            try:
                tx = json.loads(base64.b64decode(v)).get("transaction")
            except Exception:
                pass
    with open(LOG, "a") as f:
        f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "service": service, "atomic": 0, "paid": value,
                            "status": code, "tx": tx, "payTo": accept["payTo"]}) + "\n")
    if code >= 400:
        raise BuyError(f"paid call returned {code}: {raw[:200]!r}")
    try:
        return json.loads(raw), tx
    except ValueError:
        return raw.decode("utf-8", "replace"), tx
