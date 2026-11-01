#!/bin/bash
# All offline tests, then the contract tests on a mainnet fork.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-/home/agent/agent/wallet-venv/bin/python}
"$PY" -I tests/test_agent.py 2>&1 | tail -3
python3 -I ops/deploy_worker.py --bundle-only
node tests/test_web.mjs
(cd contracts && HOME=/home/agent/agent/.sbxhome /home/agent/agent/foundry/bin/forge test --offline 2>&1 | tail -3)
