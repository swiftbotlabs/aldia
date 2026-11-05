// Offline tests for the calculator use counter (worker/calcstats.js): what counts, what does not, dedupe, the daily write
// cap, and that nothing about a person is stored. Positive controls: the same checks run against copies of the module
// with one guard removed, and each copy must fail the check that guard protects.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, "../worker/calcstats.js"), "utf8");
const calc = await import("../worker/calcstats.js");
const { default: worker } = await import("../worker/worker.js");
const { CALC_SINCE, WRITE_CAP, FIELDS, DEDUPE_MS, RATE_PER_MIN } = calc;

const ORIGIN = "https://x.test";
const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  // tools/nojs_check.py, our no-JavaScript page check, sends exactly this (no minor version after Chrome/130)
  nojsCheck: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  claudeUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  telegramPreview: "TelegramBot (like TwitterBot)",
  curl: "curl/8.5.0",
};
const INPUTS = "alquiler=750000&inicio=2025-06-01&indice=ICL&cada=6";

function fakeKV({ stale = false, failGet = null } = {}) {
  const m = new Map();
  const first = new Map();
  let writes = 0;
  return {
    m,
    writes: () => writes,
    get: async (k) => {
      if (failGet && failGet(k)) throw new Error("kv down");
      if (stale && first.has(k)) return first.get(k); // a location that keeps serving the first value it saw
      return m.has(k) ? m.get(k) : null;
    },
    put: async (k, v) => {
      writes++;
      if (!first.has(k)) first.set(k, m.has(k) ? m.get(k) : null);
      m.set(k, v);
    },
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}
const mkEnv = (KV) => ({ KV, CALC_WRITE_GAP_MS: 0, SSR_CACHE_MS: 0, OUTSIDE_FRESH_MS: 0, AGENT_TOKEN: "t".repeat(64), FETCH: async (u) => { throw new Error("unexpected network call " + u); } });
function rq(url, { ua = UA.chromeAndroid, ip = "203.0.113.7", method = "GET", origin = null, headers = {}, body } = {}) {
  const h = { ...headers };
  if (ua) h["user-agent"] = ua;
  if (ip) h["cf-connecting-ip"] = ip;
  if (origin) h.origin = origin;
  return new Request(ORIGIN + url, { method, headers: h, body });
}
const today = new Date().toISOString().slice(0, 10);
const rec = (KV, d = today) => calc.cleanRecord(KV.m.get(`calcstats:${d}`) || null);

/* ---------- 1. what is a visitor: pure classifier ---------- */
const u = (p) => new URL(ORIGIN + p);
for (const [name, ua] of [["chrome", UA.chromeAndroid], ["safari", UA.safariIos], ["firefox", UA.firefox]]) {
  assert.strictEqual(calc.excluded(rq("/calculadora", { ua }), u("/calculadora"), "page"), null, name + " counts");
  assert.strictEqual(calc.excluded(rq("/api/calc-ping?i=ipc", { ua, method: "POST", origin: ORIGIN }), u("/api/calc-ping?i=ipc"), "ping"), null, name + " ping counts");
}
const why = (p, o = {}, kind = "page") => calc.excluded(rq(p, o), u(p), kind);
assert.strictEqual(why("/calculadora?test=1"), "test");
assert.strictEqual(why(`/calculadora?${INPUTS}&test=1&lang=en`), "test");
assert.strictEqual(why("/api/calc-ping?i=ipc&test=1", { method: "POST", origin: ORIGIN }, "ping"), "test");
assert.strictEqual(why("/calculadora", { ua: UA.nojsCheck }), "our-monitor", "our nojs_check monitor");
for (const k of ["headless", "googlebot", "claudeUser", "telegramPreview", "curl"]) assert.strictEqual(why("/calculadora", { ua: UA[k] }), "not-a-browser", k);
assert.strictEqual(why("/calculadora", { ua: null }), "not-a-browser", "no user agent");
assert.strictEqual(why("/calculadora", { ua: UA.chromeAndroid + "x".repeat(600) }), "not-a-browser", "oversized user agent");
assert.strictEqual(why("/calculadora", { headers: { "sec-purpose": "prefetch;prerender" } }), "prefetch");
assert.strictEqual(why("/calculadora", { headers: { purpose: "prefetch" } }), "prefetch");
assert.strictEqual(why("/calculadora", { method: "HEAD" }), "method");
assert.strictEqual(why("/calculadora?alquiler=500000&inicio=2026-03-01&indice=IPC&cada=4&lang=en"), "published-example", "the llms.txt example link");
assert.strictEqual(why("/calculadora?alquiler=500001&inicio=2026-03-01&indice=IPC&cada=4"), null, "a different rent is a real calculation");
assert.strictEqual(why("/api/calc-ping?i=ipc", { method: "POST" }, "ping"), "origin", "a ping with no Origin");
assert.strictEqual(why("/api/calc-ping?i=ipc", { method: "POST", origin: "https://evil.example" }, "ping"), "origin");
assert.strictEqual(why("/api/calc-ping?i=ipc", { method: "GET", origin: ORIGIN }, "ping"), "method");
console.log("calc classifier ok");

/* ---------- 2. the checks, written once and run against the real module and against mutants (positive controls) ---------- */
const IPS = ["203.0.113.7", "198.51.100.23", "2001:db8::42", "192.0.2.99"];
const sha = (s) => createHash("sha256").update(s).digest("hex");
// Everything about a person that must never reach storage: IPs (raw and hashed), user agent parts, the inputs typed.
const SECRETS = [...IPS, ...IPS.map(sha), ...IPS.map((ip) => sha(ip).slice(0, 32)), "Pixel 7", "Android 13", "Mobile Safari", "iPhone", "750000", "2025-06-01", "ICL&cada"];
export function piiProblems(kvMap, before) {
  const out = [];
  for (const [k, v] of kvMap) {
    if (before.has(k) && before.get(k) === v) continue;
    if (!/^calcstats:\d{4}-\d{2}-\d{2}$/.test(k)) out.push("unexpected key " + k);
    for (const s of SECRETS) if (k.includes(s) || String(v).includes(s)) out.push(`${k} holds ${s}`);
    let o = null;
    try {
      o = JSON.parse(v);
    } catch {
      out.push(k + " is not JSON");
      continue;
    }
    for (const [f, x] of Object.entries(o || {})) {
      if (f === "capped" ? typeof x !== "boolean" : !(FIELDS.includes(f) && Number.isInteger(x) && x >= 0)) out.push(`${k} has field ${f}`);
    }
  }
  return out;
}

async function checks(mod) {
  const failed = [];
  const run = async (name, fn) => {
    mod.resetCalcState();
    try {
      if (!(await fn())) failed.push(name);
    } catch (e) {
      failed.push(name + ": " + e.message);
    }
  };
  const go = async (env, p, o = {}, ev = { kind: "page", lease: null }, now = Date.now()) => {
    const r = await mod.countCalc(rq(p, o), env, u(p), ev, now);
    if (r.done) await r.done;
    return r;
  };
  const lease = { index: "ICL" };
  await run("test-excluded", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    await go(env, `/calculadora?${INPUTS}&test=1`, {}, { kind: "page", lease });
    await go(env, "/calculadora?test=1");
    await go(env, "/api/calc-ping?i=ipc&test=1", { method: "POST", origin: ORIGIN }, { kind: "ping", index: "ipc" });
    const r = rec(KV);
    // never a visitor; tallied apart once per sender per 10 minutes, so the write path is visible
    return r.calcs === 0 && r.views === 0 && r.ipc === 0 && r.icl === 0 && r.form === 0 && r.app === 0 && r.tests === 1;
  });
  await run("monitor-excluded", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    await go(env, "/calculadora", { ua: UA.nojsCheck });
    await go(env, `/calculadora?${INPUTS}`, { ua: UA.nojsCheck }, { kind: "page", lease });
    return rec(KV).views === 0 && rec(KV).calcs === 0;
  });
  await run("bots-excluded", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    for (const k of ["headless", "googlebot", "claudeUser", "curl"]) await go(env, `/calculadora?${INPUTS}`, { ua: UA[k], ip: IPS[1] }, { kind: "page", lease });
    return rec(KV).calcs === 0;
  });
  await run("refresh-deduped", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await go(env, "/calculadora", {}, { kind: "page", lease: null }, t0 + i * 1000);
    for (let i = 0; i < 5; i++) await go(env, `/calculadora?${INPUTS}`, {}, { kind: "page", lease }, t0 + i * 1000);
    // the same visitor's live calculator, same index: the same calculation
    await go(env, "/api/calc-ping?i=icl", { method: "POST", origin: ORIGIN }, { kind: "ping", index: "icl" }, t0 + 6000);
    const a = rec(KV);
    if (!(a.views === 1 && a.calcs === 1 && a.icl === 1 && a.form === 1 && a.app === 0)) return false;
    // after 10 minutes the same visitor counts again
    await go(env, "/calculadora", {}, { kind: "page", lease: null }, t0 + DEDUPE_MS + 1);
    return rec(KV).views === 2;
  });
  await run("counts-visitors", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    await go(env, "/calculadora", { ip: IPS[0] });
    await go(env, "/calculadora", { ip: IPS[1], ua: UA.safariIos });
    await go(env, `/calculadora?${INPUTS}`, { ip: IPS[0] }, { kind: "page", lease });
    await go(env, "/calculadora?alquiler=1&inicio=2024-01-01&indice=IPC&cada=3", { ip: IPS[0] }, { kind: "page", lease: { index: "IPC" } });
    await go(env, "/api/calc-ping?i=fijo", { ip: IPS[2], ua: UA.firefox, method: "POST", origin: ORIGIN }, { kind: "ping", index: "fijo" });
    const r = rec(KV);
    return r.views === 2 && r.calcs === 3 && r.icl === 1 && r.ipc === 1 && r.fijo === 1 && r.form === 2 && r.app === 1;
  });
  await run("no-pii", async () => {
    const KV = fakeKV();
    const env = mkEnv(KV);
    const before = new Map(KV.m);
    let i = 0;
    for (const ip of IPS) {
      for (const ua of [UA.chromeAndroid, UA.safariIos]) {
        await go(env, "/calculadora", { ip, ua });
        await go(env, `/calculadora?${INPUTS}`, { ip, ua }, { kind: "page", lease });
        await go(env, "/api/calc-ping?i=ipc", { ip, ua, method: "POST", origin: ORIGIN }, { kind: "ping", index: "ipc" });
        i++;
      }
    }
    const probs = piiProblems(KV.m, before);
    return probs.length === 0 && rec(KV).calcs > 0 && i === 8;
  });
  return failed;
}

const real = await checks(calc);
assert.deepStrictEqual(real, [], "the real module passes every check: " + real.join("; "));
async function mutant(pairs) {
  let src = SRC;
  for (const [a, b] of pairs) {
    assert.ok(src.includes(a), "mutant anchor missing: " + a);
    src = src.replace(a, b);
  }
  return import("data:text/javascript;base64," + Buffer.from(src + `\n// mutant ${Math.random()}\n`).toString("base64"));
}
const controls = [
  ["test-excluded", [['if (url.searchParams.get("test") === "1") return "test";', ""]]],
  ["monitor-excluded", [['if (OUR_MONITOR_UA.test(ua)) return "our-monitor";', ""]]],
  ["bots-excluded", [["if (ua.length > 512 || !BROWSER_UA.test(ua) || BOT_UA.test(ua)) return \"not-a-browser\";", ""]]],
  ["refresh-deduped", [["if (until && until > now) return false;", ""]]],
  ["no-pii", [["state.pending.set(today, p);", "p.ip = ip; state.pending.set(today, p);"], ["await env.KV.put(KEY(d), JSON.stringify(cur));", "await env.KV.put(KEY(d), JSON.stringify({ ...cur, ...delta }));"]]],
];
for (const [name, pairs] of controls) {
  const failed = await checks(await mutant(pairs));
  assert.ok(failed.some((f) => f.startsWith(name)), `positive control: with that guard removed, "${name}" must fail (got ${JSON.stringify(failed)})`);
  console.log(`positive control ok: guard off -> ${name} fails`);
}
// the PII scanner itself catches a planted IP, a planted user agent and a stray field
for (const planted of [{ views: 1, ip: IPS[0] }, { views: 1, note: UA.chromeAndroid }, { views: 1, who: "x" }]) {
  assert.ok(piiProblems(new Map([[`calcstats:${today}`, JSON.stringify(planted)]]), new Map()).length > 0, "scanner flags " + JSON.stringify(planted));
}
assert.ok(piiProblems(new Map([[`seen:${sha(IPS[0])}`, "1"]]), new Map()).length > 0, "scanner flags a key that holds a hash");
console.log("calc checks ok: real module passes, every mutant fails its check");

/* ---------- 3. limits: rate, daily write cap, clock, KV errors, stale reads, concurrency ---------- */
{
  calc.resetCalcState();
  const KV = fakeKV();
  const env = mkEnv(KV);
  const t = Date.now();
  let counted = 0;
  for (let i = 0; i < RATE_PER_MIN + 5; i++) {
    const r = await calc.countCalc(rq("/calculadora", { ip: `10.0.${i >> 8}.${i & 255}` }), env, u("/calculadora"), { kind: "page", lease: null }, t);
    if (r.done) await r.done;
    counted += r.counted ? 1 : 0;
  }
  assert.strictEqual(counted, RATE_PER_MIN, "at most RATE_PER_MIN events a minute per instance");
  assert.strictEqual(rec(KV).views, RATE_PER_MIN);

  calc.resetCalcState();
  KV.m.set(`calcstats:${today}`, JSON.stringify({ views: 7, calcs: 3, ipc: 3, writes: WRITE_CAP - 1 }));
  const r1 = await calc.countCalc(rq("/calculadora", { ip: IPS[0] }), env, u("/calculadora"), { kind: "page", lease: null });
  await r1.done;
  assert.deepStrictEqual([rec(KV).views, rec(KV).writes, rec(KV).capped], [8, WRITE_CAP, true], "the last allowed write marks the day capped");
  const w = KV.writes();
  const r2 = await calc.countCalc(rq("/calculadora", { ip: IPS[1] }), env, u("/calculadora"), { kind: "page", lease: null });
  await r2.done;
  assert.strictEqual(KV.writes(), w, "a capped day gets no more writes");
  assert.strictEqual(rec(KV).views, 8);
  const st = await calc.calcStats(env);
  assert.deepStrictEqual(st.cappedDays, [today]);

  calc.resetCalcState();
  const r3 = await calc.countCalc(rq("/calculadora"), env, u("/calculadora"), { kind: "page", lease: null }, Date.parse("2026-11-04T23:59:00Z"));
  assert.strictEqual(r3.reason, "clock", "nothing is counted before " + CALC_SINCE);

  // stale reads in this instance never move a count backwards; parallel events in one instance are all kept
  calc.resetCalcState();
  const KS = fakeKV({ stale: true });
  const es = mkEnv(KS);
  const res = await Promise.all(IPS.map((ip) => calc.countCalc(rq("/api/calc-ping?i=ipc", { ip, method: "POST", origin: ORIGIN }), es, u("/api/calc-ping?i=ipc"), { kind: "ping", index: "ipc" })));
  await Promise.all(res.map((r) => r.done));
  for (const ip of ["10.9.9.1", "10.9.9.2"]) {
    const r = await calc.countCalc(rq("/calculadora", { ip }), es, u("/calculadora"), { kind: "page", lease: null });
    await r.done;
  }
  assert.deepStrictEqual([rec(KS).calcs, rec(KS).ipc, rec(KS).app, rec(KS).views], [4, 4, 4, 2], "4 parallel pings and 2 views, despite stale reads");

  // KV down: nothing counted, nothing thrown
  calc.resetCalcState();
  const KD = fakeKV({ failGet: (k) => k.startsWith("calcstats:") });
  const rd = await calc.countCalc(rq("/calculadora"), mkEnv(KD), u("/calculadora"), { kind: "page", lease: null });
  await rd.done;
  assert.strictEqual(KD.writes(), 0, "a failed read writes nothing (counts less, never more)");
  // damaged records print zeros, not junk
  assert.deepStrictEqual(calc.cleanRecord('{"views":"<b>","calcs":-4,"ipc":1.5,"icl":3,"capped":"yes","ip":"1.2.3.4"}'), { views: 0, calcs: 0, ipc: 0, icl: 3, fijo: 0, form: 0, app: 0, tests: 0, writes: 0, capped: false });
  assert.deepStrictEqual(calc.cleanRecord("not json"), calc.cleanRecord(null));

  // a flush the runtime cut off (never settles): after 20 s a new one takes over; before that, counts wait
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [age, wantWritten] of [[1000, false], [21000, true]]) {
    calc.resetCalcState();
    const KF = fakeKV();
    const st0 = calc.calcStateForTests();
    st0.flushing = new Promise(() => {});
    st0.flushStart = Date.now() - age;
    const r = await calc.countCalc(rq("/calculadora", { ip: "10.7.7.7" }), mkEnv(KF), u("/calculadora"), { kind: "page", lease: null });
    await Promise.race([r.done, sleep(50)]);
    assert.strictEqual(rec(KF).views, wantWritten ? 1 : 0, `stuck flush ${age} ms old`);
  }
  // a count left pending is written by the next request, even one that is not counted itself
  calc.resetCalcState();
  const KL = fakeKV();
  calc.calcStateForTests().pending.set(today, { views: 2, calcs: 1, ipc: 1, form: 1 });
  const rl = await calc.countCalc(rq("/calculadora?test=1"), mkEnv(KL), u("/calculadora?test=1"), { kind: "page", lease: null });
  assert.ok(!rl.counted && rl.done, "not counted, but it finishes the pending write");
  await rl.done;
  assert.deepStrictEqual([rec(KL).views, rec(KL).calcs, rec(KL).ipc], [2, 1, 1]);
}
console.log("calc limits ok");

/* ---------- 4. through the Worker: routes, pages, llms.txt ---------- */
const KV = fakeKV();
const env = mkEnv(KV);
const { default: fixtures } = await import("./fixtures_kv.mjs");
for (const [k, v] of Object.entries(fixtures)) if (!k.startsWith("_")) KV.m.set(k, JSON.stringify(v));
const { indices } = JSON.parse(fs.readFileSync(path.join(here, "vectors.json"), "utf8"));
const ipcKeys = Object.keys(indices.ipc).sort();
KV.m.set("indices", JSON.stringify({ ok: true, problems: [], retrievedAt: "2026-11-03T07:14:42Z", ipc: indices.ipc, ipcLast: ipcKeys.at(-1), ipcMonthlyPct: {}, icl: indices.icl }));
const before = new Map(KV.m);
calc.resetCalcState();
const call = (p, o) => worker.fetch(rq(p, o), env);
const stats = async () => (await call("/api/calc-stats")).json();

let s0 = await stats();
assert.deepStrictEqual([s0.since, s0.calculations, s0.pageViews, s0.byIndex, s0.via, s0.testRequests, s0.days, s0.cappedDays], [CALC_SINCE, 0, 0, { ipc: 0, icl: 0, fijo: 0 }, { form: 0, browser: 0 }, 0, [], []], "starts from zero");
const sr = await call("/api/calc-stats");
assert.match(sr.headers.get("content-type"), /^application\/json/);
assert.ok(sr.headers.get("content-security-policy"), "security headers on the JSON");

// our own test traffic: a calculation with inputs and ?test=1 is served normally and not counted
const tpage = await call(`/calculadora?${INPUTS}&test=1`);
assert.strictEqual(tpage.status, 200);
assert.ok((await tpage.text()).includes('id="calc-result"'), "the test request still gets its result");
assert.strictEqual((await call("/api/calc-ping?i=ipc&test=1", { method: "POST", origin: ORIGIN })).status, 204);
assert.strictEqual((await call("/calculadora", { ua: UA.nojsCheck })).status, 200);
assert.strictEqual((await call("/calculadora", { method: "HEAD" })).status, 200);
s0 = await stats();
assert.deepStrictEqual([s0.calculations, s0.pageViews, s0.testRequests], [0, 0, 1], "test traffic, monitors and HEAD leave the count at zero; our test is tallied apart once");
// a test request from another sender is tallied too, and still is no visitor
assert.strictEqual((await call(`/calculadora?${INPUTS}&test=1`, { ip: "192.0.2.200" })).status, 200);
s0 = await stats();
assert.deepStrictEqual([s0.calculations, s0.pageViews, s0.byIndex, s0.via, s0.testRequests], [0, 0, { ipc: 0, icl: 0, fijo: 0 }, { form: 0, browser: 0 }, 2]);

// visitors
assert.strictEqual((await call("/calculadora", { ip: IPS[0] })).status, 200);
assert.strictEqual((await call("/calculadora?lang=en", { ip: IPS[0] })).status, 200, "a refresh in the other language");
assert.strictEqual((await call("/calculadora?lang=en", { ip: IPS[1] })).status, 200);
assert.strictEqual((await call(`/calculadora?${INPUTS}`, { ip: IPS[0] })).status, 200);
assert.strictEqual((await call(`/calculadora?${INPUTS}`, { ip: IPS[0] })).status, 200, "the same form sent twice");
const ping = (i, o = {}) => call(`/api/calc-ping?i=${i}`, { method: "POST", origin: ORIGIN, ...o });
assert.strictEqual((await ping("ipc", { ip: IPS[1] })).status, 204);
assert.strictEqual((await ping("ipc", { ip: IPS[1] })).status, 204, "a second ping from the same visitor");
assert.strictEqual((await ping("fijo", { ip: IPS[2] })).status, 204);
// refused pings: another site, a body, a bad index, extra data
assert.strictEqual((await ping("ipc", { ip: IPS[3], origin: "https://evil.example" })).status, 403);
assert.strictEqual((await ping("ipc", { ip: IPS[3], body: "alquiler=750000", headers: { "content-type": "text/plain" } })).status, 413);
assert.strictEqual((await ping("DOLAR", { ip: IPS[3] })).status, 400);
assert.strictEqual((await call("/api/calc-ping?i=ipc&alquiler=750000", { method: "POST", origin: ORIGIN, ip: IPS[3] })).status, 400);
assert.strictEqual((await call("/api/calc-ping?i=ipc", { ip: IPS[3] })).status, 404, "GET is not a ping");
assert.strictEqual((await ping("ipc", { ip: IPS[3], origin: null })).status, 204, "no Origin: accepted, not counted");
const s1 = await stats();
assert.deepStrictEqual([s1.calculations, s1.pageViews, s1.byIndex, s1.via, s1.testRequests], [3, 2, { ipc: 1, icl: 1, fijo: 1 }, { form: 1, browser: 2 }, 2]);
assert.deepStrictEqual(s1.days, [{ date: today, calculations: 3, pageViews: 2 }]);
assert.deepStrictEqual(piiProblems(KV.m, before), [], "the Worker stored nothing about anyone");

// the line on /transparencia, in both languages, with the same numbers as the JSON
const text = (b) => b.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const tes = await (await call("/transparencia")).text();
const ten = await (await call("/transparencia?lang=en")).text();
assert.ok(tes.includes('<p class="small" id="calc-uso">Calculadora: 3 cálculos de visitantes desde el 5 de noviembre (2 visitas a la página), contados sin guardar IP ni datos ingresados.</p>'), "Spanish line");
assert.ok(ten.includes('<p class="small" id="calc-uso">Calculator: 3 calculations by visitors since 5 Nov (2 page views), counted without storing IPs or inputs.</p>'), "English line");
assert.ok(text(ten).includes("By index: IPC 1, ICL 1, fixed percentage 1.") && ten.includes("salted hash of the IP address that lives 10 minutes in memory and is never written down") && ten.includes('<a href="/api/calc-stats">Daily totals (JSON)</a>'), "the method is stated");
assert.ok(text(tes).includes("Por índice: IPC 1, ICL 1, porcentaje fijo 1.") && tes.includes("nunca se escribe"));
assert.ok(!ten.includes("counting stopped early"), "no capped note when no day is capped");
// viewing /transparencia counts nothing
assert.deepStrictEqual([(await stats()).calculations, (await stats()).pageViews], [3, 2]);
// singular
{
  const K1 = fakeKV();
  K1.m.set(`calcstats:${today}`, JSON.stringify({ views: 1, calcs: 1, ipc: 1, form: 1, writes: 1 }));
  const one = await (await worker.fetch(rq("/transparencia?lang=en"), mkEnv(K1))).text();
  assert.ok(one.includes("Calculator: 1 calculation by visitors since 5 Nov (1 page view), counted without storing IPs or inputs."), "singular EN");
  const uno = await (await worker.fetch(rq("/transparencia"), mkEnv(K1))).text();
  assert.ok(uno.includes("Calculadora: 1 cálculo de visitantes desde el 5 de noviembre (1 visita a la página)"), "singular ES");
  K1.m.set(`calcstats:${today}`, JSON.stringify({ views: 1, calcs: 1, ipc: 1, form: 1, writes: WRITE_CAP, capped: true }));
  assert.ok((await (await worker.fetch(rq("/transparencia?lang=en"), mkEnv(K1))).text()).includes("On 1 day counting stopped early at the daily write limit."), "capped note");
}
// llms.txt carries the same numbers and the JSON link
const llms = await (await call("/llms.txt")).text();
assert.ok(llms.includes(`- Free calculator use since ${CALC_SINCE}: 3 calculations by visitors (2 page views without inputs; IPC 1, ICL 1, fixed 1), counted without storing IPs or inputs`), "llms.txt stats line");
assert.ok(llms.includes(`${ORIGIN}/api/calc-stats`) && llms.includes(`/api/externos , ${ORIGIN}/api/calc-stats`), "llms.txt data list");
// counting can fail without breaking a page
{
  calc.resetCalcState();
  const KD = fakeKV({ failGet: (k) => k.startsWith("calcstats:") });
  for (const [k, v] of KV.m) if (!k.startsWith("calcstats:")) KD.m.set(k, v);
  const ed = mkEnv(KD);
  assert.strictEqual((await worker.fetch(rq(`/calculadora?${INPUTS}`, { ip: "10.1.1.1" }), ed)).status, 200, "calculator up while KV counters fail");
  const tp = await worker.fetch(rq("/transparencia"), ed);
  assert.strictEqual(tp.status, 200);
  assert.ok(!(await tp.text()).includes("uso-calculadora"), "no line rather than a wrong one");
  assert.ok(!(await (await worker.fetch(rq("/llms.txt"), ed)).text()).includes("Free calculator use"));
}
console.log("calc worker ok");

/* ---------- 5. the browser calculator's ping ---------- */
const app = fs.readFileSync(path.join(here, "../web/app.js"), "utf8");
const pingCall = (app.match(/fetch\(`\/api\/calc-ping\?i=\$\{i\}`, (\{[^}]*\})\)/) || [])[1];
assert.ok(pingCall, "app.js sends the ping");
assert.ok(pingCall.includes('method: "POST"') && pingCall.includes("keepalive: true") && pingCall.includes('credentials: "omit"') && !/\bbody\b|headers/.test(pingCall), "no body, no headers, no cookies");
assert.ok(/const CALC_TEST = new URLSearchParams\(location\.search\)\.get\("test"\) === "1";/.test(app) && /if \(CALC_TEST \|\| calcPinged\.has\(i\)/.test(app), "no ping on ?test=1, one per index per page load");
// The live calculator enhances the Worker's form: it computes (and may ping) only on the visitor's own edits or submit,
// never on load, so the result a link's inputs bring is not pinged (the Worker counted that request).
const pingsOnlyOnEdits = (src) => {
  const a = src.indexOf("function calcEnhance()");
  const b = src.indexOf("/* ---------- Home", a);
  if (a < 0 || b < 0) return false;
  const body = src.slice(a, b).replace(/^\s*\/\/.*$/gm, "");
  const listeners = body.includes('form.addEventListener("input", run);') && body.includes('form.addEventListener("change", run);');
  const sub = body.indexOf('form.addEventListener("submit"');
  const subEnd = sub < 0 ? -1 : body.indexOf("\n  });", sub);
  const rest = sub < 0 || subEnd < 0 ? body : body.slice(0, sub) + body.slice(subEnd);
  return listeners && !/\brun\(\s*\)/.test(rest) && !/\bcompute\(\s*\)/.test(rest.replace(/const ok = compute\(\);/, "").replace(/function compute\(\)/, ""));
};
assert.ok(pingsOnlyOnEdits(app), "the result a link's inputs bring on load is not pinged (the Worker counted that request)");
// positive control: a load-time run() is caught
assert.ok(!pingsOnlyOnEdits(app.replace("  conditional();\n  let idx = null;", "  conditional();\n  run();\n  let idx = null;")), "positive control: a run() on load fails the check");
assert.strictEqual((app.match(/calc-ping/g) || []).length, 1, "one ping site");
console.log("calc app ok");
console.log("calc counter ok");
