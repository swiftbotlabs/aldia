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
fs.writeFileSync(path.join(here, "../worker/assets.js"), fs.existsSync(path.join(here, "../worker/assets.js")) ? fs.readFileSync(path.join(here, "../worker/assets.js")) : 'export const ASSETS = {"/index.html":{"type":"text/html","text":"x"}};');
const { default: worker, validateLease } = await import("../worker/worker.js");
const env = { KV, AGENT_TOKEN: "t".repeat(64) };
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
