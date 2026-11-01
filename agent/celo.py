"""Celo mainnet access for Al Día.

One rule lives here: every transaction this project sends goes through TaggedSender.send(), which appends the
ERC-8021 attribution suffix and refuses to sign anything that does not end with it. There is no other path to the chain.

The signing key is read from a 0600 file at runtime and never printed or logged.
"""
import fcntl
import json
import os
import stat
import time
import urllib.error
import urllib.request

from eth_account import Account
from eth_utils import keccak, to_checksum_address

CHAIN_ID = 42220
RPC_URL = "https://forno.celo.org"
TAG = "celo_2ee02704a56d"
ERC8021_MARKER = bytes.fromhex("80218021802180218021802180218021")
KEY_FILE = "/home/agent/agent/secrets/celo_openrails_agent.key"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.environ.get("ALDIA_STATE", os.path.join(os.path.dirname(HERE), "state"))
LOCK_FILE = os.path.join(STATE_DIR, "wallet.lock")
TX_LOG = os.path.join(STATE_DIR, "txlog.jsonl")

# Stablecoin gas (CIP-64): the fee-currency adapter for USD₮, 18-decimal view of the 6-decimal token.
USDT_FEE_ADAPTER = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72"


def erc8021_suffix(code=TAG):
    raw = code.encode("ascii")
    if not 0 < len(raw) <= 32:
        raise ValueError("bad attribution code")
    return raw + bytes([len(raw)]) + b"\x00" + ERC8021_MARKER


SUFFIX = erc8021_suffix()


class RpcError(RuntimeError):
    pass


def rpc(method, params, tries=3, timeout=25):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(RPC_URL, data=body, headers={"content-type": "application/json",
                                                                      "user-agent": "aldia/1"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.loads(r.read(4_000_000))
            if "error" in d:
                # a node-side rejection is final, a transport error is retried
                raise RpcError(json.dumps(d["error"])[:400])
            return d["result"]
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(1.0 + i)
    raise RpcError(f"rpc unavailable: {last}")


def sel(sig):
    return keccak(text=sig)[:4]


def eth_call(to, data, block="latest", frm=None):
    call = {"to": to_checksum_address(to), "data": "0x" + bytes(data).hex()}
    if frm:
        call["from"] = to_checksum_address(frm)
    return bytes.fromhex(rpc("eth_call", [call, block])[2:])


def erc20_balance(token, owner):
    d = sel("balanceOf(address)") + bytes.fromhex(owner[2:].lower().rjust(64, "0"))
    return int.from_bytes(eth_call(token, d), "big")


def load_account(path=KEY_FILE):
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise SystemExit("agent key must be a regular 0600 file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        key = f.read(100).strip()
    return Account.from_key(key)


class TaggedSender:
    """Serialised sender. Holds an flock across nonce read, send and receipt so that the agent loop, the desk scripts and
    ops tools can share the wallet without nonce races."""

    def __init__(self, account=None, max_cost_celo=1.5):
        self.acct = account or load_account()
        self.max_cost_wei = int(max_cost_celo * 10**18)
        os.makedirs(STATE_DIR, exist_ok=True)

    @property
    def address(self):
        return self.acct.address

    def _tagged(self, data):
        data = bytes(data)
        if data.endswith(SUFFIX):
            return data
        return data + SUFFIX

    def send(self, to, data=b"", value=0, note="", gas_margin=1.25, wait_s=90):
        data = self._tagged(data)
        if not data.endswith(SUFFIX):       # belt and braces: nothing untagged is ever signed
            raise RuntimeError("refusing to sign an untagged transaction")
        to = to_checksum_address(to) if to else None
        with open(LOCK_FILE, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            blk = rpc("eth_getBlockByNumber", ["latest", False])
            base = int(blk["baseFeePerGas"], 16)
            tip = 10**9
            max_fee = 2 * base + tip
            call = {"from": self.address, "data": "0x" + data.hex(), "value": hex(value)}
            if to:
                call["to"] = to
            gas = int(int(rpc("eth_estimateGas", [call]), 16) * gas_margin) + 10000
            if gas * max_fee > self.max_cost_wei:
                raise RpcError("gas cost above the per-transaction ceiling")
            nonce = int(rpc("eth_getTransactionCount", [self.address, "pending"]), 16)
            tx = {"chainId": CHAIN_ID, "nonce": nonce, "value": value, "data": data, "gas": gas,
                  "maxFeePerGas": max_fee, "maxPriorityFeePerGas": tip, "type": 2}
            if to:
                tx["to"] = to
            signed = self.acct.sign_transaction(tx)
            raw = bytes(signed.raw_transaction)
            h = "0x" + keccak(raw).hex()
            try:
                rpc("eth_sendRawTransaction", ["0x" + raw.hex()], tries=1)
            except RpcError as e:
                if "already known" not in str(e):
                    raise
            rc = self._wait(h, wait_s)
            self._log(h, to, note, rc)
            return h, rc

    @staticmethod
    def _wait(h, wait_s):
        end = time.time() + wait_s
        while time.time() < end:
            rc = rpc("eth_getTransactionReceipt", [h])
            if rc:
                return rc
            time.sleep(1.5)
        return None

    def _log(self, h, to, note, rc):
        row = {"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tx": h, "to": to, "note": note,
               "status": rc and rc.get("status"), "gasUsed": rc and int(rc["gasUsed"], 16)}
        with open(TX_LOG, "a") as f:
            f.write(json.dumps(row) + "\n")
