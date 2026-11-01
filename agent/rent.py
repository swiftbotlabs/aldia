"""The rent arithmetic. Exact fractions, pesos rounded half up. The web calculator repeats this in JavaScript and both
are held to the same vectors in tests/vectors.json.

Rent in month M = base rent x index(reference month for the last adjustment) / index(reference month at the start).

IPC: with a lag of L months, the adjustment that applies from month A uses IPC(A - L) over IPC(start - L), so a quarterly
contract starting in January with L=2 moves in April by the December, January and February prints. L=2 is the default
because a rent due in the first days of the month can only use data published by then: INDEC publishes each month's
print around the middle of the following month.
ICL: daily index, value on the first day of month A over the value on the contract's start date.
FIJO: a fixed percentage at each adjustment, compounded.
"""
from fractions import Fraction


class NotPublished(Exception):
    """The index needed for this month is not out yet."""


def add_months(ym, n):
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + (m - 1) + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def round_pesos(x):
    x = Fraction(x)
    return int((x + Fraction(1, 2)).__floor__())


def _ipc(indices, month):
    v = indices["ipc"].get(month)
    if v is None:
        raise NotPublished(f"IPC {month}")
    return Fraction(str(v))


def _icl(indices, day):
    v = indices["icl"].get(day)
    if v is None:
        raise NotPublished(f"ICL {day}")
    return Fraction(str(v))


def last_adjustment_month(lease, month):
    """The month the rent of `month` was last adjusted, and how many adjustments have happened."""
    start = lease["startDate"][:7]
    n = months_between(start, month) // lease["periodMonths"]
    if n < 0:
        raise ValueError("month before the contract starts")
    return add_months(start, n * lease["periodMonths"]), n


def rent_for_month(lease, month, indices):
    """Returns the rent of `month` and how it was computed."""
    base = lease["baseRent"]
    start_date = lease["startDate"]
    start = start_date[:7]
    adj_month, n = last_adjustment_month(lease, month)
    out = {"month": month, "adjustmentMonth": adj_month, "adjustments": n, "index": lease["index"], "baseRent": base}
    if n == 0:
        out.update(amount=base, factor="1", pct=0.0)
        return out
    kind = lease["index"]
    if kind == "IPC":
        lag = lease.get("lagMonths", 2)
        ref_to = add_months(adj_month, -lag)
        ref_from = add_months(start, -lag)
        factor = _ipc(indices, ref_to) / _ipc(indices, ref_from)
        prev_to = add_months(ref_to, -lease["periodMonths"])
        out["refFrom"], out["refTo"] = ref_from, ref_to
        out["monthsUsed"] = [add_months(prev_to, i + 1) for i in range(lease["periodMonths"])]
        out["levelFrom"], out["levelTo"] = indices["ipc"][ref_from], indices["ipc"][ref_to]
        out["stepPct"] = round(float((_ipc(indices, ref_to) / _ipc(indices, prev_to) - 1) * 100), 2)
    elif kind == "ICL":
        ref_from, ref_to = start_date, adj_month + "-01"
        factor = _icl(indices, ref_to) / _icl(indices, ref_from)
        prev = add_months(adj_month, -lease["periodMonths"]) + "-01"
        prev = prev if prev > start_date else start_date
        out["refFrom"], out["refTo"] = ref_from, ref_to
        out["levelFrom"], out["levelTo"] = indices["icl"][ref_from], indices["icl"][ref_to]
        out["stepPct"] = round(float((_icl(indices, ref_to) / _icl(indices, prev) - 1) * 100), 2)
    elif kind == "FIJO":
        step = 1 + Fraction(str(lease["fixedPct"])) / 100
        factor = step ** n
        out["stepPct"] = float(lease["fixedPct"])
    else:
        raise ValueError("unknown index")
    out["amount"] = round_pesos(base * factor)
    out["factor"] = f"{float(factor):.6f}"
    out["pct"] = round(float((factor - 1) * 100), 2)
    return out


def next_adjustment(lease, month):
    adj, _ = last_adjustment_month(lease, month)
    return add_months(adj, lease["periodMonths"])
