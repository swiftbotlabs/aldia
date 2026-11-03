"""Register the Al Día agent on the ERC-8004 Identity Registry from the agent wallet. Dry run unless --go."""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo
from eth_abi import encode
from eth_utils import keccak

REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
URI = "https://aldia.swiftbotlab.workers.dev/agent.json"  # the first registration used the old GitHub account, now gone; see set_agent_uri.py
data = celo.sel("register(string)") + encode(["string"], [URI])
s = celo.TaggedSender()
call = {"from": s.address, "to": REGISTRY, "data": "0x" + (data + celo.SUFFIX).hex()}
ret = celo.rpc("eth_call", [call, "latest"])
gas = int(celo.rpc("eth_estimateGas", [call]), 16)
print("simulation ok; returns", int(ret, 16), "gas", gas, "nonce", celo.rpc("eth_getTransactionCount", [s.address, "latest"]))
if "--go" not in sys.argv:
    sys.exit(0)
h, rc = s.send(REGISTRY, data, note="erc8004 register")
print("tx", h, "status", rc and rc["status"])
transfer = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
for lg in rc["logs"]:
    if lg["address"].lower() == REGISTRY.lower() and lg["topics"][0] == transfer:
        print("agentId", int(lg["topics"][3], 16), "owner", "0x" + lg["topics"][2][-40:])
