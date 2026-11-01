"""Writes tests/vectors.json from a frozen slice of the official series, so both implementations are checked offline."""
import json, sys
sys.path.insert(0, "/home/agent/agent/products/celo-openrails/aldia/agent")
import indices, rent
s = indices.snapshot()
idx = {"ipc": {m: v for m, v in s["ipc"].items() if m >= "2024-06"}, "icl": {d: v for d, v in s["icl"].items() if d[8:] == "01" and d >= "2024-06-01"}}
cases = []
for base in (4000, 500000, 1234567):
    for start in ("2025-01-01", "2025-07-01", "2026-02-01"):
        for period in (1, 3, 4, 6, 12):
            for kind, extra in (("IPC", {"lagMonths": 2}), ("IPC", {"lagMonths": 1}), ("ICL", {}), ("FIJO", {"fixedPct": 12.5})):
                lease = {"baseRent": base, "startDate": start, "periodMonths": period, "index": kind, **extra}
                for month in ("2026-04", "2026-09", "2026-11"):
                    try:
                        r = rent.rent_for_month(lease, month, idx)
                        cases.append({"lease": lease, "month": month, "amount": r["amount"], "adjustments": r["adjustments"]})
                    except rent.NotPublished:
                        cases.append({"lease": lease, "month": month, "missing": True})
json.dump({"indices": idx, "cases": cases}, open("/home/agent/agent/products/celo-openrails/aldia/tests/vectors.json", "w"))
print(len(cases), "cases,", sum(1 for c in cases if "missing" in c), "waiting for an index")
