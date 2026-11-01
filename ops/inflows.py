"""Rebuilds products/celo-openrails/INFLOWS.md: one line per inflow of a controller-watched token into the agent wallet.
Read-only: Blockscout for ERC-20 and native transfers. Every line can be reversed by the owner from this list.
The `why` column comes from ops/inflows_why.json (tx -> reason), filled in by whoever caused the inflow."""
import json, os, sys, time, urllib.parse, urllib.request

W = "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"
OUT = "/home/agent/agent/products/celo-openrails/INFLOWS.md"
WHY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "state", "inflows_why.json")
WATCHED = {"0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e": ("USD₮", 6), "0xceba9300f2b948710d2653dd7b07f33a8b32118c": ("USDC", 6),
           "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771": ("USA₮", 6)}
B = "https://celo.blockscout.com/api/v2"


def get(url):
    req = urllib.request.Request(url, headers={"user-agent": "aldia-ops"})
    return json.load(urllib.request.urlopen(req, timeout=40))


def pages(path, params, limit=20):
    np = None
    for _ in range(limit):
        q = dict(params)
        if np:
            q.update(np)
        d = get(f"{B}{path}?{urllib.parse.urlencode(q)}")
        yield from d.get("items", [])
        np = d.get("next_page_params")
        if not np:
            return


def main():
    why = {}
    if os.path.exists(WHY):
        why = json.load(open(WHY))
    rows = []
    for it in pages(f"/addresses/{W}/token-transfers", {"type": "ERC-20", "filter": "to"}):
        tok = (it.get("token") or {}).get("address_hash") or (it.get("token") or {}).get("address")
        t = WATCHED.get((tok or "").lower())
        if not t:
            continue
        amt = int(it["total"]["value"]) / 10 ** t[1]
        rows.append((it["timestamp"][:19] + "Z", it.get("transaction_hash") or it.get("tx_hash"), t[0], amt, it["from"]["hash"]))
    for it in pages(f"/addresses/{W}/transactions", {"filter": "to"}):
        v = int(it.get("value") or 0)
        if v:
            rows.append((it["timestamp"][:19] + "Z", it["hash"], "CELO", v / 1e18, it["from"]["hash"]))
    for it in pages(f"/addresses/{W}/internal-transactions", {"filter": "to"}):
        v = int(it.get("value") or 0)
        if v:
            rows.append((it["timestamp"][:19] + "Z", it.get("transaction_hash"), "CELO", v / 1e18, it["from"]["hash"]))
    rows.sort()
    lines = ["# Inflows to the agent wallet", "",
             f"Wallet {W}. Every inflow of a controller-watched token (USD₮, USDC, USA₮, CELO). None of these are earnings.",
             f"Regenerate: `wallet-venv/bin/python -I aldia/ops/inflows.py`. Last run {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}.", "",
             "| time (UTC) | tx | token | amount | source | why |", "|---|---|---|---|---|---|"]
    for t, tx, tok, amt, src in rows:
        lines.append(f"| {t} | {tx} | {tok} | {amt:.6f} | {src} | {why.get(tx, 'unexplained, check')} |")
    open(OUT, "w").write("\n".join(lines) + "\n")
    print(len(rows), "inflows;", sum(1 for r in rows if r[1] not in why), "unexplained")
    return rows


if __name__ == "__main__":
    main()
