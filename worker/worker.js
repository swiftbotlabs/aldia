// Al Día public site and API on Cloudflare Workers. Holds no keys and moves no money: it stores what people type and
// shows what the agent publishes. The agent runs elsewhere and reaches this Worker over outbound HTTPS only.
import { ASSETS } from "./assets.js";
import { renderPage, renderLlms, testRents } from "./pages.js";

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

async function createLease(req, env) {
  const body = await readJson(req);
  if (!body) return fail(400, "bad_json", "No pudimos leer los datos.");
  const { lease, errors } = validateLease(body);
  if (errors) return json({ error: "invalid", fields: errors }, 422);
  if (await rateLimited(req, "lease", 6, 3600)) return fail(429, "slow_down", "Demasiados intentos. Probá en un rato.");
  if (await dailyCap(env, "lease", 150)) return fail(429, "cap", "Llegamos al cupo de hoy. Probá mañana.");
  const id = randomId(6);
  const token = randomId(16);
  const record = { ...lease, id, createdAt: new Date().toISOString(), keyHash: await sha256Hex(token) };
  await env.KV.put(`lease:${id}`, JSON.stringify(record));
  await env.KV.put(`pending:${id}`, "1");
  await enqueue(env, "leases", id);
  return json({ id, token }, 201);
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

async function kvJson(env, key, fallback = null) {
  const raw = await env.KV.get(key);
  return raw ? json(JSON.parse(raw)) : fallback;
}

async function api(req, env, path) {
  if (req.method === "POST") {
    // Writes come from our own pages. This is not authentication, but it stops other sites from spending the daily caps.
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return fail(403, "origin", "no");
  }
  if (path === "/api/leases" && req.method === "POST") return createLease(req, env);
  if (path === "/api/leer" && req.method === "POST") return createRead(req, env);
  if (req.method !== "GET") return fail(405, "method", "no");
  if (path === "/api/indices") return (await kvJson(env, "indices")) || fail(503, "not_ready", "Todavía no hay índices.");
  if (path === "/api/stats") return (await kvJson(env, "stats")) || json({});
  if (path === "/api/health") return (await kvJson(env, "health")) || json({});
  if (path === "/api/pruebas") return json(await testRents(env));
  let m = path.match(/^\/api\/leer\/([0-9a-f]{16})$/);
  if (m) return (await kvJson(env, `readres:${m[1]}`)) || json({ status: "working" });
  m = path.match(/^\/api\/lease\/([0-9a-f]{12})$/);
  if (m) {
    const pub = await kvJson(env, `pub:${m[1]}`);
    if (pub) return pub;
    const raw = await env.KV.get(`lease:${m[1]}`);
    return raw ? json({ id: m[1], preparing: true }) : fail(404, "not_found", "No encontramos ese contrato.");
  }
  m = path.match(/^\/api\/recibo\/([0-9a-f]{12})\/(\d{4}-\d{2})$/);
  if (m) return (await kvJson(env, `receipt:${m[1]}:${m[2]}`)) || fail(404, "not_found", "No hay recibo para ese mes.");
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
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/agent/")) return await agentApi(req, env, path);
      if (path.startsWith("/api/")) return await api(req, env, path);
      if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "method", "no");
      if (path === "/llms.txt") {
        const text = await renderLlms(url, env);
        return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", ...SECURITY } });
      }
      if (path === "/index.html") return new Response(null, { status: 301, headers: { location: "/", ...SECURITY } });
      const a = asset(path);
      if (a) return a;
      // Every page is rendered here with its real content; the browser app takes over when JavaScript runs.
      const page = await renderPage(url, env);
      return new Response(page.html, { status: page.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", ...SECURITY } });
    } catch (e) {
      console.log("error", path, String(e).slice(0, 200));
      return fail(500, "error", "Algo salió mal. Probá de nuevo en un rato.");
    }
  },
};
