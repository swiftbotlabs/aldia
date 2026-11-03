"""Point the Al Día ERC-8004 identity (agent 10014) at its live registration file. Dry run unless --go.
The first URI lived on a GitHub account that is gone; the file is now served by the app itself."""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo
from eth_abi import encode

REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
AGENT_ID = 10014
URI = "https://aldia.swiftbotlab.workers.dev/agent.json"


def token_uri():
    ret = celo.rpc("eth_call", [{"to": REGISTRY, "data": "0x" + (celo.sel("tokenURI(uint256)") + encode(["uint256"], [AGENT_ID])).hex()}, "latest"])
    raw = bytes.fromhex(ret[2:])
    return raw[64:64 + int.from_bytes(raw[32:64], "big")].decode()


data = celo.sel("setAgentURI(uint256,string)") + encode(["uint256", "string"], [AGENT_ID, URI])
s = celo.TaggedSender()
call = {"from": s.address, "to": REGISTRY, "data": "0x" + (data + celo.SUFFIX).hex()}
print("now:", token_uri())
celo.rpc("eth_call", [call, "latest"])
gas = int(celo.rpc("eth_estimateGas", [call]), 16)
print("simulation ok; gas", gas, "nonce", celo.rpc("eth_getTransactionCount", [s.address, "latest"]))
if "--go" not in sys.argv:
    sys.exit(0)
h, rc = s.send(REGISTRY, data, note="erc8004 setAgentURI")
print("tx", h, "status", rc and rc["status"])
print("after:", token_uri())
