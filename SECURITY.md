# Security

## Where the money is

Rent sits in one `AlDiaLease` contract per rental contract, only until the agent settles it. See "What the agent cannot do" in the README.

A stolen agent key cannot send funds to itself or anyone else except through a swap, and a swap must clear the floor: the higher of the 30-minute and 4-hour TWAPs, less the landlord's slippage limit (1% by default). That limit is not an absolute bound on loss. Someone holding the agent key who also held the Uniswap pool off-price for hours could lower the floor further. Against today's pool depth that means moving tens of thousands of dollars of wARS and leaving it exposed to arbitrage for hours, which costs far more than a rent is worth. Our agent also skips the swap when Textile and Uniswap disagree by more than 1%.

Lease addresses are computed ahead of time, and the contract is deployed when money first arrives. Any money at a lease address gets a contract from which the landlord can withdraw.

## Keys and secrets

- The agent key lives in one 0600 file outside this repository, is read at runtime and is never logged.
- The Worker holds no signing key. Its agent token can write the pages the public sees, which is why a lease's collection address is locked once published: that token cannot redirect rent.
- A landlord's private link carries a random key in the URL fragment, so it never reaches a server log. The Worker stores only its hash.
- Secrets are read by key inside the process, and errors name the key, never its value (`agent/envfile.py`).

## Outside input

- Everything from the web, from contracts and from Telegram is treated as data. The bot understands `/start` with a link it issued and `/parar`, and nothing else reaches any logic.
- A model is called only to read redacted contract text and to compare a calculation with a clause. It has no tools and no keys. Its answer is validated field by field and only fills a form or a note. It never moves money.
- PDFs are parsed in the landlord's browser, not on our machines. DNI, CUIT, CBU, mail and phone are removed there before any text leaves the phone.
- Page text is built as DOM text nodes, so a label cannot become markup, and the CSP blocks inline scripts.
- The Worker also renders every public page as HTML, so it reads without JavaScript. Every value it prints goes through one escaping template in `worker/pages.js`, and a link is built only from a value that matches a strict pattern (transaction hash, address, month). It reads only the records the public API already serves, adds no inline script and leaves the CSP as it was. The landlord panel stays client-side: its key never reaches the server.
- Creation and contract-reading calls have per-IP limits and daily caps. These are best-effort: storage is eventually consistent, so a burst can overshoot them. Paid calls have a per-call and a daily spending ceiling written before the money moves, one attempt per charge, and an allowlist of hosts.
- The open test (`/probar`) is a plain HTML form. It accepts only a Celo address (format and EIP-55 checksum checked), creates a lease with fixed terms (1,000 wARS, all in pesos, the typed address as landlord) through the same path as `/nuevo`, and is limited to 3 a day per address, 3 a day per connection and 25 a day in all, counted in KV. It never signs or moves money: the tester pays from their own wallet and the agent settles as for any lease.
- The outside-payer check (`worker/outside.js`) calls only Blockscout's v2 API on `celo.blockscout.com`, from four fixed path shapes with a checked address or hash and a fixed list of query names; redirects are not followed and replies are size-capped. A failed or unclear answer counts as "not counted". Our wallets that are not already public here reach the Worker as a secret, so the check excludes them without publishing them.
- One failing lease is retried with a growing delay and never stops the others. The agent signs Textile's taker-control digest only after computing it locally, never from an RPC answer.

## Reporting

Open an issue on this repository, or write to swiftbotlabs@gmail.com for anything sensitive.
