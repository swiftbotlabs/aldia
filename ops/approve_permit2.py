"""Lets Permit2 pull up to 6 USD₮ from the agent wallet for desk quotes. Exact amount, tagged. Stitch's own approve is untagged."""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo, market
from eth_abi import encode
PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
s = celo.TaggedSender()
h, rc = s.send(market.USDT, celo.sel("approve(address,uint256)") + encode(["address", "uint256"], [PERMIT2, 6_000_000]), note="desk: Permit2 allowance, exact 6 USD₮")
print(h, rc["status"])
