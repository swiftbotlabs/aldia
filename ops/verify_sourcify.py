"""Verifies the deployed contracts on Sourcify from Foundry's build metadata."""
import json, os, sys, time, urllib.error, urllib.request
ROOT = "/home/agent/agent/products/celo-openrails/aldia/contracts"
CHAIN = "42220"
def post(address, name):
    art = json.load(open(f"{ROOT}/out/{name}.sol/{name}.json"))
    meta = art["rawMetadata"] if "rawMetadata" in art else json.dumps(art["metadata"])
    m = json.loads(meta)
    files = {"metadata.json": meta}
    for src in m["sources"]:
        path = os.path.join(ROOT, src)
        files[src] = open(path, encoding="utf-8").read()
    payload = json.dumps({"metadata": m, "sources": {k: v for k, v in files.items() if k != "metadata.json"}}).encode()
    url = f"https://sourcify.dev/server/v2/verify/metadata/{CHAIN}/{address}"
    req = urllib.request.Request(url, data=payload, headers={"content-type": "application/json", "user-agent": "aldia"})
    try:
        r = urllib.request.urlopen(req, timeout=120)
        d = json.load(r)
    except urllib.error.HTTPError as e:
        print(name, e.code, e.read(500).decode())
        return
    print(name, d)
    for _ in range(20):
        time.sleep(4)
        st = json.load(urllib.request.urlopen(urllib.request.Request(f"https://sourcify.dev/server/v2/verify/{d['verificationId']}", headers={"user-agent": "aldia"}), timeout=30))
        if st.get("isJobCompleted"):
            print(name, "done", json.dumps(st.get("contract") or st.get("error"))[:300])
            return
    print(name, "still running")
post("0x4690e265fd2d542e1b44ac7ba41f796a474b11c1", "AlDiaFactory")
post("0xc6807392b5f33d3a17a4a61c5f3d2f9f0c0d975e", "AlDiaLease")
