"""Compare our ERC-8021 suffix layout with a tx a rival sent through the official SDK."""
import sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import celo
print("ours  ", celo.SUFFIX.hex(), len(celo.SUFFIX))
tx = celo.rpc("eth_getTransactionByHash", [sys.argv[1]])
inp = bytes.fromhex(tx["input"][2:])
tail = inp[-40:]
print("theirs", tail.hex())
print("marker match:", inp[-16:] == celo.ERC8021_MARKER, "schema byte:", inp[-17], "len byte:", inp[-18], "code:", inp[-18 - inp[-18]:-18])
print("our layout has code:", celo.SUFFIX[:-18], "len", celo.SUFFIX[-18], "schema", celo.SUFFIX[-17])
