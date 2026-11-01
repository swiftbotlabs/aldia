"""Deploys AlDiaFactory for wARS on Celo mainnet from the agent wallet (tagged). Dry run unless --go."""
import json, sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo
from eth_abi import encode

art = json.load(open("/home/agent/agent/products/celo-openrails/aldia/contracts/out/AlDiaFactory.sol/AlDiaFactory.json"))
code = bytes.fromhex(art["bytecode"]["object"].removeprefix("0x"))
AGENT = "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"
WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"
USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
POOL = "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391"
REACTOR = "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3"
ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4"
args = encode(["address", "address", "address", "address", "uint24", "uint32", "uint32", "address", "address", "address"],
              [AGENT, WARS, USDT, POOL, 100, 1800, 14400, REACTOR, ROUTER, AGENT])
data = code + args
s = celo.TaggedSender(max_cost_celo=2.5)
gas = int(celo.rpc("eth_estimateGas", [{"from": s.address, "data": "0x" + (data + celo.SUFFIX).hex()}]), 16)
print("gas", gas, "est CELO", gas * 204e9 / 1e18, "ctor args", args.hex()[:0])
if "--go" not in sys.argv:
    sys.exit(0)
h, rc = s.send(None, data, note="deploy AlDiaFactory v2 (wARS, two-window floor)", gas_margin=1.2, wait_s=120)
print("tx", h, "status", rc["status"], "factory", rc["contractAddress"])
impl = celo.eth_call(rc["contractAddress"], celo.sel("implementation()"))
print("implementation 0x" + impl[-20:].hex())
