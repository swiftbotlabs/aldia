"""Demo lease 1 pays the agent wallet, so its sweep is switched off for good: no dollars can reach that wallet from it."""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo
from eth_abi import encode
s = celo.TaggedSender()
L = "0x7F7A423211Fb875Fd62f7b53A79F6c656A6E5D96"
h, rc = s.send(L, celo.sel("setSweep(uint16)") + encode(["uint16"], [0]), note="demo lease 1: sweep off")
print(h, rc["status"], "sweepBps", int.from_bytes(celo.eth_call(L, celo.sel("sweepBps()")), "big"))
