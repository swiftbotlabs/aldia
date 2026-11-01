# Security

## Where the money is

Rent sits in one `AlDiaLease` contract per rental contract, only until the agent settles it. See "What the agent cannot do" in the README for what a stolen agent key can and cannot reach. In the worst case it can settle a rent at up to the landlord's slippage limit (1% by default) below the 30-minute TWAP. It cannot send funds anywhere else.

## Keys and secrets

- The agent key lives in one 0600 file outside this repository, is read at runtime and is never logged.
- The Worker holds no signing key. Its token for the agent API only writes public pages.
- A landlord's private link carries a random key in the URL fragment, so it never reaches a server log. The Worker stores only its hash.
- Secrets are read by key inside the process, and errors name the key, never its value (`agent/envfile.py`).

## Outside input

- Everything from the web, from contracts and from Telegram is treated as data. The bot understands `/start` with a link it issued and `/parar`, and nothing else reaches any logic.
- A model is called only to read redacted contract text and to compare a calculation with a clause. It has no tools and no keys. Its answer is validated field by field and only fills a form or a note. It never moves money.
- PDFs are parsed in the landlord's browser, not on our machines. DNI, CUIT, CBU, mail and phone are removed there before any text leaves the phone.
- Page text is built as DOM text nodes, so a label cannot become markup, and the CSP blocks inline scripts.
- Creation and contract-reading calls have per-IP limits and hard daily caps. Paid calls have a per-call and a daily spending ceiling, and an allowlist of hosts.

## Reporting

Open an issue on this repository, or write to swiftbotlabs@gmail.com for anything sensitive.
