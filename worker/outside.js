// Who counts as an outside payer, checked automatically before anyone is counted or listed.
// A payment counts only when all of this holds, read from Celo's public explorer (Blockscout, keyless):
//  - it is a settled rent: the agent published a receipt that names the payment transaction;
//  - the wARS went straight from the paying wallet to the lease (the transaction sender is the token sender);
//  - that wallet pays at least half of that month's rent;
//  - the wallet is not ours, its first funds did not come from one of our wallets, and its first Celo activity is
//    before 2026-10-06 (the hackathon's independent-user rule).
// Anything we cannot read or prove is not counted (fail closed). Only Blockscout's v2 API is called, from fixed URL parts.

export const CUTOFF_DAY = "2026-10-06";
export const CUTOFF = Date.UTC(2026, 9, 6) / 1000;
export const WARS = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";
const HOST = "celo.blockscout.com";
// Our wallets that are already public in this repository. Other wallets of ours are excluded too: they reach the Worker as
// the EXTRA_OURS secret, so this file does not publish them.
export const PUBLIC_OURS = {
  agent: "0xed120aec2240a25125b3f32eb8bff9c5f688121b",
  testLandlord: "0x8ee66fcd89e2cb492b9b19b1380d93e792df9aaa",
};
// Tokens that count as funding a wallet (checked on Blockscout: symbol, name, decimals). A spam airdrop is never a funder.
const FUNDING = new Set([
  "0x471ece3750da237f93b8e339c536989b8978a438", // CELO
  "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e", // USD₮
  "0xceba9300f2b948710d2653dd7b07f33a8b32118c", // USDC
  "0x765de816845861e75a25fca122bb6898b8b1282a", // USDm (cUSD)
  "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73", // EURm
  "0xe8537a3d056da446677b9e9d6c5db704eaab4787", // BRLm
  "0x456a3d042c0dbd3db53d5489e98dfb038553b0d0", // KESm
  "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771", // USAT
  WARS,
]);
export const REASONS = ["ok", "ours", "funded-by-us", "new-wallet", "unclear", "no-history", "indirect", "partial", "unchecked", "invalid"];

const ADDR = /^0x[0-9a-f]{40}$/;
const TX = /^0x[0-9a-f]{64}$/;
const lc = (s) => (typeof s === "string" ? s.toLowerCase() : "");
export const isAddrLc = (a) => ADDR.test(lc(a));
const big = (v) => {
  try {
    return typeof v === "string" && /^\d{1,80}$/.test(v) ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
};

export function ourWallets(env) {
  const s = new Set(Object.values(PUBLIC_OURS));
  for (const a of String((env && env.EXTRA_OURS) || "").split(/[\s,]+/)) {
    const x = a.trim().toLowerCase();
    if (ADDR.test(x)) s.add(x);
  }
  return s;
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Verdicts are cached under a tag of the exclusion list, so adding a wallet of ours re-checks every cached answer.
export async function oursTag(ours) {
  return (await sha256Hex([...ours].sort().join(","))).slice(0, 12);
}

// One GET to Blockscout's keyless v2 API (its Etherscan-style /api allows only a few calls an hour without a key).
// The path is one of four fixed shapes with a checked address or hash; query names come from a fixed list.
const PATHS = /^(addresses\/0x[0-9a-f]{40}\/(transactions|token-transfers|internal-transactions)|transactions\/0x[0-9a-f]{64})$/;
const PARAMS = new Set(["sort", "order", "type", "filter", "block_number", "index", "transaction_index", "items_count"]);
export function blockscoutGetter(fetchFn, { timeoutMs = 8000, maxBytes = 2_000_000, retryMs = 1500 } = {}) {
  const once = async (path, params) => {
    if (!PATHS.test(path)) throw new Error("bad path");
    for (const [k, v] of Object.entries(params)) {
      if (!PARAMS.has(k) || !/^[0-9A-Za-z_-]{1,66}$/.test(String(v))) throw new Error("bad parameter");
    }
    const url = new URL(`https://${HOST}/api/v2/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (url.protocol !== "https:" || url.hostname !== HOST) throw new Error("host");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn(url.toString(), { headers: { accept: "application/json", "user-agent": "aldia/1" }, signal: ctl.signal, redirect: "manual" });
      if (r.status !== 200) throw new Error("explorer status " + r.status);
      if (Number(r.headers.get("content-length") || 0) > maxBytes) throw new Error("reply too big");
      const text = await r.text();
      if (text.length > maxBytes) throw new Error("reply too big");
      const d = JSON.parse(text);
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("bad reply");
      return d;
    } finally {
      clearTimeout(t);
    }
  };
  // A burst can be rate-limited (429) or hit a busy node (5xx): one retry after a pause, then the caller fails closed.
  return async (path, params = {}) => {
    try {
      return await once(path, params);
    } catch (e) {
      if (!/status (429|50[0234])/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, retryMs));
      return once(path, params);
    }
  };
}

export function itemsOf(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) throw new Error("bad reply");
  return d.items.slice(0, 100);
}
// The next page of a newest-first list, if any, as checked query values.
function nextOf(d) {
  const n = d && d.next_page_params;
  if (!n || typeof n !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(n)) {
    if (!PARAMS.has(k) || v === null || !/^[0-9A-Za-z_-]{1,66}$/.test(String(v))) throw new Error("bad page");
    out[k] = String(v);
  }
  return out;
}
const tsOf = (t) => (typeof t === "string" ? Math.floor(Date.parse(t) / 1000) : NaN);
const hashOf = (o) => lc(o && typeof o === "object" ? o.hash : "");
const tokenOf = (t) => lc(t && t.token && typeof t.token === "object" ? t.token.address_hash || t.token.address : "");
const valid = (e) => Number.isFinite(e.b) && e.b > 0 && Number.isFinite(e.ts) && e.ts > 0;

// Up to `pages` pages of a newest-first list that starts just after block `b`, so only what happened up to `b` comes back.
async function upTo(get, path, params, b, pages, start = {}) {
  let q = { ...params, block_number: String(b + 1), index: "0", ...start };
  const out = [];
  for (let i = 0; i < pages; i++) {
    const d = await get(path, q);
    out.push(...itemsOf(d));
    const n = nextOf(d);
    if (!n) return out;
    q = { ...params, ...n };
  }
  throw new Error("too many transfers before the first send");
}

// The independence test for one wallet. `get` is a Blockscout getter; `ours` the set of our wallets (lowercase).
// Returns { counted, reason, firstSeen?, final }. `final` = safe to cache: the answer cannot change with time.
// An address must hold funds before it can send its first transaction, so its first funds arrived at or before that block.
// The explorer lists transactions oldest first; transfers and internal moves only newest first, so those two are read from
// that block backwards, where there are usually one or two.
export async function checkWallet(address, get, ours) {
  const a = lc(address);
  if (!ADDR.test(a)) return { counted: false, reason: "invalid", final: true };
  if (ours.has(a)) return { counted: false, reason: "ours", final: true };
  const txs = itemsOf(await get(`addresses/${a}/transactions`, { sort: "block_number", order: "asc" }))
    .map((t) => ({ b: Number(t.block_number), ts: tsOf(t.timestamp), from: hashOf(t.from), to: hashOf(t.to), value: big(t.value), failed: t.status !== "ok" }))
    .filter(valid).sort((x, y) => x.b - y.b);
  if (!txs.length) return { counted: false, reason: "no-history", final: false };
  const out = txs.find((e) => e.from === a);
  if (!out) return { counted: false, reason: "unclear", firstSeen: txs[0].ts, final: false };
  const B = out.b;
  let toks;
  let ints;
  try {
    toks = await upTo(get, `addresses/${a}/token-transfers`, { type: "ERC-20", filter: "to" }, B, 2);
    ints = await upTo(get, `addresses/${a}/internal-transactions`, { filter: "to" }, B, 2, { transaction_index: "0" });
  } catch (e) {
    if (/too many transfers/.test(String(e))) return { counted: false, reason: "unclear", firstSeen: txs[0].ts, final: false };
    throw e;
  }
  const events = [
    ...txs,
    ...toks.filter((t) => FUNDING.has(tokenOf(t))).map((t) => ({ b: Number(t.block_number), ts: tsOf(t.timestamp), from: hashOf(t.from), to: hashOf(t.to), value: big(t.total && t.total.value), failed: false })),
    ...ints.map((t) => ({ b: Number(t.block_number), ts: tsOf(t.timestamp), from: hashOf(t.from), to: hashOf(t.to), value: big(t.value), failed: t.success !== true })),
  ].filter(valid).filter((e) => e.from === a || e.to === a);
  const firstSeen = Math.min(...events.map((e) => e.ts));
  const funding = events.filter((e) => e.b <= B && e.to === a && e.from !== a && e.value > 0n && !e.failed).sort((x, y) => x.b - y.b || x.ts - y.ts);
  if (!funding.length) return { counted: false, reason: "unclear", firstSeen, final: false };
  // Several transfers in the wallet's first funded block: if any of them is ours, the wallet was funded by us.
  const first = funding.filter((e) => e.b === funding[0].b);
  const funder = (first.find((e) => ours.has(e.from)) || first[0]).from; // returned for checks, never stored or shown
  if (ours.has(funder)) return { counted: false, reason: "funded-by-us", firstSeen, funder, final: true };
  if (firstSeen >= CUTOFF) return { counted: false, reason: "new-wallet", firstSeen, funder, final: true };
  return { counted: true, reason: "ok", firstSeen, funder, final: true };
}

// The wARS transfers behind a receipt's payment transactions: who sent them, straight or through something else.
export async function paymentRows(get, collector, txs) {
  const c = lc(collector);
  const list = itemsOf(await get(`addresses/${c}/token-transfers`, { type: "ERC-20", filter: "to" }));
  const rows = [];
  const missing = [];
  for (const tx of txs) {
    const ins = list.filter((t) => lc(t.transaction_hash || t.tx_hash) === tx && hashOf(t.to) === c && tokenOf(t) === WARS && ADDR.test(hashOf(t.from)));
    if (!ins.length) {
      missing.push(tx);
      continue;
    }
    const info = await get(`transactions/${tx}`);
    const sender = info.status === "ok" ? hashOf(info.from) : "";
    if (!ADDR.test(sender)) {
      missing.push(tx);
      continue;
    }
    const byFrom = new Map();
    for (const t of ins) byFrom.set(hashOf(t.from), (byFrom.get(hashOf(t.from)) || 0n) + big(t.total && t.total.value));
    for (const [from, value] of byFrom) {
      rows.push({ tx, from, sender, wars: Number(value / 10n ** 18n), ts: tsOf(ins[0].timestamp) || 0 });
    }
  }
  return { rows, missing };
}

const day = (ts) => (ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : null);
const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

async function kvGet(env, key) {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

// A per-call budget of explorer requests, so one page view never runs past the Worker's subrequest limit.
function budget(max) {
  let used = 0;
  return { take: (n) => (used + n > max ? false : ((used += n), true)), get used() { return used; } };
}

async function receiptTxs(env, id, month) {
  const r = await kvGet(env, `receipt:${id}:${month}`);
  if (!r) return null;
  const txs = [...(Array.isArray(r.paymentTxs) ? r.paymentTxs : []), ...(Array.isArray(r.paymentTxsLate) ? r.paymentTxsLate : [])]
    .map(lc).filter((t) => TX.test(t));
  return { receipt: r, txs: [...new Set(txs)].slice(0, 10), amount: Number.isFinite(r.amount) ? r.amount : null };
}

async function cachedRows(env, id, month, collector, txs, get, b) {
  const key = `payrows:${id}:${month}`;
  const hit = await kvGet(env, key);
  if (hit && Array.isArray(hit.rows) && hit.txs === txs.join(",")) return hit.rows;
  if (!b.take(1 + txs.length)) return null;
  const { rows, missing } = await paymentRows(get, collector, txs);
  if (!missing.length) await env.KV.put(key, JSON.stringify({ txs: txs.join(","), rows }));
  return missing.length ? null : rows;
}

export async function walletVerdict(env, address, get, ours, tag, b) {
  const a = lc(address);
  if (!ADDR.test(a)) return { counted: false, reason: "invalid" };
  if (ours.has(a)) return { counted: false, reason: "ours" };
  const key = `indep:${tag}:${a}`;
  const hit = await kvGet(env, key);
  if (hit && REASONS.includes(hit.reason)) return hit;
  if (!b.take(5)) return { counted: false, reason: "unchecked" };
  let v;
  try {
    v = await checkWallet(a, get, ours);
  } catch {
    return { counted: false, reason: "unchecked" };
  }
  const out = { counted: v.counted === true, reason: v.reason, firstSeen: Number.isFinite(v.firstSeen) ? v.firstSeen : null, checkedAt: new Date().toISOString() };
  // Final answers are kept; open ones (no history yet, unclear funding) are retried after a while.
  await env.KV.put(key, JSON.stringify(out), v.final ? undefined : { expirationTtl: 1800 });
  return out;
}

// Every payment behind one settled month of one lease, each with its verdict.
export async function judgeMonth(env, ctx, id, month, collector) {
  const { get, ours, tag, b } = ctx;
  const rt = await receiptTxs(env, id, month);
  if (!rt || !rt.txs.length) return [];
  let rows;
  try {
    rows = await cachedRows(env, id, month, collector, rt.txs, get, b);
  } catch {
    rows = null;
  }
  if (!rows) return rt.txs.map((tx) => ({ id, month, tx, address: null, counted: false, reason: "unchecked", date: null }));
  const paidBy = new Map();
  for (const r of rows) paidBy.set(r.from, (paidBy.get(r.from) || 0) + r.wars);
  const out = [];
  for (const r of rows) {
    const base = { id, month, tx: r.tx, address: r.from, date: day(r.ts), wars: r.wars };
    if (r.sender !== r.from) out.push({ ...base, counted: false, reason: ours.has(r.from) || ours.has(r.sender) ? "ours" : "indirect" });
    else if (rt.amount && paidBy.get(r.from) * 2 < rt.amount) out.push({ ...base, counted: false, reason: ours.has(r.from) ? "ours" : "partial" });
    else {
      const v = await walletVerdict(env, r.from, get, ours, tag, b);
      out.push({ ...base, counted: v.counted === true, reason: v.reason, firstSeen: v.firstSeen ? day(v.firstSeen) : null });
    }
  }
  return out;
}

export async function judgeContext(env, maxFetches) {
  const ours = ourWallets(env);
  const get = blockscoutGetter(env.FETCH || fetch, { retryMs: env.EXPLORER_RETRY_MS === undefined ? 1500 : Number(env.EXPLORER_RETRY_MS) });
  return { get, ours, tag: await oursTag(ours), b: budget(maxFetches) };
}

function paidMonths(pub) {
  const h = Array.isArray(pub.history) ? pub.history : [];
  const ms = h.filter((x) => x && x.status === "pagado" && isMonth(x.month)).map((x) => x.month);
  if (pub.current && pub.current.status === "pagado" && isMonth(pub.current.month)) ms.push(pub.current.month);
  return [...new Set(ms)].sort().slice(-24);
}

// Every settled payment on every lease that is not one of our builder tests, judged. Stored as one public record.
export async function computeSummary(env, { maxFetches = 20 } = {}) {
  const ctx = await judgeContext(env, maxFetches);
  const listed = await env.KV.list({ prefix: "pub:" });
  const ids = (listed.keys || []).map((k) => k.name.slice(4)).filter((id) => /^[0-9a-f]{12}$/.test(id)).slice(0, 400);
  const judged = [];
  let complete = listed.list_complete !== false;
  for (const id of ids) {
    const pub = await kvGet(env, `pub:${id}`);
    if (!pub || pub.builderTest === true || !isAddrLc(pub.collector)) continue;
    for (const month of paidMonths(pub)) {
      const rows = await judgeMonth(env, ctx, id, month, pub.collector);
      if (rows.some((r) => r.reason === "unchecked")) complete = false;
      judged.push(...rows);
    }
  }
  return summarize(judged, complete);
}

export function summarize(judged, complete) {
  const counted = judged.filter((r) => r.counted);
  const byPayer = new Map();
  for (const r of counted.sort((x, y) => String(x.date).localeCompare(String(y.date)))) {
    if (!byPayer.has(r.address)) byPayer.set(r.address, { address: r.address, tx: r.tx, date: r.date, firstSeen: r.firstSeen || null, id: r.id, month: r.month, label: "builder", payments: 0 });
    byPayer.get(r.address).payments++;
  }
  const notCounted = judged.filter((r) => !r.counted).slice(0, 50).map((r) => ({
    address: r.reason === "ours" ? null : r.address, reason: r.reason, tx: r.tx, date: r.date,
  }));
  return { v: 1, checkedAt: new Date().toISOString(), complete, count: byPayer.size, payments: counted.length, payers: [...byPayer.values()], notCounted, rule: { cutoff: CUTOFF_DAY } };
}

// The stored summary, refreshed at most every few minutes; a refresh runs after the response when one is on screen already.
export const EMPTY = { v: 1, checkedAt: null, complete: false, count: 0, payments: 0, payers: [], notCounted: [], rule: { cutoff: CUTOFF_DAY } };
// A Worker must not await I/O started by another request, so each refresh belongs to the request that starts it; this
// stamp only stops one isolate from starting a second refresh while its first is still running.
let startedAt = 0;
export async function outsideSummary(env, waitUntil) {
  let s = await kvGet(env, "outside:summary");
  if (s && (!Array.isArray(s.payers) || !Array.isArray(s.notCounted))) s = null;
  const fresh = env.OUTSIDE_FRESH_MS === undefined ? 600_000 : Number(env.OUTSIDE_FRESH_MS);
  const age = s && s.checkedAt ? Date.now() - Date.parse(s.checkedAt) : Infinity;
  if (s && age < (s.complete ? fresh : Math.min(fresh, 60_000))) return s;
  if (waitUntil && Date.now() - startedAt < 30_000) return s || EMPTY;
  startedAt = Date.now();
  const p = computeSummary(env)
    .then(async (n) => {
      await env.KV.put("outside:summary", JSON.stringify(n));
      return n;
    })
    .catch(() => null)
    .finally(() => {
      startedAt = 0;
    });
  // With a request context the page never waits for the explorer: it shows what is stored (or nothing counted yet).
  if (waitUntil) {
    waitUntil(p);
    return s || EMPTY;
  }
  return (await p) || s || EMPTY;
}
