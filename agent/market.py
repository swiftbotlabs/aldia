"""Where a sweep can execute: the Uniswap v3 pool and Textile's RFQ desk. Read-only here; the lease contract does the swap."""
import json
import os
import time
import urllib.error
import urllib.request

from eth_abi import decode, encode
from eth_utils import keccak

import celo

WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"
USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
QUOTER = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8"
REACTOR = "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3"
FEE = 100
TEXTILE = "https://api.textilecredit.com/v2"


def uni_quote(token_in, token_out, amount_in, fee=FEE):
    data = celo.sel("quoteExactInputSingle((address,address,uint256,uint24,uint160))") + encode(
        ["(address,address,uint256,uint24,uint160)"], [(token_in, token_out, amount_in, fee, 0)])
    return decode(["uint256"], celo.eth_call(QUOTER, data)[:32])[0]


def _textile(path, body=None, timeout=75):
    req = urllib.request.Request(TEXTILE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", "user-agent": "aldia/1"},
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read(2_000_000))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read(100_000))
        except Exception:
            return e.code, {}


def textile_preview(sell_token, buy_token, sell_amount):
    code, d = _textile("/rfq/preview", {"chainId": celo.CHAIN_ID, "sellToken": sell_token, "buyToken": buy_token,
                                        "sellAmount": str(sell_amount)}, timeout=20)
    data = d.get("data") or {}
    if code != 200 or data.get("status") != "preview":
        return None
    return int(data["buyAmount"])


def taker_control_digest(lease, nonce, issued_at):
    """EIP-712 digest of Textile's TakerControl message. Computed here, never taken from an RPC, so a lying node can never
    get the agent to sign something else. The lease contract rebuilds the same digest in isValidSignature."""
    domain = keccak(encode(["bytes32", "bytes32", "bytes32", "uint256"],
                           [keccak(text="EIP712Domain(string name,string version,uint256 chainId)"),
                            keccak(text="Textile Taker Control"), keccak(text="1"), celo.CHAIN_ID]))
    struct = keccak(encode(["bytes32", "address", "uint256", "bytes32", "uint256"],
                           [keccak(text="TakerControl(address taker,uint256 chainId,bytes32 nonce,uint256 issuedAt)"),
                            lease, celo.CHAIN_ID, nonce, issued_at]))
    return keccak(b"\x19\x01" + domain + struct)


def taker_proof(lease, acct):
    """Textile's proof of control for a contract taker: EIP-1271 over the digest above."""
    nonce = os.urandom(32)
    issued_at = int(time.time() * 1000)
    sig = acct.unsafe_sign_hash(taker_control_digest(lease, nonce, issued_at))
    raw = sig.r.to_bytes(32, "big") + sig.s.to_bytes(32, "big") + bytes([sig.v])
    blob = nonce + issued_at.to_bytes(32, "big") + raw
    return {"nonce": "0x" + nonce.hex(), "issuedAt": issued_at, "signature": "0x" + blob.hex()}


def textile_firm(lease, acct, sell_token, buy_token, sell_amount):
    """A firm quote whose taker is the lease contract. Returns None when nobody quotes or the quote does not fit."""
    body = {"chainId": celo.CHAIN_ID, "sellToken": sell_token, "buyToken": buy_token, "sellAmount": str(sell_amount),
            "taker": lease, "takerProof": taker_proof(lease, acct)}
    code, d = _textile("/rfq/request", body)
    data = d.get("data") or {}
    if code != 200 or data.get("status") != "quoted":
        return {"ok": False, "code": code, "reason": data.get("reason") or (d.get("error") or {}).get("message")}
    q = data["quote"]
    swap = data["transactions"]["swap"]
    spender = (q.get("spender") or q.get("reactor") or "").lower()
    if spender != REACTOR.lower() or swap["to"].lower() != REACTOR.lower():
        return {"ok": False, "code": code, "reason": "quote settles through a contract we do not allow"}
    if q["taker"].lower() != lease.lower() or int(q["takerPays"]) > sell_amount:
        return {"ok": False, "code": code, "reason": "quote does not match the request"}
    return {"ok": True, "buyAmount": int(q["buyAmount"]), "takerPays": int(q["takerPays"]), "swapData": swap["data"],
            "rfqId": data.get("rfqId"), "expiresAt": q.get("expiresAt")}
