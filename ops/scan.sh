#!/bin/bash
# Zero-hit secret scan over everything staged. Exit 1 on any hit. Run as: ops/scan.sh && git commit ...
cd "$(git rev-parse --show-toplevel)" || exit 2
FILES=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$FILES" ] && { echo "nothing staged"; exit 0; }
HITS=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in *.png|*.mp4|*.jpg|*.ico|*.woff2|contracts/lib/*) continue;; esac
  # 64-hex strings that are not known public values, long tokens, env-style secrets
  if grep -n -E '(^|[^0-9a-fA-Fx])(0x)?[0-9a-fA-F]{64}([^0-9a-fA-F]|$)' "$f" | grep -v -E 'keccak|topic|TOPIC|bytes32|erc8021|0x[0-9a-f]{64}.*(tx|Tx|hash)|celoscan|blockscout|allow-secret-scan|0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0' | sed 's/^/HEX /' | grep . ; then HITS=1; fi
  if grep -n -E 'ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9]{20,}|xox[bap]-|AKIA[0-9A-Z]{16}|-----BEGIN .*PRIVATE KEY-----|CLOUDFLARE_API_TOKEN=|tx_live_|AGENT_TOKEN=[A-Za-z0-9]' "$f" | grep -v 'allow-secret-scan' | sed 's/^/TOK /' | grep . ; then HITS=1; fi
done <<< "$FILES"
if [ -d /home/agent/agent/secrets ]; then
  V=$(python3 -I - <<'PY'
import os,re
d='/home/agent/agent/secrets'
out=set()
p=os.path.join(d,'celo_openrails_agent.key')
try:
    out.add(open(p).read().strip().replace('0x',''))
except Exception: pass
print('\n'.join(x for x in out if x))
PY
)
  if [ -n "$V" ]; then while IFS= read -r f; do [ -f "$f" ] && grep -q -F -f <(echo "$V") "$f" && { echo "KEY MATERIAL in $f"; HITS=1; }; done <<< "$FILES"; fi
fi
[ "$HITS" = 0 ] && echo "scan clean" || { echo "scan FAILED"; exit 1; }
