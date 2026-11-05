// Use of the free rent calculator (/calculadora), counted with no personal data.
//
// Stored: one record per UTC day under calcstats:YYYY-MM-DD with whole-number totals only
//   { views, calcs, ipc, icl, fijo, form, app, tests, writes, capped }.
// Never stored: IP addresses, user agents, the numbers people type, cookies (there are none).
//
// What counts:
//   view  a GET of /calculadora with no usable inputs (someone opened the calculator);
//   calc  a GET of /calculadora whose inputs give a result (the form, which works without JavaScript), or a POST to
//         /api/calc-ping from the live calculator in the browser, which carries only the index type (ipc, icl, fijo).
// Not counted: requests carrying ?test=1 (our own checks; tallied apart as `tests`, so a live check can see the write
// path work without touching the visitor numbers), HEAD and prefetches, anything whose user agent is not a
// browser's or names a bot, crawler, preview fetcher or headless browser, our own monitors (tools/nojs_check.py and our
// scripts send "Chrome/130 Safari", which real Chrome never sends: it sends "Chrome/130.0.0.0 Safari"), the example
// link we publish in llms.txt and the README, and pings from another site.
// Dedupe: inside each running Worker instance only, a SHA-256 of (a random salt made in memory + IP + what was counted)
// is kept in memory for 10 minutes and never written anywhere. One visitor counts once per index type, and their page
// views once, per 10 minutes. Different Cloudflare instances do not share it, so a visitor can now and then count twice.
// KV is read-modify-write and eventually consistent across locations: two instances counting the same second can lose
// one increment. Errors go toward counting less, never more. The counters may use at most WRITE_CAP KV writes a day,
// so they can never eat the write budget the rest of the site needs; a day that reaches it is marked capped.

export const CALC_SINCE = "2026-11-05";
export const DEDUPE_MS = 10 * 60 * 1000;
export const WRITE_CAP = 300;
export const RATE_PER_MIN = 60;
export const MAX_SEEN = 5000;
export const FIELDS = ["views", "calcs", "ipc", "icl", "fijo", "form", "app", "tests", "writes"];
export const INDEX_TYPES = ["ipc", "icl", "fijo"];
const KEY = (day) => `calcstats:${day}`;
// The worked link in llms.txt and the README: a machine following it is not a visitor's own calculation.
const EXAMPLE = { alquiler: "500000", inicio: "2026-03-01", indice: "IPC", cada: "4" };
const BROWSER_UA = /^Mozilla\/5\.0 \([^()]{3,200}\) (AppleWebKit|Gecko)\//;
const BOT_UA = /bot|crawl|spider|slurp|scrap|fetch|curl|wget|python|httpx|aiohttp|go-http|okhttp|java\/|libwww|axios|undici|headless|phantom|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|monitor|uptime|pingdom|preview|validator|checker|facebookexternalhit|embedly|google-|claude|anthropic|openai|chatgpt|perplexity|bytespider|ccbot|yandex|baidu|compatible;|lead-radar|swiftbot/i;
export const OUR_MONITOR_UA = /Chrome\/\d+ Safari\//;

// One state per Worker instance. Nothing in it leaves memory.
let state = null;
function fresh() {
  return { salt: null, seen: new Map(), pending: new Map(), last: new Map(), flushing: null, flushStart: 0, win: { start: 0, n: 0 } };
}
export function resetCalcState() {
  state = fresh();
}
export const calcStateForTests = () => state;
resetCalcState();

const day = (now) => new Date(now).toISOString().slice(0, 10);
const nat = (v) => (Number.isInteger(v) && v >= 0 && v < 1e12 ? v : 0);

// The day record as stored, keeping only known whole-number fields, so a damaged record can never print junk.
export function cleanRecord(raw) {
  let o = null;
  try {
    o = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    o = null;
  }
  const r = {};
  for (const f of FIELDS) r[f] = nat(o && typeof o === "object" ? o[f] : 0);
  r.capped = !!(o && typeof o === "object" && o.capped === true);
  return r;
}

// Why a request is not counted, or null when it is a visitor's. Pure: tests call it directly.
export function excluded(req, url, kind) {
  if (url.searchParams.get("test") === "1") return "test";
  const h = (k) => req.headers.get(k) || "";
  if (/prefetch|prerender/i.test(h("sec-purpose") + " " + h("purpose") + " " + h("x-purpose") + " " + h("x-moz"))) return "prefetch";
  const ua = h("user-agent");
  if (ua.length > 512 || !BROWSER_UA.test(ua) || BOT_UA.test(ua)) return "not-a-browser";
  if (OUR_MONITOR_UA.test(ua)) return "our-monitor";
  if (kind === "page") {
    if (req.method !== "GET") return "method";
    const q = url.searchParams;
    if (Object.entries(EXAMPLE).every(([k, v]) => q.get(k) === v)) return "published-example";
  } else {
    if (req.method !== "POST") return "method";
    if (h("origin") !== url.origin) return "origin";
  }
  return null;
}

async function seenKey(ip, what) {
  if (!state.salt) state.salt = crypto.getRandomValues(new Uint8Array(32)); // made on first use: Workers allow no randomness at load
  const ipBytes = new TextEncoder().encode(`|${ip}|${what}`);
  const buf = new Uint8Array(state.salt.length + ipBytes.length);
  buf.set(state.salt);
  buf.set(ipBytes, state.salt.length);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The first sight of this visitor for `what` in the last 10 minutes? Fails closed (false) when the table is full.
async function firstSight(ip, what, now) {
  const k = await seenKey(ip, what);
  const until = state.seen.get(k);
  if (until && until > now) return false;
  if (state.seen.size >= MAX_SEEN) {
    for (const [key, t] of state.seen) if (t <= now) state.seen.delete(key);
    if (state.seen.size >= MAX_SEEN) return false;
  }
  state.seen.set(k, now + DEDUPE_MS);
  return true;
}

function underRate(now) {
  if (now - state.win.start >= 60000) state.win = { start: now, n: 0 };
  state.win.n += 1;
  return state.win.n <= RATE_PER_MIN;
}

// Counts one event if it is a visitor's. `ev` is { kind: "page", lease } for GET /calculadora (lease = the calculator's
// parsed inputs, or null) or { kind: "ping", index } for the browser calculator. Returns { counted, reason, done } where
// `done` is the KV write to wait on (pass it to waitUntil).
export async function countCalc(req, env, url, ev, now = Date.now()) {
  const r = await decide(req, env, url, ev, now);
  // Any request may finish a write an earlier one left pending (a flush stops after FLUSH_MAX_MS).
  if (!r.done && state.pending.size) r.done = flushSoon(env);
  return r;
}

async function decide(req, env, url, ev, now) {
  const why = excluded(req, url, ev.kind);
  if (why && why !== "test") return { counted: false, reason: why, done: null };
  let delta;
  let what;
  if (why === "test") {
    // Our own check: never a visitor. Tallied apart, through the same dedupe and write path.
    delta = { tests: 1 };
    what = "test";
  } else if (ev.kind === "page") {
    const idx = ev.lease && typeof ev.lease.index === "string" ? ev.lease.index.toLowerCase() : null;
    if (ev.lease && INDEX_TYPES.includes(idx)) {
      delta = { calcs: 1, [idx]: 1, form: 1 };
      what = "calc:" + idx;
    } else {
      delta = { views: 1 };
      what = "view";
    }
  } else {
    if (!INDEX_TYPES.includes(ev.index)) return { counted: false, reason: "index", done: null };
    delta = { calcs: 1, [ev.index]: 1, app: 1 };
    what = "calc:" + ev.index;
  }
  const today = day(now);
  if (today < CALC_SINCE) return { counted: false, reason: "clock", done: null };
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  if (!(await firstSight(ip, what, now))) return { counted: false, reason: "repeat", done: null };
  if (!underRate(now)) return { counted: false, reason: "rate", done: null };
  const p = state.pending.get(today) || {};
  for (const [f, v] of Object.entries(delta)) p[f] = (p[f] || 0) + v;
  state.pending.set(today, p);
  return { counted: !why, reason: why, done: flushSoon(env) };
}

// A flush runs inside one request's waitUntil, which the runtime cuts off after about 30 s. So a flush stops after
// FLUSH_MAX_MS and leaves the rest for the next request, and one older than FLUSH_STUCK_MS is treated as dead.
const FLUSH_MAX_MS = 10000;
const FLUSH_STUCK_MS = 20000;
function flushSoon(env) {
  const s = state;
  if (!s.flushing || Date.now() - s.flushStart > FLUSH_STUCK_MS) {
    s.flushStart = Date.now();
    const p = flush(env).finally(() => {
      if (s.flushing === p) s.flushing = null;
    });
    s.flushing = p;
  }
  return s.flushing;
}

// Writes pending counts, one day record at a time, with a pause between writes (KV takes one write a second per key;
// the pause also folds a burst into one write).
async function flush(env) {
  const s = state;
  const gap = env.CALC_WRITE_GAP_MS === undefined ? 2000 : Number(env.CALC_WRITE_GAP_MS);
  const t0 = Date.now();
  while (s.pending.size && Date.now() - t0 < FLUSH_MAX_MS) {
    const [d, delta] = s.pending.entries().next().value;
    s.pending.delete(d);
    let cur;
    try {
      cur = cleanRecord(await env.KV.get(KEY(d)));
    } catch (e) {
      console.log("calcstats read failed", d, String(e).slice(0, 80));
      continue; // counts less, never more
    }
    // A KV read can lag this instance's own last write: never go below what we wrote ourselves.
    const mine = s.last.get(d);
    if (mine) for (const f of FIELDS) cur[f] = Math.max(cur[f], mine[f]);
    if (mine && mine.capped) cur.capped = true;
    if (cur.capped) continue;
    for (const f of FIELDS) if (f !== "writes") cur[f] += nat(delta[f]);
    cur.writes += 1;
    if (cur.writes >= WRITE_CAP) cur.capped = true;
    try {
      await env.KV.put(KEY(d), JSON.stringify(cur));
      s.last.set(d, cur);
      for (const k of s.last.keys()) if (k < day(Date.now() - 2 * 86400000)) s.last.delete(k);
    } catch (e) {
      console.log("calcstats write failed", d, String(e).slice(0, 80));
    }
    if (gap > 0 && s.pending.size) await new Promise((r) => setTimeout(r, gap));
  }
}

// Totals since CALC_SINCE, read from the day records. A short per-instance memo; tests set SSR_CACHE_MS=0.
let memo = null;
export async function calcStats(env, now = Date.now()) {
  const ttl = env.SSR_CACHE_MS === undefined ? 30000 : Number(env.SSR_CACHE_MS);
  if (memo && Date.now() - memo.t < ttl) return memo.v;
  const days = [];
  for (let t = Date.parse(CALC_SINCE + "T00:00:00Z"); day(t) <= day(now) && days.length < 400; t += 86400000) days.push(day(t));
  const recs = await Promise.all(days.map(async (d) => [d, cleanRecord(await env.KV.get(KEY(d)))]));
  const sum = (f) => recs.reduce((a, [, r]) => a + r[f], 0);
  const v = {
    since: CALC_SINCE,
    calculations: sum("calcs"),
    pageViews: sum("views"),
    byIndex: { ipc: sum("ipc"), icl: sum("icl"), fijo: sum("fijo") },
    via: { form: sum("form"), browser: sum("app") },
    testRequests: sum("tests"),
    days: recs.filter(([, r]) => r.calcs || r.views).map(([d, r]) => ({ date: d, calculations: r.calcs, pageViews: r.views })),
    cappedDays: recs.filter(([, r]) => r.capped).map(([d]) => d),
    definitions: {
      calculations: "Results by visitors: the calculator form sent with a rent and a start date (works without JavaScript), or a result shown by the live calculator in the browser, which then sends only the index type.",
      pageViews: "Visits to /calculadora without inputs.",
      dedupe: "One visitor counts once per index type, and their page views once, per 10 minutes, in each Cloudflare instance. The check uses a SHA-256 of a random in-memory salt plus the IP address, held in memory for 10 minutes and never written anywhere.",
      stored: "Daily totals only. No IP addresses, user agents, inputs or cookies are stored.",
      testRequests: "Our own checks, sent with ?test=1: not visitors and not in the numbers above. Tallied apart (once per 10 minutes per sender) so anyone can see the counting pipeline write.",
      excluded: "Requests with ?test=1 (our own checks), HEAD and prefetches, non-browser and bot user agents, headless browsers, our own monitors, the example link published in llms.txt and the README, and pings from other sites.",
      writeCap: `At most ${WRITE_CAP} counter writes a day; a day that reaches it is listed in cappedDays and stops counting.`,
    },
    readAt: new Date(now).toISOString(),
  };
  memo = { t: Date.now(), v };
  return v;
}
