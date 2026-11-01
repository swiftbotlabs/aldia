"use strict";
/* Rent arithmetic for the browser. Same rules as agent/rent.py; both are held to tests/vectors.json. */
(function (root) {
function addMonths(ym, n) {
  const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + +b.slice(5, 7) - +a.slice(5, 7);

function rentForMonth(lease, month, idx) {
  const start = lease.startDate.slice(0, 7);
  const n = Math.floor(monthsBetween(start, month) / lease.periodMonths);
  if (n < 0) return null;
  const adj = addMonths(start, n * lease.periodMonths);
  const out = { month, adjustmentMonth: adj, adjustments: n, index: lease.index, baseRent: lease.baseRent };
  if (n === 0) return { ...out, amount: lease.baseRent, pct: 0 };
  let factor;
  if (lease.index === "IPC") {
    const lag = lease.lagMonths || 2;
    const to = addMonths(adj, -lag);
    const from = addMonths(start, -lag);
    const prev = addMonths(to, -lease.periodMonths);
    if (!idx.ipc[to] || !idx.ipc[from] || !idx.ipc[prev]) return { ...out, missing: `IPC de ${idx.ipc[to] ? from : to}` };
    factor = idx.ipc[to] / idx.ipc[from];
    out.refFrom = from;
    out.refTo = to;
    out.monthsUsed = Array.from({ length: lease.periodMonths }, (_, i) => addMonths(prev, i + 1));
    out.stepPct = Math.round((idx.ipc[to] / idx.ipc[prev] - 1) * 10000) / 100;
  } else if (lease.index === "ICL") {
    const from = lease.startDate;
    const to = adj + "-01";
    let prev = addMonths(adj, -lease.periodMonths) + "-01";
    if (prev <= from) prev = from;
    if (!idx.icl[to] || !idx.icl[from] || !idx.icl[prev]) return { ...out, missing: `ICL del ${idx.icl[to] ? from : to}` };
    factor = idx.icl[to] / idx.icl[from];
    out.refFrom = from;
    out.refTo = to;
    out.levelFrom = idx.icl[from];
    out.levelTo = idx.icl[to];
    out.stepPct = Math.round((idx.icl[to] / idx.icl[prev] - 1) * 10000) / 100;
  } else {
    factor = Math.pow(1 + lease.fixedPct / 100, n);
    out.stepPct = lease.fixedPct;
  }
  out.amount = Math.floor(lease.baseRent * factor + 0.5);
  out.pct = Math.round((factor - 1) * 10000) / 100;
  return out;
}

  root.AlDiaRent = { addMonths, monthsBetween, rentForMonth };
})(typeof window !== "undefined" ? window : globalThis);
