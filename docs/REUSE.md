# What is reused

Everything in this repository was written during the Agents on Open Rails hackathon, which opened on 6 October 2026.

- `agent/celo.py`: the ERC-8021 suffix function and the idea of one tagged sender come from our earlier Conduit prototype (26 October 2026, same hackathon window, not published separately).
- `agent/buy.py`: the EIP-3009 signing flow follows the same prototype.
- `contracts/lib/forge-std`: Foundry's test library, unchanged.

Third-party services: Ripio ramp, Textile FX, Uniswap v3, Cencori through buy, Telegram Bot API, Cloudflare Workers. pdf.js is loaded from cdnjs in the browser with a pinned integrity hash.
