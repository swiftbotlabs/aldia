// Offline tests for the open test (/probar) and the outside-payer check, with a fake KV and a fake Blockscout.
// Positive and negative controls for every rule: ours, first funded by us, first seen after the cutoff, a real older
// outside wallet, plus the fail-closed paths, the form limits and escaping of everything a stranger can type.
import assert from "node:assert";
import { checkWallet, blockscoutGetter, ourWallets, itemsOf, CUTOFF, PUBLIC_OURS, WARS } from "../worker/outside.js";
import { checksumOk, toChecksum } from "../worker/eip55.js";

const { default: worker } = await import("../worker/worker.js");

/* ---------- fake Blockscout (v2 API shapes, newest-first lists honour the block_number keyset like the real one) ---------- */
const AGENT = PUBLIC_OURS.agent;
const LANDLORD = PUBLIC_OURS.testLandlord;
const EXTRA = "0x4444444444444444444444444444444444444444";
const STRANGER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // an exchange or friend, not ours
const CELO = "0x471ece3750da237f93b8e339c536989b8978a438";
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const SPAM = "0x9999999999999999999999999999999999999999";
const T2025 = Date.UTC(2025, 4, 1) / 1000;
const T_NEW = Date.UTC(2026, 9, 20) / 1000;
const W = {
  old: "0x1111111111111111111111111111111111111111", // real older outside wallet: counted
  fundedByUs: "0x2222222222222222222222222222222222222222",
  fresh: "0x3333333333333333333333333333333333333333", // first seen after 2026-10-06
  spamThenUs: "0x5555555555555555555555555555555555555555", // a spam airdrop first, then real funds from us
  tie: "0x6666666666666666666666666666666666666666", // first funded block has a transfer from us
  unclear: "0x7777777777777777777777777777777777777777", // sent a (failed) tx, no funds visible
  broken: "0x8888888888888888888888888888888888888888", // the explorer answers garbage
  edge: "0x1212121212121212121212121212121212121212", // first seen exactly at the cutoff
  neverSent: "0x1313131313131313131313131313131313131313", // only received
  laterUs: "0x1414141414141414141414141414141414141414", // first funds from a stranger; we sent something only later
  viaContract: "0x1515151515151515151515151515151515151515", // first funds from us through a contract call (internal)
  busy: "0x1616161616161616161616161616161616161616", // endless transfers before its first send
};
const tx = (n) => "0x" + n.toString(16).padStart(64, "0");
const iso = (ts) => new Date(ts * 1000).toISOString().replace(".000Z", ".000000Z");
const T = (b, ts, from, to, o = {}) => ({ block_number: b, timestamp: iso(ts), from: { hash: from }, to: to ? { hash: to } : null, value: String(o.value ?? 0), status: o.failed ? "error" : "ok", hash: o.hash || tx(b) });
const X = (b, ts, from, to, token, value, hash) => ({ block_number: b, timestamp: iso(ts), from: { hash: from }, to: { hash: to }, token: { address_hash: token }, total: { value: String(value) }, transaction_hash: hash || tx(b * 7), log_index: 0 });
const I = (b, ts, from, to, value, ok = true) => ({ block_number: b, timestamp: iso(ts), from: { hash: from }, to: { hash: to }, value: String(value), success: ok, transaction_hash: tx(b * 11), index: 1, transaction_index: 0 });
const lists = {
  [W.old]: { txs: [T(100, T2025 + 60, W.old, USDT)], toks: [X(99, T2025, STRANGER, W.old, USDT, 5000000)] },
  [W.fundedByUs]: { txs: [T(200, T2025, AGENT, W.fundedByUs, { value: "1000000000000000000" }), T(202, T2025 + 10, W.fundedByUs, USDT)], toks: [X(201, T2025 + 5, STRANGER, W.fundedByUs, USDT, 1)] },
  [W.fresh]: { txs: [T(301, T_NEW + 60, W.fresh, USDT)], toks: [X(300, T_NEW, STRANGER, W.fresh, USDT, 7000000)] },
  [W.spamThenUs]: { txs: [T(402, T2025 + 20, W.spamThenUs, USDT)], toks: [X(400, T2025, STRANGER, W.spamThenUs, SPAM, 1), X(401, T2025 + 5, AGENT, W.spamThenUs, USDT, 9000000)] },
  [W.tie]: { txs: [T(501, T2025 + 20, W.tie, USDT)], toks: [X(500, T2025, STRANGER, W.tie, CELO, 1, tx(5001)), X(500, T2025, LANDLORD, W.tie, USDT, 1, tx(5002))] },
  [W.unclear]: { txs: [T(600, T2025, W.unclear, USDT, { failed: true })] },
  [W.edge]: { txs: [T(701, CUTOFF + 60, W.edge, USDT)], toks: [X(700, CUTOFF, STRANGER, W.edge, CELO, 1)] },
  [W.neverSent]: { txs: [T(900, T2025, STRANGER, W.neverSent, { value: "5" })] },
  [W.laterUs]: { txs: [T(1002, T2025 + 20, W.laterUs, USDT)], toks: [X(1000, T2025, STRANGER, W.laterUs, USDT, 5000000), X(1005, T2025 + 50, AGENT, W.laterUs, USDT, 5000000)] },
  [W.viaContract]: { txs: [T(1101, T2025 + 20, W.viaContract, USDT)], ints: [I(1100, T2025, AGENT, W.viaContract, "1000000000000000000")] },
  [W.busy]: { txs: [T(1201, T2025 + 20, W.busy, USDT)], toks: [X(1200, T2025, STRANGER, W.busy, USDT, 1)], endless: true },
  [EXTRA]: { txs: [T(801, T2025 + 20, EXTRA, USDT)], toks: [X(800, T2025, STRANGER, EXTRA, CELO, 1)] },
};
const collectors = {}; // collector -> wARS transfers into it
const senders = {}; // tx -> transaction sender
const calls = [];
async function fakeFetch(u) {
  const url = new URL(u);
  assert.strictEqual(url.hostname, "celo.blockscout.com", "only Blockscout is ever called");
  assert.strictEqual(url.protocol, "https:");
  assert.ok(url.pathname.startsWith("/api/v2/"), "the v2 API, with its own rate limit");
  calls.push(url.pathname + url.search);
  const p = Object.fromEntries(url.searchParams);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  let m = url.pathname.match(/^\/api\/v2\/transactions\/(0x[0-9a-f]{64})$/);
  if (m) return senders[m[1]] ? reply({ hash: m[1], from: { hash: senders[m[1]] }, status: "ok" }) : reply({ message: "Not found" }, 404);
  m = url.pathname.match(/^\/api\/v2\/addresses\/(0x[0-9a-f]{40})\/(transactions|token-transfers|internal-transactions)$/);
  assert.ok(m, url.pathname);
  const [, addr, kind] = m;
  if (addr === W.broken) return reply({ message: "Internal server error" });
  if (kind === "token-transfers" && collectors[addr]) return reply({ items: collectors[addr], next_page_params: null });
  const L = lists[addr] || {};
  if (kind === "transactions") {
    assert.ok(p.sort === "block_number" && p.order === "asc", "oldest first");
    return reply({ items: [...(L.txs || [])].sort((x, y) => x.block_number - y.block_number), next_page_params: null });
  }
  const below = p.block_number ? Number(p.block_number) : Infinity;
  if (kind === "internal-transactions" && p.block_number) assert.ok(p.transaction_index !== undefined, "internal keyset needs transaction_index");
  const items = (kind === "token-transfers" ? L.toks : L.ints) || [];
  const page = items.filter((t) => t.block_number < below && hashOrNull(t.to) === addr).sort((x, y) => y.block_number - x.block_number);
  return reply({ items: page, next_page_params: L.endless ? { block_number: 5, index: 1 } : null });
}
const hashOrNull = (o) => (o && o.hash ? o.hash.toLowerCase() : null);
const get = blockscoutGetter(fakeFetch, { retryMs: 5 });
const ours = ourWallets({ EXTRA_OURS: `${EXTRA}, not-an-address ,0xZZ` });
assert.ok(ours.has(AGENT) && ours.has(LANDLORD) && ours.has(EXTRA) && ours.size === 3, "public wallets plus the secret list; junk entries ignored");

/* ---------- the independence check ---------- */
const v = async (a) => checkWallet(a, get, ours);
let before = calls.length;
assert.deepStrictEqual(await v(AGENT), { counted: false, reason: "ours", final: true }, "our agent wallet is never counted");
assert.strictEqual((await v(LANDLORD.toUpperCase().replace("0X", "0x"))).reason, "ours", "case does not hide our wallet");
assert.strictEqual((await v(EXTRA)).reason, "ours", "a wallet on the secret list is ours too");
assert.strictEqual(calls.length, before, "our own wallets are refused without any explorer call");
assert.strictEqual((await v(W.fundedByUs)).reason, "funded-by-us", "first funded by our agent wallet");
assert.strictEqual((await v(W.spamThenUs)).reason, "funded-by-us", "a spam airdrop cannot stand in as the first funder");
assert.strictEqual((await v(W.tie)).reason, "funded-by-us", "same first block, one transfer from us: funded by us");
assert.strictEqual((await v(W.viaContract)).reason, "funded-by-us", "funds from us through a contract call still count as ours");
assert.strictEqual((await v(W.fresh)).reason, "new-wallet", "first Celo activity after 2026-10-06");
assert.strictEqual((await v(W.edge)).reason, "new-wallet", "first activity exactly at the cutoff is not before it");
assert.strictEqual((await v(W.unclear)).reason, "unclear", "no visible funding: not counted");
assert.strictEqual((await v(W.neverSent)).reason, "unclear", "a wallet that never sent anything cannot be judged");
assert.strictEqual((await v(W.busy)).reason, "unclear", "too much to read before the first send: not counted");
assert.strictEqual((await v("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).reason, "no-history");
assert.strictEqual((await v("javascript:alert(1)")).reason, "invalid");
const good = await v(W.old);
assert.strictEqual(good.counted, true, "a real older outside wallet is counted");
assert.strictEqual(good.reason, "ok");
assert.strictEqual(good.firstSeen, T2025);
assert.strictEqual(good.funder, STRANGER);
assert.strictEqual((await v(W.laterUs)).reason, "ok", "money from us after the first funding does not change who funded it first");
// a wallet that would pass becomes ours the moment it joins our list: positive control for the exclusion
assert.strictEqual((await checkWallet(W.old, get, ourWallets({ EXTRA_OURS: W.old }))).reason, "ours");
// a wallet first funded by a wallet we add later is re-judged
assert.strictEqual((await checkWallet(W.old, get, ourWallets({ EXTRA_OURS: STRANGER }))).reason, "funded-by-us");
await assert.rejects(v(W.broken), "an explorer reply without rows is an error, never an answer");
assert.throws(() => itemsOf({ message: "Internal server error" }));
assert.throws(() => itemsOf(null));
assert.deepStrictEqual(itemsOf({ items: [] }), []);
await assert.rejects(get("addresses/0x1111111111111111111111111111111111111111/transactions", { sort: "x&order=desc" }), "values cannot smuggle in other parameters");
await assert.rejects(get("addresses/0x1111111111111111111111111111111111111111/transactions", { evil: "1" }), "unknown parameter names are refused");
await assert.rejects(get("../../v1/secret"), "only the four fixed paths");
await assert.rejects(get("addresses/0x1111111111111111111111111111111111111111/transactions?x=1"), "no query in the path");
await assert.rejects(blockscoutGetter(async () => new Response("x", { status: 302, headers: { location: "http://127.0.0.1:9222/" } }))("transactions/" + tx(1)), "a redirect is never followed");
await assert.rejects(blockscoutGetter(async () => new Response("x".repeat(50), { status: 200 }), { maxBytes: 10 })("transactions/" + tx(1)), "size cap");
let hits = 0;
const flaky = blockscoutGetter(async () => (++hits === 1 ? new Response("slow down", { status: 429 }) : new Response('{"items":[]}', { status: 200 })), { retryMs: 10 });
assert.deepStrictEqual(await flaky("transactions/" + tx(1)), { items: [] });
assert.strictEqual(hits, 2, "one retry after a rate limit");
hits = 0;
await assert.rejects(blockscoutGetter(async () => (++hits, new Response("busy", { status: 503 })), { retryMs: 10 })("transactions/" + tx(1)), "a second failure fails closed");
assert.strictEqual(hits, 2, "and never more than one retry");
console.log("independence check ok");

/* ---------- EIP-55 ---------- */
for (const a of ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb", "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"]) {
  assert.ok(checksumOk(a) && toChecksum(a.toLowerCase()) === a, a);
}
assert.ok(!checksumOk("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), "one wrong case letter is a typo");
assert.ok(checksumOk("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed") && checksumOk("0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"), "no checksum info passes");
console.log("eip55 ok");

/* ---------- the Worker with a fake KV ---------- */
const kv = new Map();
const KV = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, val) => void kv.set(k, val),
  delete: async (k) => void kv.delete(k),
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url) || null, put: async (r, val) => void store.set(r.url, val) } };
const env = { KV, AGENT_TOKEN: "t".repeat(64), SSR_CACHE_MS: 0, OUTSIDE_FRESH_MS: 0, FETCH: fakeFetch, EXTRA_OURS: EXTRA, EXPLORER_RETRY_MS: 5 };
const call = (url, init) => worker.fetch(new Request("https://x.test" + url, init), env);
let ipN = 0;
const form = (fields, headers = {}) => call("/probar", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": headers.ip || `198.51.100.${++ipN}`, ...headers }, body: new URLSearchParams(fields).toString(), redirect: "manual" });
const text = async (r) => r.text();
const strip = (b) => b.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noScripts = (b) => (b.match(/<script\b[^>]*>/g) || []).every((t) => /\bsrc="\/(rent|app)\.js"/.test(t));
const today = new Date().toISOString().slice(0, 10);

// The page itself, with no JavaScript and no outside payer yet
let r = await call("/probar");
let b = await text(r);
assert.strictEqual(r.status, 200);
assert.ok(r.headers.get("content-security-policy").includes("form-action 'self'"), "CSP unchanged");
assert.ok(noScripts(b), "no inline scripts");
assert.ok(b.includes('<form class="card" id="probar-form" method="post" action="/probar">'), "a plain form, works without JavaScript");
assert.ok(b.includes('data-ssr="/probar"') && b.includes('<html lang="es-AR">'));
assert.ok(strip(b).includes("0 pagadores externos hasta ahora"), "honest zero");
assert.ok(!strip(b).includes("1 pagadores"), "singular is singular");
assert.ok(b.includes('href="/probar?lang=en"'), "English toggle");
const en = await text(await call("/probar?lang=en"));
assert.ok(en.includes(`<html lang="en">`) && strip(en).includes("0 outside payers so far") && en.includes('action="/probar?lang=en"') && en.includes('name="lang" value="en"'));
const evilLang = await text(await call("/probar?lang=%3Cscript%3E"));
assert.ok(evilLang.includes('<html lang="es-AR">') && !evilLang.includes("<script>"), "an unknown language falls back to Spanish");

// Bad input is refused, echoed escaped, and creates nothing
const leases = () => [...kv.keys()].filter((k) => k.startsWith("lease:")).length;
for (const [wallet, status, want] of [
  ["0x123", 422, "no parece válida"],
  ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", 422, "error de tipeo"],
  [AGENT, 422, "dirección del agente"],
  ["0x0000000000000000000000000000000000000001", 422, "no parece válida"],
  ['"><script>alert(1)</script>', 422, "no parece válida"],
]) {
  r = await form({ wallet });
  b = await text(r);
  assert.strictEqual(r.status, status, wallet);
  assert.ok(strip(b).includes(want), `${wallet}: ${want}`);
  assert.ok(!b.includes("<script>alert"), "typed text never becomes markup");
}
assert.ok(b.includes('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'), "the typed value is shown back escaped");
assert.strictEqual(leases(), 0, "no lease from bad input");
assert.strictEqual((await form({ wallet: W.old }, { origin: "https://evil.example" })).status, 403, "other sites cannot post the form");
assert.strictEqual((await call("/probar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: W.old }) })).status, 400);
assert.strictEqual((await call("/probar", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "wallet=" + "a".repeat(3000) })).status, 400, "size cap");
assert.strictEqual(leases(), 0);

// A good address: one fixed 1,000 wARS test lease, landlord = the tester, queued for the agent like any other
const tester = toChecksum(W.old);
r = await form({ wallet: tester });
assert.strictEqual(r.status, 303);
const loc = r.headers.get("location");
const m = loc.match(/^\/probar\/([0-9a-f]{12})#k=([0-9a-f]{32})$/);
assert.ok(m, loc);
const [, id, token] = m;
const rec = JSON.parse(kv.get(`lease:${id}`));
assert.strictEqual(rec.baseRent, 1000, "capped at 1,000 wARS");
assert.strictEqual(rec.sweepBps, 0, "all pesos, no swap");
assert.strictEqual(rec.payout, tester, "the tester is the landlord");
assert.strictEqual(rec.index, "IPC");
assert.strictEqual(rec.periodMonths, 12);
assert.strictEqual(rec.startDate, new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), "starts today in Argentina");
assert.ok(rec.probar === true && !JSON.stringify(rec).includes(token), "the landlord key is not stored");
assert.ok(JSON.parse(kv.get("queue")).leases.includes(id) && kv.get(`pending:${id}`) === "1", "queued for the agent");
assert.deepStrictEqual(JSON.parse(kv.get(`probar:${id}`)).payout, W.old);
// Asking again while unpaid gives the same lease back and uses no limit
r = await form({ wallet: W.old.toUpperCase().replace("0X", "0x") });
assert.strictEqual(r.headers.get("location"), `/probar/${id}`);
assert.strictEqual(leases(), 1);
assert.strictEqual(kv.get(`rl:probar:addr:${W.old}:${today}`), "1");
// English form keeps the language
r = await form({ wallet: W.fresh, lang: "en" });
assert.match(r.headers.get("location"), /^\/probar\/[0-9a-f]{12}\?lang=en#k=[0-9a-f]{32}$/);

// Step 2: preparing, refreshes itself without JavaScript, panel key not in the page
r = await call(`/probar/${id}`);
b = await text(r);
assert.strictEqual(r.status, 200);
assert.strictEqual(r.headers.get("cache-control"), "no-store");
assert.ok(b.includes('<meta name="robots" content="noindex">') && b.includes('<meta http-equiv="refresh" content="20">'));
assert.ok(strip(b).includes("Lo estamos preparando") && b.includes(toChecksum(W.old)) && !b.includes(token));
assert.ok(noScripts(b));
assert.deepStrictEqual(await (await call(`/api/probar/${id}`)).json(), { id, step: 2, phase: "preparing", owed: 1000, receipt: null });
assert.strictEqual((await call("/probar/ffffffffffff")).status, 404);
assert.strictEqual((await call("/api/probar/ffffffffffff")).status, 404);

// Step 3: the agent published the lease and this month's charge
const C = "0xC0110EC70000000000000000000000000000C011";
const month = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const pub = { id, propertyLabel: "Prueba abierta de 1.000 wARS", collector: C, deployed: false, builderTest: false, index: "IPC", periodMonths: 12, sweepBps: 0, closed: false, feeBps: 30,
  current: { month, amount: 1000, dueDate: `${month}-28`, status: "pendiente", received: 0, detail: { month, adjustments: 0, index: "IPC", baseRent: 1000, amount: 1000, pct: 0 } }, history: [{ month, amount: 1000, status: "pendiente" }] };
kv.set(`pub:${id}`, JSON.stringify(pub));
b = await text(await call(`/probar/${id}`));
assert.ok(!b.includes('http-equiv="refresh"'), "no automatic reload while the tester is paying");
assert.ok(strip(b).includes("1.000 wARS") && b.includes(`data-collector="${C}"`) && b.includes('data-owed="1000"') && b.includes(`data-landlord="${W.old}"`));
assert.ok(b.includes(`href="/pagar/${id}"`) && b.includes(`https://celoscan.io/address/${C}`), "the existing tenant payment page and the lease account");
assert.ok(b.includes("app.uniswap.org/swap?chain=celo"), "how to get wARS");
const pay = await text(await call(`/pagar/${id}`));
assert.ok(strip(pay).includes("Prueba abierta de Al Día") && pay.includes(`href="/probar/${id}"`), "the tenant page says it is an open test");
assert.strictEqual((await (await call(`/api/lease/${id}`)).json()).probar, true);
assert.strictEqual((await (await call("/api/lease/" + id)).json()).collector, C);
// paid, waiting for the agent
kv.set(`pub:${id}`, JSON.stringify({ ...pub, current: { ...pub.current, received: 1000 } }));
b = await text(await call(`/probar/${id}`));
assert.ok(strip(b).includes("Recibimos tu pago") && b.includes('http-equiv="refresh"'));
// partial
kv.set(`pub:${id}`, JSON.stringify({ ...pub, current: { ...pub.current, received: 400, status: "parcial" } }));
b = await text(await call(`/probar/${id}`));
assert.ok(strip(b).includes("Recibimos 400 wARS. Falta mandar 600 wARS.") && b.includes('data-owed="600"'));

// Step 4: settled. The payment came straight from the tester's own older wallet: counted.
const PAY = tx(0xbeef01);
collectors[C.toLowerCase()] = [X(9000, Date.UTC(2026, 10, 4, 12) / 1000, W.old, C, WARS, "1000000000000000000000", PAY)];
senders[PAY] = W.old;
const SETTLE = tx(0xbeef02);
kv.set(`pub:${id}`, JSON.stringify({ ...pub, current: { ...pub.current, status: "pagado", received: 1000 }, history: [{ month, amount: 1000, status: "pagado" }] }));
kv.set(`receipt:${id}:${month}`, JSON.stringify({ lease: id, month, amount: 1000, received: 1000, paymentTxs: [PAY], builderTest: false, propertyLabel: "Prueba abierta de 1.000 wARS", index: "IPC", paidAt: "2026-11-04T12:05:00Z", settleTx: SETTLE, receiptHash: tx(0xbeef03), fee: 3, pesoToLandlord: 997, dollarToLandlord: 0, route: "sin conversión", rate: null, detail: pub.current.detail }));
b = await text(await call(`/probar/${id}`));
assert.ok(strip(b).includes("te devolvimos 997 wARS. Comisión de Al Día: 3 wARS.") && b.includes(`href="/recibo/${id}/${month}"`) && b.includes(`celoscan.io/tx/${SETTLE}`));
assert.ok(strip(b).includes("Tu billetera cuenta como pagador externo"), "the tester's own verdict");
const recibo = await text(await call(`/recibo/${id}/${month}`));
assert.ok(strip(recibo).includes("Recibo de una prueba abierta"));
assert.deepStrictEqual((await (await call(`/api/probar/${id}`)).json()).phase, "paid");

// More leases, each settled, one per rule, plus our own builder test
async function settled(payer, sender, wars, opts = {}) {
  const lid = (opts.id || Math.random().toString(16).slice(2, 14).padEnd(12, "0")).slice(0, 12);
  const col = "0x" + lid.padStart(40, "c");
  const t = tx(parseInt(lid, 16));
  collectors[col] = [X(9100, Date.UTC(2026, 10, 4, 13) / 1000, payer, col, WARS, String(BigInt(wars) * 10n ** 18n), t)];
  senders[t] = sender;
  kv.set(`pub:${lid}`, JSON.stringify({ id: lid, collector: col, builderTest: !!opts.builderTest, current: { month, status: "pagado", amount: 1000 }, history: [{ month, amount: 1000, status: "pagado" }] }));
  kv.set(`receipt:${lid}:${month}`, JSON.stringify({ amount: 1000, received: wars, paymentTxs: [t], settleTx: tx(1), builderTest: !!opts.builderTest }));
  return t;
}
const tFunded = await settled(W.fundedByUs, W.fundedByUs, 1000, { id: "aaaaaaaaaa01" });
const tFresh = await settled(W.fresh, W.fresh, 1000, { id: "aaaaaaaaaa02" });
const tIndirect = await settled(W.old, STRANGER, 1000, { id: "aaaaaaaaaa03" }); // a contract or relayer moved the wARS
const tPartial = await settled("0xdddddddddddddddddddddddddddddddddddddddd", "0xdddddddddddddddddddddddddddddddddddddddd", 100, { id: "aaaaaaaaaa04" });
const tOurs = await settled(EXTRA, EXTRA, 1000, { id: "aaaaaaaaaa05" });
const tBroken = await settled(W.broken, W.broken, 1000, { id: "aaaaaaaaaa06" });
const tTest = await settled(LANDLORD, LANDLORD, 1000, { id: "aaaaaaaaaa07", builderTest: true });

// A test lease whose landlord is one of our wallets says so on its own page
r = await form({ wallet: toChecksum(LANDLORD) });
const ourId = r.headers.get("location").match(/\/probar\/([0-9a-f]{12})/)[1];
kv.set(`pub:${ourId}`, JSON.stringify({ ...pub, id: ourId, builderTest: true }));
assert.ok(strip(await text(await call(`/probar/${ourId}`))).includes("Esta es una prueba nuestra"));
kv.delete(`pub:${ourId}`);
const ext = await (await call("/api/externos")).json();
assert.strictEqual(ext.count, 1, "exactly one outside payer: " + JSON.stringify(ext));
assert.strictEqual(ext.payers[0].address, W.old);
assert.strictEqual(ext.payers[0].tx, PAY);
assert.strictEqual(ext.payers[0].firstSeen, "2025-05-01");
const why = Object.fromEntries(ext.notCounted.map((x) => [x.tx, x]));
assert.strictEqual(why[tFunded].reason, "funded-by-us");
assert.strictEqual(why[tFresh].reason, "new-wallet");
assert.strictEqual(why[tIndirect].reason, "indirect");
assert.strictEqual(why[tPartial].reason, "partial");
assert.strictEqual(why[tOurs].reason, "ours");
assert.strictEqual(why[tOurs].address, null, "our other wallets are not published, even when they pay");
assert.strictEqual(why[tBroken].reason, "unchecked", "an explorer failure is never counted");
assert.ok(!why[tTest], "our builder tests stay with our tests, not in the outside list");
assert.strictEqual(ext.complete, false, "a failed check keeps the summary open for a retry");
assert.ok(![...kv.keys()].some((k) => k.startsWith("indep:") && k.endsWith(W.broken)), "a failure is not cached");
assert.ok([...kv.keys()].some((k) => k.startsWith("indep:") && k.endsWith(W.old)), "a verdict is cached");
// cached verdicts and payment rows: the second summary makes no explorer calls for what it already knows
before = calls.length;
await call("/api/externos");
assert.ok(calls.length > before && calls.slice(before).every((c) => c.includes("aaaaaaaaaa06") || c.includes(W.broken)), "only the unchecked payment is asked again: " + JSON.stringify(calls.slice(before)));

// Transparency lists the counted payer with short address, tx link, date and label; our tests stay separate
const tr = await text(await call("/transparencia"));
const trt = strip(tr);
assert.ok(tr.includes('<b>1</b><span class="small muted">pagadores externos verificados</span>') && tr.includes('<b>1</b><span class="small muted">pagos externos verificados</span>'));
assert.ok(tr.includes(`href="https://celoscan.io/address/${W.old}"`) && trt.includes("0x1111…1111") && tr.includes(`href="https://celoscan.io/tx/${PAY}"`));
assert.ok(trt.includes("otro equipo de la hackatón") && trt.includes("4 de noviembre de 2026") && trt.includes("en Celo desde mayo de 2025"));
assert.ok(trt.includes("Pagos que no contamos") && trt.includes("sus primeros fondos vinieron de una billetera nuestra") && trt.includes("Billetera nuestra"));
assert.ok(!tr.includes(EXTRA) && !tr.includes(EXTRA.slice(0, 6) + "…"), "the secret list never reaches a page");
assert.ok(noScripts(tr));
b = await text(await call("/probar"));
assert.ok(strip(b).includes("1 pagador externo hasta ahora"));
const llms = await text(await call("/llms.txt"));
assert.ok(llms.includes("Outside payers so far: 1 (verified payments: 1)") && llms.includes(`https://celoscan.io/tx/${PAY}`) && llms.includes("fellow hackathon builder") && !llms.includes(EXTRA));

// Limits: three test leases a day per address (after each is paid), three per connection, 25 a day in all
for (const n of [1, 2]) {
  const before2 = leases();
  r = await form({ wallet: W.old });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(leases(), before2 + 1);
  const nid = r.headers.get("location").match(/\/probar\/([0-9a-f]{12})/)[1];
  kv.set(`pub:${nid}`, JSON.stringify({ ...pub, id: nid, history: [{ month, amount: 1000, status: "pagado" }] }));
}
r = await form({ wallet: W.old });
assert.strictEqual(r.status, 429, "fourth test lease for one address in a day");
assert.ok(strip(await text(r)).includes("Ya creaste varios"));
const ip = { ip: "203.0.113.77" };
for (const a of ["0x0101010101010101010101010101010101010101", "0x0202020202020202020202020202020202020202", "0x0303030303030303030303030303030303030303"]) assert.strictEqual((await form({ wallet: a }, ip)).status, 303);
r = await form({ wallet: "0x0404040404040404040404040404040404040404" }, ip);
assert.strictEqual(r.status, 429, "fourth test lease from one connection in a day");
assert.strictEqual(kv.get(`rl:probar:addr:0x0404040404040404040404040404040404040404:${today}`), undefined, "a refused try uses no other limit");
kv.set(`count:probar:${today}`, "25");
r = await form({ wallet: "0x0505050505050505050505050505050505050505" });
assert.strictEqual(r.status, 429, "daily cap");
assert.ok(strip(await text(r)).includes("cupo"));

// A tampered summary in KV still cannot become markup or a link
const env2 = { ...env, OUTSIDE_FRESH_MS: 3600e3 };
kv.set("outside:summary", JSON.stringify({ v: 1, checkedAt: new Date().toISOString(), complete: true, count: 9, payments: 9,
  payers: [{ address: "javascript:alert(1)", tx: PAY, date: "2026-11-04" }, { address: W.old, tx: "<b>x</b>", date: "2026-11-04" }, { address: W.old, tx: PAY, date: "<i>", firstSeen: "\"><script>x</script>", id: "<b>", month: "2026-11" }],
  notCounted: [{ address: "<img src=x onerror=alert(1)>", reason: "<script>", tx: "javascript:x" }, { address: "\"onmouseover=\"x", reason: "ours", tx: "javascript:x", date: "<b>" }] }));
const tt = await text(await worker.fetch(new Request("https://x.test/transparencia"), env2));
assert.ok(!tt.includes("javascript:") && !tt.includes("<script>x") && !tt.includes("<img src=x") && !tt.includes("<b>x") && !tt.includes("onmouseover") && !tt.includes('href="/recibo/<b>'), "nothing from the record becomes markup or a link");
assert.ok(tt.includes('<b>1</b><span class="small muted">pagadores externos verificados</span>'), "the count is recomputed from the rows that pass, not taken from the record");
const ej = await (await worker.fetch(new Request("https://x.test/api/externos"), env2)).json();
assert.strictEqual(ej.count, 1);
assert.ok(ej.notCounted.length === 1 && ej.notCounted[0].address === null && ej.notCounted[0].tx === null, "bad rows dropped, bad fields blanked");
// With a request context, a page never waits for the explorer: it shows the stored summary (or zero) and refreshes after.
kv.delete("outside:summary");
const bg = [];
const ctx = { waitUntil: (p) => bg.push(p) };
const first = await worker.fetch(new Request("https://x.test/transparencia"), env, ctx);
assert.ok((await first.text()).includes('<b>0</b><span class="small muted">pagadores externos verificados</span>'), "nothing counted until the check has run");
assert.strictEqual(bg.length, 1, "the check runs after the response");
await Promise.all(bg);
assert.strictEqual(JSON.parse(kv.get("outside:summary")).payers.length, 1, "and stores what it found");
const second = await worker.fetch(new Request("https://x.test/transparencia"), { ...env, OUTSIDE_FRESH_MS: 3600e3 }, ctx);
assert.ok((await second.text()).includes('<b>1</b><span class="small muted">pagadores externos verificados</span>'));
// A slow explorer cannot hold the tester's page: after the time cap it says "still checking" and reloads itself.
const slowEnv = { ...env, JUDGE_MS: 50, FETCH: async (u) => { await new Promise((r) => setTimeout(r, 400)); return fakeFetch(u); } };
for (const k of [...kv.keys()]) if (k.startsWith("indep:") || k.startsWith("payrows:")) kv.delete(k);
const t0 = Date.now();
const slow = await text(await worker.fetch(new Request(`https://x.test/probar/${id}`), slowEnv, { waitUntil: () => {} }));
assert.ok(Date.now() - t0 < 1500, "the page answers within the cap");
assert.ok(strip(slow).includes("Todavía estamos revisando tu billetera") && slow.includes('http-equiv="refresh"'), "still checking, and refreshes itself");
console.log("probar ok");
