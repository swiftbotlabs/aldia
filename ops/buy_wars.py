"""Buys wARS with USD₮ from the agent wallet through the Uniswap pool (tagged). Dry run unless --go. Usage: buy_wars.py <usd> [--go]"""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo, market
from eth_abi import encode
ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4"
usd = float(sys.argv[1])
if usd > 4:
    sys.exit("demo ceiling is 4 USD")
amt = int(usd * 1e6)
s = celo.TaggedSender()
q = market.uni_quote(market.USDT, market.WARS, amt)
print("quote wARS", q / 1e18, "rate", q / 1e18 / usd, "usdt", celo.erc20_balance(market.USDT, s.address) / 1e6)
if "--go" not in sys.argv:
    sys.exit(0)
allow = int.from_bytes(celo.eth_call(market.USDT, celo.sel("allowance(address,address)") + encode(["address", "address"], [s.address, ROUTER])), "big")
if allow < amt:
    h, rc = s.send(market.USDT, celo.sel("approve(address,uint256)") + encode(["address", "uint256"], [ROUTER, amt]), note="approve router for wARS purchase")
    print("approve", h, rc["status"])
data = celo.sel("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))") + encode(
    ["(address,address,uint24,address,uint256,uint256,uint160)"], [(market.USDT, market.WARS, 100, s.address, amt, q * 995 // 1000, 0)])
h, rc = s.send(ROUTER, data, note="buy wARS for the first demo rent", gas_margin=1.3)
print("swap", h, rc["status"], "wARS now", celo.erc20_balance(market.WARS, s.address) / 1e18, "usdt", celo.erc20_balance(market.USDT, s.address) / 1e6)
