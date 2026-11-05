// Al Día public site and API on Cloudflare Workers. Holds no keys and moves no money: it stores what people type and
// shows what the agent publishes. The agent runs elsewhere and reaches this Worker over outbound HTTPS only.
import { ASSETS } from "./assets.js";
import { renderPage, renderLlms, testRents, probarId, cleanOutside, calcInput } from "./pages.js";
import { renderProbar, probarApi, probarTerms, LIMITS as PROBAR_LIMITS } from "./probar.js";
import { outsideSummary, RAMP_WALLETS, RAMP_TOLERANCE_PCT } from "./outside.js";
import { checksumOk } from "./eip55.js";
import { countCalc, calcStats, INDEX_TYPES } from "./calcstats.js";

const MAX_BODY = 40_000;
const AGENT_WALLET = "0xed120aec2240a25125b3f32eb8bff9c5f688121b";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "worker-src blob: https://cdnjs.cloudflare.com",
  "connect-src 'self' https://forno.celo.org https://cdnjs.cloudflare.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");
const SECURITY = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
};
const AGENT_KEYS = /^(pub:|panel:|receipt:|readres:|stats$|indices$|health$)/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...SECURITY, ...extra } });
}
function fail(status, code, message) {
  return json({ error: code, message }, status);
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function randomId(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Per-colo counter in the Cache API: cheap, no KV write per request. The global caps below are the hard limit.
async function rateLimited(req, bucket, limit, seconds) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const key = new Request(`https://rate.invalid/${bucket}/${await sha256Hex(ip)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (n >= limit) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { "cache-control": `max-age=${seconds}` } }));
  return false;
}
async function dailyCap(env, name, limit) {
  const key = `count:${name}:${new Date().toISOString().slice(0, 10)}`;
  const n = parseInt((await env.KV.get(key)) || "0", 10);
  if (n >= limit) return true;
  await env.KV.put(key, String(n + 1), { expirationTtl: 172800 });
  return false;
}

async function readJson(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) return null;
  return s;
}

export function validateLease(b, today = new Date()) {
  const errors = {};
  const propertyLabel = cleanText(b.propertyLabel, 60);
  if (!propertyLabel) errors.propertyLabel = "Poné un nombre corto para la propiedad.";
  const tenantLabel = b.tenantLabel === undefined || b.tenantLabel === "" ? "" : cleanText(b.tenantLabel, 40);
  if (tenantLabel === null) errors.tenantLabel = "El nombre es demasiado largo.";
  const baseRent = Number(b.baseRent);
  if (!Number.isInteger(baseRent) || baseRent < 1000 || baseRent > 100_000_000) {
    errors.baseRent = "El alquiler tiene que estar entre $ 1.000 y $ 100.000.000.";
  }
  const startDate = String(b.startDate || "");
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(startDate + "T00:00:00Z") : null;
  const maxStart = new Date(today.getTime() + 62 * 86400000);
  if (!parsed || isNaN(parsed) || parsed.toISOString().slice(0, 10) !== startDate || startDate < "2021-06-01" || parsed > maxStart) {
    errors.startDate = "Revisá la fecha de inicio del contrato.";
  }
  const dueDay = Number(b.dueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) errors.dueDay = "Elegí un día entre 1 y 28.";
  const index = b.index;
  if (!["IPC", "ICL", "FIJO"].includes(index)) errors.index = "Elegí un índice.";
  const periodMonths = Number(b.periodMonths);
  if (![1, 2, 3, 4, 6, 12].includes(periodMonths)) errors.periodMonths = "Elegí cada cuántos meses aumenta.";
  const lagMonths = b.lagMonths === undefined ? 2 : Number(b.lagMonths);
  if (![1, 2].includes(lagMonths)) errors.lagMonths = "Valor inválido.";
  const fixedPct = index === "FIJO" ? Number(b.fixedPct) : 0;
  if (index === "FIJO" && !(fixedPct > 0 && fixedPct <= 100)) errors.fixedPct = "Poné un porcentaje entre 0 y 100.";
  const sweepBps = Number(b.sweepBps);
  if (!Number.isInteger(sweepBps) || sweepBps < 0 || sweepBps > 10000 || sweepBps % 500 !== 0) errors.sweepBps = "Valor inválido.";
  const payout = String(b.payout || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payout) || /^0x0{36}/.test(payout)) {
    errors.payout = "Esa dirección no parece válida. Tiene que empezar con 0x y tener 42 caracteres.";
  } else if (payout.toLowerCase() === AGENT_WALLET) {
    errors.payout = "Esa es la dirección del agente de Al Día. Poné la de tu billetera.";
  }
  const contractRef = typeof b.contractRef === "string" && /^[0-9a-f]{16}$/.test(b.contractRef) ? b.contractRef : null;
  if (Object.keys(errors).length) return { errors };
  return {
    lease: { propertyLabel, tenantLabel, baseRent, startDate, dueDay, index, periodMonths, lagMonths, fixedPct, sweepBps, payout, contractRef },
  };
}

// One lease record, the agent's queue entry and its pending marker: the same path for /nuevo and for /probar.
async function storeLease(env, lease) {
  const id = randomId(6);
  const token = randomId(16);
  const record = { ...lease, id, createdAt: new Date().toISOString(), keyHash: await sha256Hex(token) };
  await env.KV.put(`lease:${id}`, JSON.stringify(record));
  await env.KV.put(`pending:${id}`, "1");
  await enqueue(env, "leases", id);
  return { id, token, createdAt: record.createdAt };
}

async function createLease(req, env) {
  const body = await readJson(req);
  if (!body) return fail(400, "bad_json", "No pudimos leer los datos.");
  const { lease, errors } = validateLease(body);
  if (errors) return json({ error: "invalid", fields: errors }, 422);
  if (await rateLimited(req, "lease", 6, 3600)) return fail(429, "slow_down", "Demasiados intentos. Probá en un rato.");
  if (await dailyCap(env, "lease", 150)) return fail(429, "cap", "Llegamos al cupo de hoy. Probá mañana.");
  const { id, token } = await storeLease(env, lease);
  return json({ id, token }, 201);
}

// Counters in KV (the Cache API may not hold state on workers.dev). All are read first and bumped only when every one
// still has room, so a refused try never uses up another limit.
async function kvLimits(env, checks) {
  const vals = await Promise.all(checks.map(([key]) => env.KV.get(key)));
  const n = vals.map((v) => parseInt(v || "0", 10) || 0);
  const over = checks.findIndex(([, limit], i) => n[i] >= limit);
  if (over >= 0) return checks[over][2];
  await Promise.all(checks.map(([key], i) => env.KV.put(key, String(n[i] + 1), { expirationTtl: 172800 })));
  return null;
}

async function probarPage(url, env, ctx, status, error, value) {
  const page = await renderProbar(url, env, ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null, { error, value, status });
  return new Response(page.html, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY } });
}

// POST /probar: a plain HTML form, so it works without JavaScript. Creates a 1,000 wARS test lease whose landlord is the
// address typed in, then sends the browser to its page. The landlord key travels only in the URL fragment.
async function createProbar(req, env, ctx, url) {
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return probarPage(url, env, ctx, 403, "origin", "");
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (len > 2000 || !type.startsWith("application/x-www-form-urlencoded")) return probarPage(url, env, ctx, 400, "form", "");
  const text = await req.text();
  if (text.length > 2000) return probarPage(url, env, ctx, 400, "form", "");
  const form = new URLSearchParams(text);
  const lang = form.get("lang") === "en" || url.searchParams.get("lang") === "en" ? "en" : "es";
  const view = new URL(url.origin + "/probar" + (lang === "en" ? "?lang=en" : ""));
  const wallet = String(form.get("wallet") || "").trim().slice(0, 100);
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || /^0x0{36}/.test(wallet)) return probarPage(view, env, ctx, 422, "format", wallet);
  if (!checksumOk(wallet)) return probarPage(view, env, ctx, 422, "checksum", wallet);
  if (wallet.toLowerCase() === AGENT_WALLET) return probarPage(view, env, ctx, 422, "agent", wallet);
  const { lease, errors } = validateLease(probarTerms(wallet));
  if (errors) return probarPage(view, env, ctx, 422, "format", wallet);
  const addr = wallet.toLowerCase();
  const go = (id, token) => new Response(null, { status: 303, headers: { location: `/probar/${id}${lang === "en" ? "?lang=en" : ""}${token ? `#k=${token}` : ""}`, "cache-control": "no-store", ...SECURITY } });
  // The same address with a recent test lease that is not settled yet gets that one back: nothing new, no limit used.
  const prev = await env.KV.get(`probar:addr:${addr}`).then((v) => (v ? JSON.parse(v) : null)).catch(() => null);
  if (prev && /^[0-9a-f]{12}$/.test(prev.id) && Date.now() - Date.parse(prev.createdAt) < 7 * 86400e3) {
    const pub = await env.KV.get(`pub:${prev.id}`).then((v) => (v ? JSON.parse(v) : null)).catch(() => null);
    const paid = pub && Array.isArray(pub.history) && pub.history.some((x) => x && x.status === "pagado");
    if (!paid) return go(prev.id, null);   // still open, or paid and waiting for the agent: the same lease
  }
  const today = new Date().toISOString().slice(0, 10);
  const ip = await sha256Hex("probar:" + (req.headers.get("cf-connecting-ip") || "unknown"));
  const over = await kvLimits(env, [
    [`rl:probar:addr:${addr}:${today}`, PROBAR_LIMITS.perAddress, "limit"],
    [`rl:probar:ip:${ip.slice(0, 32)}:${today}`, PROBAR_LIMITS.perIp, "limit"],
    [`count:probar:${today}`, PROBAR_LIMITS.perDay, "cap"],
  ]);
  if (over) return probarPage(view, env, ctx, 429, over, wallet);
  if (await dailyCap(env, "lease", 150)) return probarPage(view, env, ctx, 429, "cap", wallet);
  const { id, token, createdAt } = await storeLease(env, { ...lease, probar: true });
  await env.KV.put(`probar:${id}`, JSON.stringify({ id, payout: addr, createdAt, month: lease.startDate.slice(0, 7) }));
  await env.KV.put(`probar:addr:${addr}`, JSON.stringify({ id, createdAt }));
  return go(id, token);
}

async function enqueue(env, field, id) {
  const q = JSON.parse((await env.KV.get("queue")) || '{"leases":[],"reads":[]}');
  if (!q[field].includes(id)) q[field].push(id);
  await env.KV.put("queue", JSON.stringify(q));
}

async function createRead(req, env) {
  const body = await readJson(req);
  const text = body && typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 200) return fail(422, "too_short", "No encontramos texto suficiente en ese archivo.");
  if (text.length > 30000) return fail(422, "too_long", "El texto es demasiado largo. Pegá solo las cláusulas del precio y el plazo.");
  if (await rateLimited(req, "read", 3, 86400)) return fail(429, "slow_down", "Ya leímos varios contratos desde acá hoy. Cargalo a mano.");
  if (await dailyCap(env, "read", 15)) return fail(429, "cap", "Por hoy no leemos más contratos. Cargalo a mano.");
  const rid = randomId(8);
  await env.KV.put(`read:${rid}`, text, { expirationTtl: 3600 });
  await enqueue(env, "reads", rid);
  return json({ rid }, 202);
}

async function agentApi(req, env, path) {
  const auth = req.headers.get("authorization") || "";
  const want = `Bearer ${env.AGENT_TOKEN || ""}`;
  if (!env.AGENT_TOKEN || !sameHex(await sha256Hex(auth), await sha256Hex(want))) return fail(401, "unauthorized", "no");
  if (path === "/agent/queue" && req.method === "GET") {
    const q = JSON.parse((await env.KV.get("queue")) || '{"leases":[],"reads":[]}');
    const leases = [];
    for (const id of q.leases) {
      const raw = await env.KV.get(`lease:${id}`);
      if (raw) leases.push(JSON.parse(raw));
    }
    const reads = [];
    for (const rid of q.reads) {
      const text = await env.KV.get(`read:${rid}`);
      if (text) reads.push({ rid, text });
    }
    return json({ leases, reads });
  }
  if (path === "/agent/pending" && req.method === "GET") {
    const list = await env.KV.list({ prefix: "pending:" });
    return json({ ids: list.keys.map((k) => k.name.slice(8)) });
  }
  if (path === "/agent/lease" && req.method === "GET") {
    const raw = await env.KV.get(`lease:${new URL(req.url).searchParams.get("id")}`);
    return raw ? json(JSON.parse(raw)) : fail(404, "not_found", "no");
  }
  if (path === "/agent/ack" && req.method === "POST") {
    const b = await readJson(req);
    if (!b) return fail(400, "bad_json", "no");
    const q = JSON.parse((await env.KV.get("queue")) || '{"leases":[],"reads":[]}');
    q.leases = q.leases.filter((x) => !(b.leases || []).includes(x));
    q.reads = q.reads.filter((x) => !(b.reads || []).includes(x));
    await env.KV.put("queue", JSON.stringify(q));
    for (const id of b.leases || []) await env.KV.delete(`pending:${id}`);
    for (const rid of b.reads || []) await env.KV.delete(`read:${rid}`);
    return json({ ok: true });
  }
  if (path === "/agent/publish" && req.method === "POST") {
    const len = parseInt(req.headers.get("content-length") || "0", 10);
    if (len > 2_000_000) return fail(413, "too_big", "no");
    const b = JSON.parse(await req.text());
    for (const it of b.items || []) {
      if (typeof it.key !== "string" || !AGENT_KEYS.test(it.key)) return fail(400, "bad_key", it.key);
      // A lease's collection address never changes once published, so this token can't redirect tenants' rent.
      if (it.key.startsWith("pub:")) {
        const old = await env.KV.get(it.key);
        if (old && it.value && JSON.parse(old).collector !== it.value.collector) return fail(409, "collector_locked", it.key);
      }
      await env.KV.put(it.key, JSON.stringify(it.value), it.ttl ? { expirationTtl: it.ttl } : undefined);
    }
    return json({ ok: true });
  }
  return fail(404, "not_found", "no");
}

// Counting calculator use must never slow or break a page: the KV write runs after the response when it can.
async function countUse(req, env, url, ev, ctx) {
  try {
    const c = await countCalc(req, env, url, ev);
    if (c.done) {
      if (ctx && ctx.waitUntil) ctx.waitUntil(c.done);
      else await c.done;
    }
  } catch (e) {
    console.log("calcstats", String(e).slice(0, 120));
  }
}

// POST /api/calc-ping?i=ipc|icl|fijo from the live calculator: no body, no cookies, only the index type.
// True when a request carries any body bytes, whatever its headers say. Reads at most a few chunks, then stops.
async function hasBody(req) {
  const len = req.headers.get("content-length");
  if (len !== null && len !== "0") return true;
  if (!req.body) return false;
  const reader = req.body.getReader();
  try {
    for (let i = 0; i < 4; i++) {
      const { value, done } = await reader.read();
      if (done) return false;
      if (value && value.byteLength > 0) return true;
    }
    return true;
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function calcPing(req, env, url, ctx) {
  if (await hasBody(req)) return fail(413, "no_body", "no");
  const i = url.searchParams.get("i");
  if (!INDEX_TYPES.includes(i) || [...url.searchParams.keys()].some((k) => k !== "i" && k !== "test")) return fail(400, "index", "no");
  await countUse(req, env, url, { kind: "ping", index: i }, ctx);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", ...SECURITY } });
}

async function kvJson(env, key, fallback = null) {
  const raw = await env.KV.get(key);
  return raw ? json(JSON.parse(raw)) : fallback;
}

async function api(req, env, path, ctx) {
  if (req.method === "POST") {
    // Writes come from our own pages. This is not authentication, but it stops other sites from spending the daily caps.
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return fail(403, "origin", "no");
  }
  if (path === "/api/leases" && req.method === "POST") return createLease(req, env);
  if (path === "/api/leer" && req.method === "POST") return createRead(req, env);
  if (path === "/api/calc-ping" && req.method === "POST") return calcPing(req, env, new URL(req.url), ctx);
  if (req.method !== "GET") return fail(405, "method", "no");
  if (path === "/api/calc-stats") return json(await calcStats(env), 200, { "cache-control": "public, max-age=60" });
  if (path === "/api/indices") return (await kvJson(env, "indices")) || fail(503, "not_ready", "Todavía no hay índices.");
  if (path === "/api/stats") return (await kvJson(env, "stats")) || json({});
  if (path === "/api/health") return (await kvJson(env, "health")) || json({});
  if (path === "/api/pruebas") return json(await testRents(env));
  if (path === "/api/externos") {
    const o = cleanOutside(await outsideSummary(env, ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null));
    return json({ ...o, rule: { cutoff: "2026-10-06", label: "fellow hackathon builder", ramp: { wallets: RAMP_WALLETS, tolerancePct: RAMP_TOLERANCE_PCT, label: "tenant paying by bank transfer (Ripio)" } } }, 200, { "cache-control": "public, max-age=60" });
  }
  let m = path.match(/^\/api\/leer\/([0-9a-f]{16})$/);
  if (m) return (await kvJson(env, `readres:${m[1]}`)) || json({ status: "working" });
  m = path.match(/^\/api\/probar\/([0-9a-f]{12})$/);
  if (m) {
    const st = await probarApi(env, m[1]);
    return st ? json(st) : fail(404, "not_found", "No encontramos ese alquiler de prueba.");
  }
  m = path.match(/^\/api\/lease\/([0-9a-f]{12})$/);
  if (m) {
    const pubRaw = await env.KV.get(`pub:${m[1]}`);
    if (pubRaw) return json({ ...JSON.parse(pubRaw), probar: (await probarId(env, m[1])) !== null });
    const raw = await env.KV.get(`lease:${m[1]}`);
    return raw ? json({ id: m[1], preparing: true }) : fail(404, "not_found", "No encontramos ese contrato.");
  }
  m = path.match(/^\/api\/recibo\/([0-9a-f]{12})\/(\d{4}-\d{2})$/);
  if (m) {
    const raw = await env.KV.get(`receipt:${m[1]}:${m[2]}`);
    return raw ? json({ ...JSON.parse(raw), probar: (await probarId(env, m[1])) !== null }) : fail(404, "not_found", "No hay recibo para ese mes.");
  }
  m = path.match(/^\/api\/panel\/([0-9a-f]{12})$/);
  if (m) {
    const raw = await env.KV.get(`lease:${m[1]}`);
    if (!raw) return fail(404, "not_found", "No encontramos ese contrato.");
    const lease = JSON.parse(raw);
    const key = req.headers.get("x-aldia-key") || "";
    if (!/^[0-9a-f]{32}$/.test(key) || !sameHex(await sha256Hex(key), lease.keyHash)) {
      return fail(403, "forbidden", "Este link no es válido.");
    }
    const { keyHash, ...terms } = lease;
    const pub = JSON.parse((await env.KV.get(`pub:${m[1]}`)) || "null");
    const panel = JSON.parse((await env.KV.get(`panel:${m[1]}`)) || "null");
    return json({ terms, pub, panel });
  }
  return fail(404, "not_found", "no");
}

function asset(path) {
  const a = ASSETS[path];
  if (!a) return null;
  const headers = { "content-type": a.type, "cache-control": "public, max-age=60", ...SECURITY };
  const body = a.b64 ? Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0)) : a.text;
  return new Response(body, { headers });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const waitUntil = ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null;
    try {
      if (path.startsWith("/agent/")) return await agentApi(req, env, path);
      if (path.startsWith("/api/")) return await api(req, env, path, ctx);
      if (path === "/probar" && req.method === "POST") return await createProbar(req, env, ctx, url);
      if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "method", "no");
      if (path === "/probar" || /^\/probar\/[0-9a-f]{12}$/.test(path)) {
        const page = await renderProbar(url, env, waitUntil);
        return new Response(page.html, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": path === "/probar" ? "public, max-age=60" : "no-store", ...SECURITY } });
      }
      if (path === "/llms.txt") {
        const text = await renderLlms(url, env, waitUntil);
        return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", ...SECURITY } });
      }
      if (path === "/index.html") return new Response(null, { status: 301, headers: { location: "/", ...SECURITY } });
      const a = asset(path);
      if (a) return a;
      if (path === "/calculadora" && req.method === "GET") await countUse(req, env, url, { kind: "page", lease: calcInput(url.searchParams).lease }, ctx);
      // Every page is rendered here with its real content; the browser app takes over when JavaScript runs.
      const page = await renderPage(url, env, waitUntil);
      return new Response(page.html, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", ...SECURITY } });
    } catch (e) {
      console.log("error", path, String(e).slice(0, 200));
      return fail(500, "error", "Algo salió mal. Probá de nuevo en un rato.");
    }
  },
};
