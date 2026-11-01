"""Builder test only: pays a demo lease's rent in wARS from the agent wallet (tagged), so the whole cycle can be shown
on mainnet. These payments are labelled as our own everywhere. Usage: pay_test_rent.py <collector> <pesos> [--go]"""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo, market
from eth_abi import encode
to, pesos = sys.argv[1], int(sys.argv[2])
if pesos > 5000:
    sys.exit("demo ceiling is 5000 pesos")
s = celo.TaggedSender()
print("wARS held", celo.erc20_balance(market.WARS, s.address) / 1e18)
if "--go" not in sys.argv:
    sys.exit(0)
h, rc = s.send(market.WARS, celo.sel("transfer(address,uint256)") + encode(["address", "uint256"], [to, pesos * 10**18]), note="builder test rent payment")
print("paid", h, rc["status"])
