// Offline tests for the browser arithmetic and the Worker: same vectors as the agent, plus the API with a fake KV.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(here, "../web/rent.js"), "utf8"), sandbox);
const { rentForMonth } = sandbox.AlDiaRent;
const { indices, cases } = JSON.parse(fs.readFileSync(path.join(here, "vectors.json"), "utf8"));
let n = 0;
for (const c of cases) {
  const r = rentForMonth(c.lease, c.month, indices);
  if (c.missing) assert.ok(r.missing, JSON.stringify(c));
  else assert.strictEqual(r.amount, c.amount, JSON.stringify(c));
  n++;
}
console.log(`rent vectors ok: ${n}`);

// Worker with a fake KV and cache
const kv = new Map();
const KV = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, v) => void kv.set(k, v),
  delete: async (k) => void kv.delete(k),
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
};
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url) || null, put: async (r, v) => void store.set(r.url, v) } };
fs.writeFileSync(path.join(here, "../worker/assets.js"), fs.existsSync(path.join(here, "../worker/assets.js")) ? fs.readFileSync(path.join(here, "../worker/assets.js")) : 'export const ASSETS = {"/app.js":{"type":"text/javascript; charset=utf-8","text":"x"}};');
// worker/rent.mjs is generated from web/rent.js by ops/deploy_worker.py --bundle-only; a stale copy would test old arithmetic.
assert.ok(fs.readFileSync(path.join(here, "../worker/rent.mjs"), "utf8").includes(fs.readFileSync(path.join(here, "../web/rent.js"), "utf8")), "run ops/deploy_worker.py --bundle-only first");
const { default: worker, validateLease } = await import("../worker/worker.js");
const pages = await import("../worker/pages.js");
// No test here may reach the network: the outside-payer check gets a fetch that fails loudly.
const env = { KV, AGENT_TOKEN: "t".repeat(64), SSR_CACHE_MS: 0, OUTSIDE_FRESH_MS: 0, FETCH: async (u) => { throw new Error("unexpected network call " + u); } };
const call = (url, init) => worker.fetch(new Request("https://x.test" + url, init), env);
const post = (url, body, headers = {}) => call(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const good = { propertyLabel: "Depto Almagro", tenantLabel: "Martina", baseRent: 500000, startDate: "2026-03-01", dueDay: 10, index: "IPC", periodMonths: 4, lagMonths: 2, fixedPct: 0, sweepBps: 5000, payout: "0x8EE66fcd89e2cb492B9B19B1380D93E792Df9aAa" };

assert.deepStrictEqual(Object.keys(validateLease({}).errors).sort(), ["baseRent", "dueDay", "index", "payout", "periodMonths", "propertyLabel", "startDate", "sweepBps"].sort());
for (const [field, value] of [["baseRent", 999], ["baseRent", 1.5], ["startDate", "2026-02-31"], ["dueDay", 29], ["index", "DOLAR"], ["periodMonths", 5], ["sweepBps", 123], ["payout", "0x123"], ["payout", "0x" + "0".repeat(40)], ["propertyLabel", "x".repeat(61)], ["propertyLabel", "   "]]) {
  const r = validateLease({ ...good, [field]: value });
  assert.ok(r.errors && r.errors[field], `${field}=${value} must be refused`);
}
assert.strictEqual(validateLease({ ...good, propertyLabel: "a‮b\u0000c" }).lease.propertyLabel, "a b c");

assert.strictEqual(validateLease({ ...good, contractRef: ["0123456789abcdef"] }).lease.contractRef, null, "an array must not pass as a reference");
assert.strictEqual(validateLease({ ...good, contractRef: "0123456789abcdef" }).lease.contractRef, "0123456789abcdef");
assert.ok(validateLease({ ...good, payout: "0x" + "0".repeat(39) + "1" }).errors.payout, "reserved low addresses are refused");
assert.ok(validateLease({ ...good, payout: "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b" }).errors.payout, "the agent wallet cannot be a landlord");

const created = await post("/api/leases", good);
assert.strictEqual(created.status, 201);
const { id, token } = await created.json();
assert.match(id, /^[0-9a-f]{12}$/);
assert.ok(!(kv.get(`lease:${id}`) || "").includes(token), "the raw landlord key must not be stored");

assert.strictEqual((await call(`/api/panel/${id}`)).status, 403);
assert.strictEqual((await call(`/api/panel/${id}`, { headers: { "x-aldia-key": "0".repeat(32) } })).status, 403);
assert.strictEqual((await call(`/api/panel/${id}`, { headers: { "x-aldia-key": token } })).status, 200);
const panel = await (await call(`/api/panel/${id}`, { headers: { "x-aldia-key": token } })).json();
assert.ok(!("keyHash" in panel.terms), "the key hash stays private");

assert.strictEqual((await call("/agent/queue")).status, 401);
assert.strictEqual((await call("/agent/queue", { headers: { authorization: "Bearer nope" } })).status, 401);
const q = await (await call("/agent/queue", { headers: { authorization: `Bearer ${env.AGENT_TOKEN}` } })).json();
assert.strictEqual(q.leases.length, 1);
const badPub = await post("/agent/publish", { items: [{ key: "lease:" + id, value: {} }] }, { authorization: `Bearer ${env.AGENT_TOKEN}` });
assert.strictEqual(badPub.status, 400, "the agent API cannot overwrite lease records");

const pubKey = { authorization: `Bearer ${env.AGENT_TOKEN}` };
assert.strictEqual((await post("/agent/publish", { items: [{ key: `pub:${id}`, value: { collector: "0xaaa" } }] }, pubKey)).status, 200);
assert.strictEqual((await post("/agent/publish", { items: [{ key: `pub:${id}`, value: { collector: "0xbbb" } }] }, pubKey)).status, 409, "a collection address is locked once published");
assert.strictEqual((await post("/api/leases", good, { origin: "https://evil.example" })).status, 403);
assert.strictEqual((await post("/api/leer", { text: "corto" })).status, 422);
assert.strictEqual((await post("/api/leer", { text: "x".repeat(30001) })).status, 422);
assert.strictEqual((await call("/api/leases", { method: "POST", body: "{", headers: { "content-type": "application/json" } })).status, 400);
assert.strictEqual((await call("/api/lease/notanid")).status, 404);

// the per-IP limit stops the seventh lease in an hour
let last;
for (let i = 0; i < 7; i++) last = await post("/api/leases", good, { "cf-connecting-ip": "203.0.113.9" });
assert.strictEqual(last.status, 429);
const home = await call("/");
assert.ok(home.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
console.log("worker ok");

// ---------- Pages rendered by the Worker: real content with no JavaScript ----------
const { default: fixtures } = await import("./fixtures_kv.mjs");
for (const [k, v] of Object.entries(fixtures)) if (!k.startsWith("_")) kv.set(k, JSON.stringify(v));
const ipcKeys = Object.keys(indices.ipc).sort();
const ipcMonthlyPct = Object.fromEntries(ipcKeys.slice(1).map((m, i) => [m, Math.round((indices.ipc[m] / indices.ipc[ipcKeys[i]] - 1) * 1000) / 10]));
const idxRecord = { ok: true, problems: [], retrievedAt: "2026-11-03T07:14:42Z", ipc: indices.ipc, ipcLast: ipcKeys.at(-1), ipcMonthlyPct, icl: indices.icl };
kv.set("indices", JSON.stringify(idxRecord));
const NB = " ";
const ars = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const page = async (url) => {
  const r = await call(url);
  return { status: r.status, type: r.headers.get("content-type"), csp: r.headers.get("content-security-policy"), body: await r.text() };
};
const textOf = (body) => body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const meta = (body, name) => (body.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1];
function plainPage(p, wantTitle) {
  assert.strictEqual(p.status, 200);
  assert.match(p.type, /^text\/html/);
  assert.ok(p.csp && p.csp.includes("script-src 'self'") && !p.csp.includes("unsafe-eval"), "CSP unchanged on rendered pages");
  assert.strictEqual((p.body.match(/<title>([^<]*)<\/title>/) || [])[1], wantTitle);
  assert.ok((meta(p.body, "description") || "").length > 40, "a real meta description");
  for (const tag of p.body.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc="\/(rent|app)\.js"/, "no inline scripts");
  assert.ok(!/necesita JavaScript/.test(p.body), "no JavaScript-only shell");
}
const fx = (k) => fixtures[k];
const txLink = (t) => `href="https://celoscan.io/tx/${t}"`;

// Transparency: counts, indices, onchain identity, every test rent with its transactions, paid calls
const tr = await page("/transparencia");
plainPage(tr, "Transparencia · Al Día");
const st = fx("stats");
// The agent's raw "not our wallet" counts are not shown: only payers that passed the independence check (none here).
for (const [n, label] of [[0, "pagadores externos verificados"], [0, "pagos externos verificados"], [st.leasesTest, "contratos de prueba nuestros"], [st.paymentsTest, "pagos de prueba nuestros"]]) {
  assert.ok(tr.body.includes(`<b>${n}</b><span class="small muted">${label}</span>`), label);
}
assert.ok(tr.body.includes('href="https://8004scan.io/agents/celo/10014"') && tr.body.includes("celoscan.io/address/0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"));
for (const id of ["3c9a8784b63e", "74414e7210ef", "8650326827d3", "0b069750a07b"]) {
  const r = fx(`receipt:${id}:2026-11`);
  assert.ok(tr.body.includes(txLink(r.settleTx)), "settlement " + id);
  for (const t of [...r.paymentTxs, ...(r.paymentTxsLate || [])]) assert.ok(tr.body.includes(txLink(t)), "payment " + id);
  assert.ok(tr.body.includes(`href="/recibo/${id}/2026-11"`));
  assert.ok(tr.body.includes(`celoscan.io/address/${fx("pub:" + id).collector}`));
}
for (const c of st.paidCalls.recent) assert.ok(tr.body.includes(txLink(c.tx)));
assert.ok(textOf(tr.body).includes(`${st.paidCalls.count} llamadas pagas por x402 en Celo`));
assert.ok(textOf(tr.body).includes(`Último IPC ${new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(idxRecord.ipcLast + "-15T00:00:00Z"))}`));
assert.match(meta(tr.body, "description"), /Pagadores externos verificados: 0\. Pagos externos verificados: 0\. Pruebas nuestras: 5 contratos y 4 pagos\./);
assert.ok(tr.body.includes('id="externos"') && textOf(tr.body).includes("Todavía ninguno.") && tr.body.includes('href="/probar"'), "outside-payer section, honest zero, link to the open test");

// Sample tenant page: amount, status, due date, why, how to pay
const tenant = fx("pub:c658d0b11729");
const pay = await page("/pagar/c658d0b11729");
plainPage(pay, `Alquiler de noviembre · ${tenant.propertyLabel} · Al Día`);
assert.ok(pay.body.includes(`<div class="amount">${ars(tenant.current.amount)}</div>`) && ars(tenant.current.amount) === `$${NB}660.978`);
const payText = textOf(pay.body);
for (const want of ["Pendiente", "Vence el 10 de noviembre.", "¿Por qué este monto?", "Aumento acumulado +20,18 %", "Último aumento +7,81 %", "Meses de IPC usados junio, julio, agosto, septiembre 2026", "Próximo aumento: marzo de 2027.", "coincide", "Este es un contrato de prueba"]) {
  assert.ok(payText.includes(want), "tenant page shows: " + want);
}
assert.ok(pay.body.includes(`href="https://ramp.ripio.com/?country=AR&amp;chain=42220&amp;token=WARS&amp;amount=660978&amp;address=${tenant.collector}"`));
assert.ok(pay.body.includes(txLink(tenant.current.clauseCheck.tx)), "the paid clause audit is linked");
assert.ok(pay.body.includes('data-ssr="/pagar/c658d0b11729"'));

// Sample receipt
const rec = fx("receipt:8650326827d3:2026-11");
const rp = await page("/recibo/8650326827d3/2026-11");
plainPage(rp, `Recibo de noviembre de 2026 · ${rec.propertyLabel} · Al Día`);
const rpText = textOf(rp.body);
for (const want of [`Alquiler del mes $ 1.859`, "Cobrado el 1 de noviembre", "Comisión Al Día $ 5", "Al propietario en dólares US$ 1,12", "Tipo de cambio $ 1.647,67 por USD₮", "Convertido en Textile FX", "ICL usado 30,03 → 37,21", rec.receiptHash]) {
  assert.ok(rpText.replaceAll(NB, " ").includes(want), "receipt shows: " + want);
}
assert.ok(rp.body.includes(txLink(rec.settleTx)) && rp.body.includes(txLink(rec.paymentTxs[0])));
assert.match(meta(rp.body, "description"), /Cobrado \$.1\.859 el 1 de noviembre\. Al propietario: \$.0 y US\$ 1,12 vía Textile FX\./);

// Calculator: worked example recomputed with rent.js from the official series, equal to what the agent charged
const calc = await page("/calculadora");
plainPage(calc, "Calculadora de aumento de alquiler · Al Día");
const terms = sandbox.AlDiaRent.termsFromDetail(tenant.current.detail, tenant.periodMonths);
assert.deepStrictEqual(JSON.parse(JSON.stringify(terms)), { baseRent: 550000, startDate: "2026-03-01", index: "IPC", periodMonths: 4, lagMonths: 2, fixedPct: 0 }, "terms rebuilt from the published detail");
const exR = rentForMonth(terms, tenant.current.detail.month, indices);
assert.strictEqual(exR.amount, tenant.current.amount, "the calculator's arithmetic gives the agent's amount");
const calcText = textOf(calc.body).replaceAll(NB, " ");
for (const want of ["Ejemplo resuelto", "IPC de septiembre de 2026: 12.514,1508", "IPC de enero de 2026: 10.413,0309", "12.514,1508 ÷ 10.413,0309 = 1,201778", "$ 550.000 × 1,201778 = $ 660.978", "El agente cobró $ 660.978 en ese contrato: coincide."]) {
  assert.ok(calcText.includes(want), "worked example shows: " + want);
}
assert.ok(calc.body.includes('<form class="card" id="calc" method="get" action="/calculadora">'), "the form works without JavaScript");
assert.match(meta(calc.body, "description"), /Ejemplo resuelto: \$.550\.000 desde marzo de 2026 con IPC cada 4 meses da \$.660\.978 en noviembre de 2026\./);
// a GET-form calculation, same arithmetic as the live calculator
const nowM = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const qp = await page("/calculadora?alquiler=500.000&inicio=2025-01-01&indice=ICL&cada=6");
const qr = rentForMonth({ baseRent: 500000, startDate: "2025-01-01", index: "ICL", periodMonths: 6, lagMonths: 2, fixedPct: 0 }, nowM, indices);
assert.ok(qr.missing ? textOf(qp.body).includes("Todavía no se publicó") : qp.body.includes(`<div class="amount">${ars(qr.amount)}</div>`), "query calculation");
assert.ok(qp.body.includes('value="500.000"') && qp.body.includes('<option value="ICL" selected>') && qp.body.includes('<option value="6" selected>'));
const fq = await page("/calculadora?alquiler=100000&inicio=2026-01-01&indice=FIJO&cada=1&pct=10");
const fr = rentForMonth({ baseRent: 100000, startDate: "2026-01-01", index: "FIJO", periodMonths: 1, lagMonths: 2, fixedPct: 10 }, nowM, indices);
assert.ok(fq.body.includes(`<div class="amount">${ars(fr.amount)}</div>`), "fixed-percent calculation");
// hostile query strings are escaped and refused
const evil = await page("/calculadora?alquiler=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&inicio=2026-02-31&indice=%3Cb%3E&cada=99&meses=7&pct=%22onx=1");
assert.strictEqual(evil.status, 200);
assert.ok(!evil.body.includes("<script>alert") && !evil.body.includes('"onx=1') && !evil.body.includes('<option value="<b>'), "query text cannot become markup");
assert.ok(evil.body.includes('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/"') && evil.body.includes('value="&quot;onx=1"'), "reflected text is escaped and capped");
assert.ok(!evil.body.includes('<div class="amount">'), "an impossible date gives no result");

// Home, new lease and the private panel
plainPage(await page("/"), "Al Día · El alquiler que se actualiza y se cobra solo");
const nuevo = await page("/nuevo");
plainPage(nuevo, "Cargar contrato · Al Día");
const panel2 = await page(`/panel/${id}`);
plainPage(panel2, "Tu contrato · Al Día");
assert.ok(panel2.body.includes('<meta name="robots" content="noindex">') && !panel2.body.includes("Depto Almagro") && !panel2.body.includes(good.payout), "the panel page shows nothing private");

// Not found is a real 404
for (const u of ["/no-existe", "/pagar/ffffffffffff", "/recibo/ffffffffffff/2026-11", "/recibo/8650326827d3/2026-13", "/pagar/C658D0B11729"]) {
  const p = await page(u);
  assert.strictEqual(p.status, 404, u);
  assert.ok(p.body.includes('<meta name="robots" content="noindex">'), u);
}
const redirect = await call("/index.html");
assert.strictEqual(redirect.status, 301);
assert.strictEqual(redirect.headers.get("location"), "/");

// Stored text from a stranger cannot become markup or a link
kv.set("pub:abcdefabcdef", JSON.stringify({ id: "abcdefabcdef", propertyLabel: '<img src=x onerror=alert(1)>"\'', collector: "javascript:alert(1)", builderTest: false,
  current: { month: "2026-11", amount: 1000, dueDate: "2026-11-10\"><b>x", status: "<i>pendiente</i>", received: 0, detail: { index: "IPC", adjustments: 1, monthsUsed: ["<b>"], baseRent: "<u>", pct: "1" }, clauseCheck: { ok: false, note: "<script>x</script>", tx: "javascript:alert(1)" } },
  history: [{ month: "<b>", amount: 1, status: "pagado" }], nextAdjustment: "<b>" }));
const bad = await page("/pagar/abcdefabcdef");
assert.strictEqual(bad.status, 200);
assert.ok(!bad.body.includes("<img src=x") && bad.body.includes("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;"), "label escaped");
assert.ok(!bad.body.includes("javascript:") && !bad.body.includes("<script>x") && !bad.body.includes("<i>pendiente") && !bad.body.includes("<b>") && !bad.body.includes("<u>"), "nothing from the record becomes markup or a link");
kv.set("receipt:abcdefabcdef:2026-11", JSON.stringify({ propertyLabel: "</title><script>x</script>", received: "x", paymentTxs: ["javascript:alert(1)", 5], settleTx: "0x12", receiptHash: "<b>h</b>", paidAt: "<b>", detail: null }));
const badRec = await page("/recibo/abcdefabcdef/2026-11");
assert.strictEqual(badRec.status, 200);
assert.ok(!badRec.body.includes("<script>x") && !badRec.body.includes("javascript:") && !badRec.body.includes("<b>h") && !badRec.body.includes("celoscan.io/tx/0x12\""), "receipt fields escaped, bad hashes not linked");

// /llms.txt: plain text with the proof, from the same records
const llms = await call("/llms.txt");
assert.strictEqual(llms.status, 200);
assert.match(llms.headers.get("content-type"), /^text\/plain; charset=utf-8/);
const lt = await llms.text();
assert.ok(lt.startsWith("# Al Día\n") && !/<html|<script|<div/i.test(lt));
for (const want of [pages.ONCHAIN.agentWallet, pages.ONCHAIN.factory, pages.ONCHAIN.implementation, pages.ONCHAIN.identityTx, pages.ONCHAIN.tag, "https://x.test/transparencia", "https://x.test/pagar/c658d0b11729", "https://x.test/recibo/8650326827d3/2026-11", "https://x.test/calculadora", "Outside payers so far: 0 (verified payments: 0).", "https://x.test/probar?lang=en", "550000 x 1.201778 = 660978 pesos. The agent charged 660978 pesos on that lease (they match)."]) {
  assert.ok(lt.includes(want), "llms.txt has " + want);
}
for (const id of ["3c9a8784b63e", "74414e7210ef", "8650326827d3", "0b069750a07b"]) {
  const r = fx(`receipt:${id}:2026-11`);
  assert.ok(lt.includes(`settlement: https://celoscan.io/tx/${r.settleTx}`) && [...r.paymentTxs, ...(r.paymentTxsLate || [])].every((t) => lt.includes(`payment: https://celoscan.io/tx/${t}`)), id);
}
for (const c of st.paidCalls.recent) assert.ok(lt.includes(`https://celoscan.io/tx/${c.tx}`));
const pr = await (await call("/api/pruebas")).json();
assert.strictEqual(pr.length, 4);
assert.ok(pr.every((x) => /^0x[0-9a-f]{64}$/i.test(x.settleTx) && x.paymentTxs.length === 1));

// Every hard-coded address and link the pages print is the one the README already publishes
const readme = fs.readFileSync(path.join(here, "../README.md"), "utf8");
for (const v of [pages.ONCHAIN.agentWallet, pages.ONCHAIN.identityTx, pages.ONCHAIN.factory, pages.ONCHAIN.implementation, pages.ONCHAIN.oldFactory, pages.ONCHAIN.tag, pages.LINKS.video, pages.LINKS.erc8004,
  `/pagar/${pages.SAMPLE_TENANT}`, `/recibo/${pages.SAMPLE_RECEIPT.id}/${pages.SAMPLE_RECEIPT.month}`]) {
  assert.ok(readme.includes(v), "README has " + v);
}
assert.ok(fs.readFileSync(path.join(here, "../web/app.js"), "utf8").includes(pages.LINKS.repo), "same repository link in both renderers");
assert.ok(fs.readFileSync(path.join(here, "../web/app.js"), "utf8").includes(`SAMPLE_TENANT = "${pages.SAMPLE_TENANT}"`), "same worked example in both renderers");
console.log("pages ok");
