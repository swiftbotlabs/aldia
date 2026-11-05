// Server-rendered pages for Al Día, in Spanish (default) and English (?lang=en). These are the pages: the browser app
// (web/app.js) only adds interaction on top (wallet buttons, the live calculator, the lease form and the private panel).
// Rules: every dynamic value goes through html``, which escapes it; a link is built only from a value that passes a strict
// pattern; every figure comes from the records the agent publishes to KV (stats, indices, pub:, receipt:) or is computed
// from the official index series with the same rent.js the browser uses. Nothing here moves money or holds a key.
import { AlDiaRent } from "./rent.mjs";
import { outsideSummary, CUTOFF_DAY, RAMP_TOLERANCE_PCT } from "./outside.js";
import { calcStats, CALC_SINCE, DEDUPE_MS } from "./calcstats.js";

const { addMonths, rentForMonth, termsFromDetail } = AlDiaRent;

// Addresses and links already published in the README and on the site. tests/test_web.mjs checks each one against README.md.
export const ONCHAIN = {
  agentWallet: "0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b",
  agentId: 10014,
  identityTx: "0x543f492bbc821a75df02aaedebece12850d6dd083718bfa249018cee63d21016", // ERC-8004 registration tx
  factory: "0x1e7CBf5d31c85B168048115d0aE762463A475882",
  implementation: "0x90C1F1e91C21f2f166317B6e8A9292B9dF707759",
  oldFactory: "0x4690e265fD2d542e1B44aC7ba41f796a474b11c1",
  tag: "celo_2ee02704a56d",
};
export const LINKS = {
  repo: "https://github.com/swiftbotlabs/aldia",
  video: "https://youtu.be/DmCQoeQxLME",
  erc8004: "https://8004scan.io/agents/celo/10014",
};
// Builder-test pages named in the README's judge path, by id and month only. Their figures are read from KV.
export const SAMPLE_TENANT = "c658d0b11729";
export const SAMPLE_RECEIPT = { id: "8650326827d3", month: "2026-11" };
export const TEST_RENTS = [
  { id: "3c9a8784b63e", month: "2026-11" },
  { id: "74414e7210ef", month: "2026-11" },
  { id: "8650326827d3", month: "2026-11" },
  { id: "0b069750a07b", month: "2026-11" },
];
const INDEC_PAGE = "https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31";
const BCRA_PAGE = "https://www.bcra.gob.ar/estadisticas-indicadores/";
const BOT = "https://t.me/AlDiaAvisosBot";
const rampUrl = (amount, address) => `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=${amount}&address=${address}`;
export { rampUrl };

/* ---------- escaping ---------- */
class Raw {
  constructor(s) {
    this.s = s;
  }
}
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function render(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

/* ---------- checks ---------- */
export const fin = (n) => typeof n === "number" && Number.isFinite(n);
export const str = (s, max = 200) => (typeof s === "string" ? s.slice(0, max) : "");
export const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const isDay = (d) => typeof d === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.test(d);
export const isTx = (t) => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t);
export const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
export const txUrl = (t) => `https://celoscan.io/tx/${t}`;
export const addrUrl = (a) => `https://celoscan.io/address/${a}`;
export const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const isId = (i) => typeof i === "string" && /^[0-9a-f]{12}$/.test(i);
const nowMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);

/* ---------- language: Spanish by default, English with ?lang=en on every page and every internal link ---------- */
export const langOf = (url) => (url.searchParams.get("lang") === "en" ? "en" : "es");
export function withLang(path, lang) {
  if (lang !== "en") return path;
  const i = path.indexOf("#");
  const [p, h] = i < 0 ? [path, ""] : [path.slice(0, i), path.slice(i)];
  return p + (p.includes("?") ? "&" : "?") + "lang=en" + h;
}
// The same page in the other language, keeping the rest of the query (the calculator's inputs).
export function toggleHref(path, search, lang) {
  const q = new URLSearchParams(search || "");
  if (lang === "en") q.delete("lang");
  else q.set("lang", "en");
  const qs = q.toString();
  return path + (qs ? "?" + qs : "");
}
// Formats and the phrase picker for one language. Amounts stay in pesos in both languages ("ARS 660,978" in English).
export function fmt(lang) {
  const en = lang === "en";
  const loc = en ? "en-US" : "es-AR";
  const nf = (o) => new Intl.NumberFormat(loc, o);
  const dt = (o, d) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(d);
  return {
    lang, en, loc,
    s: (es, eng) => (en ? eng : es),
    u: (p) => withLang(p, lang),
    ars: (n) => (fin(n) ? nf({ style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n) : "—"),
    ars2: (n) => (fin(n) ? nf({ style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n) : "—"),
    num: (n) => (fin(n) ? nf({ maximumFractionDigits: 0 }).format(n) : "—"),
    pctf: (n, d = 2) => (fin(n) ? nf({ maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n) + (en ? "%" : " %") : "—"),
    usd: (n) => (fin(n) ? "US$" + (en ? "" : "\u00a0") + nf({ maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n) : "—"),
    usd3: (n) => (fin(n) ? "US$" + (en ? "" : "\u00a0") + nf({ maximumFractionDigits: 4, minimumFractionDigits: 2 }).format(n) : "—"),
    usdt6: (n) => (fin(n) ? nf({ maximumFractionDigits: 6, minimumFractionDigits: 6 }).format(n / 1e6) + " USD₮" : "—"),
    level: (n) => (fin(n) ? nf({ maximumFractionDigits: 4 }).format(n) : "—"),
    factor6: (n) => nf({ minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(n),
    month: (ym, year = true) => (isMonth(ym) ? dt({ month: "long", ...(year ? { year: "numeric" } : {}) }, new Date(ym + "-15T00:00:00Z")) : ""),
    monthShort: (ym) => (isMonth(ym) ? dt({ month: "short", year: "numeric" }, new Date(ym + "-15T00:00:00Z")).replace(".", "") : ""),
    dayMonth: (d) => (isDay(d) ? dt({ day: "numeric", month: "long" }, new Date(d.slice(0, 10) + "T12:00:00Z")) : ""),
    dayFull: (d) => (isDay(d) ? dt({ day: "numeric", month: "long", year: "numeric" }, new Date(d.slice(0, 10) + "T12:00:00Z")) : "—"),
  };
}
const ES = fmt("es");
// Spanish formats, kept for other modules.
export const ars = ES.ars;
export const monthName = ES.month;
export const dayMonth = ES.dayMonth;

// The agent publishes its own labels in Spanish. Known ones are shown in English on English pages; anything else as is.
const AGENT_EN = {
  "prueba nuestra": "our test",
  "Prueba: depto demo Swift Bot Labs": "Test: Swift Bot Labs demo flat",
  "Prueba: contrato de febrero con IPC trimestral": "Test: February lease, IPC every quarter",
  "Prueba: contrato de febrero con ICL": "Test: February lease with ICL",
  "Prueba: contrato leído de un PDF": "Test: lease read from a PDF",
  "Prueba: fábrica nueva, piso de dos ventanas": "Test: new factory, two-window floor",
  "Prueba abierta de 1.000 wARS": "Open test, 1,000 wARS",
  "Lectura y revisión de contrato (modelo de Cencori, vía buy)": "Contract reading and review (Cencori model, via buy)",
  "Navegador alquilado (prueba, vía buy)": "Rented browser (test, via buy)",
  "sin conversión": "no conversion",
};
const agentText = (X, v, max) => {
  const t = str(v, max);
  return X.en && Object.hasOwn(AGENT_EN, t) ? AGENT_EN[t] : t;
};

/* ---------- data: the KV records the app's own API serves ---------- */
// A short per-isolate memo so a burst of page views costs a few KV reads, not one per view. Tests set SSR_CACHE_MS=0.
const memo = new Map();
export async function kv(env, key) {
  const ttl = env.SSR_CACHE_MS === undefined ? 30000 : Number(env.SSR_CACHE_MS);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const raw = await env.KV.get(key);
  let v = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  if (v !== null && typeof v !== "object") v = null;
  if (memo.size >= 256) memo.clear();
  memo.set(key, { t: Date.now(), v });
  return v;
}

// The builder-test rents with their onchain proof, from each receipt and lease record the agent published.
export async function testRents(env) {
  const rows = await Promise.all(TEST_RENTS.map(async ({ id, month }) => {
    const [r, pub] = await Promise.all([kv(env, `receipt:${id}:${month}`), kv(env, `pub:${id}`)]);
    if (!r || r.builderTest !== true) return null;
    const pays = [...(Array.isArray(r.paymentTxs) ? r.paymentTxs : []), ...(Array.isArray(r.paymentTxsLate) ? r.paymentTxsLate : [])].filter(isTx);
    return {
      id, month,
      label: str(r.propertyLabel, 80),
      index: str(r.index, 8),
      amount: fin(r.amount) ? r.amount : null,
      received: fin(r.received) ? r.received : null,
      fee: fin(r.fee) ? r.fee : null,
      pesoToLandlord: fin(r.pesoToLandlord) ? r.pesoToLandlord : null,
      dollarToLandlord: fin(r.dollarToLandlord) ? r.dollarToLandlord : null,
      route: str(r.route, 40),
      paidAt: isDay(r.paidAt) ? str(r.paidAt, 30) : null,
      paymentTxs: pays,
      settleTx: isTx(r.settleTx) ? r.settleTx : null,
      lease: pub && isAddr(pub.collector) ? pub.collector : null,
      receipt: `/recibo/${id}/${month}`,
    };
  }));
  return rows.filter(Boolean);
}

// Our own test leases, counted the same way on every page and in llms.txt: how many there are (the agent's stats), how
// many were paid and settled on Celo and the pesos received (the published receipts), and how many were never paid.
// Returns null when the two records disagree (more paid leases than leases, or receipts that do not account for every test
// payment the agent counted), so no page prints a sum that does not add up.
export function testLeaseCounts(st, rents) {
  const leases = st && Number.isInteger(st.leasesTest) && st.leasesTest >= 0 ? st.leasesTest : null;
  if (leases === null || !Array.isArray(rents)) return null;
  const paid = new Set(rents.map((r) => r.id)).size;
  if (paid > leases) return null;
  const pays = rents.reduce((a, r) => a + (Array.isArray(r.paymentTxs) ? r.paymentTxs.length : 0), 0);
  if (!Number.isInteger(st.paymentsTest) || pays !== st.paymentsTest) return null;
  const wars = rents.reduce((a, r) => a + (fin(r.received) ? r.received : 0), 0);
  return { leases, paid, unpaid: leases - paid, wars };
}

// The sentence itself, in Spanish or English. `when` is the agent's own "last changed" stamp, when it has one.
export function testLeaseLine(X, c, when) {
  if (!c) return "";
  const { s } = X;
  const w = when ? s(` (al ${when})`, ` (as of ${when})`) : "";
  const es1 = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return s(
    `${es1(c.leases, "contrato de prueba nuestro", "contratos de prueba nuestros")}${w}: ${es1(c.paid, "cobrado y liquidado", "cobrados y liquidados")} en Celo, ${X.num(c.wars)} wARS en total, pagados desde nuestra billetera; ${es1(c.unpaid, "nunca se pagó", "nunca se pagaron")}.`,
    `${c.leases} test ${c.leases === 1 ? "lease" : "leases"} of ours${w}: ${c.paid} paid and settled on Celo, ${X.num(c.wars)} wARS in all, paid from our own wallet; ${c.unpaid} never paid.`);
}

/* ---------- page frame ---------- */
const CHROME = {
  es: { html: "es-AR", og: "es_AR", calc: "Calculadora", probar: "Probar", other: "EN", otherName: "English", otherLang: "en",
    by: "Al Día es un producto de Swift Bot Labs. No somos una inmobiliaria ni un banco, y este sitio no reemplaza tu contrato ni un asesoramiento legal o impositivo.",
    transp: "Transparencia", load: "Cargar contrato", tryIt: "Probalo con 1.000 wARS", code: "Código abierto", idx: "Índices", and: "y",
    product: "Producto", sources: "Fuentes y código", dark: "Usar modo oscuro", light: "Usar modo claro", video: "Video (1:34)", base: `Swift Bot Labs · agente ERC-8004 n.º ${ONCHAIN.agentId} en Celo` },
  en: { html: "en", og: "en_US", calc: "Calculator", probar: "Try it", other: "ES", otherName: "Español", otherLang: "es",
    by: "Al Día is a Swift Bot Labs product. We are not an estate agent or a bank, and this site does not replace your contract or legal or tax advice.",
    transp: "Transparency", load: "Load a lease", tryIt: "Try it with 1,000 wARS", code: "Open source", idx: "Indices", and: "and",
    product: "Product", sources: "Sources and code", dark: "Use dark mode", light: "Use light mode", video: "Video (1:34)", base: `Swift Bot Labs · ERC-8004 agent #${ONCHAIN.agentId} on Celo` },
};
export { CHROME };
// `refresh` reloads a page that is waiting on the agent, for readers without JavaScript. `home` drops the page container:
// the home page lays out its own full-width bands.
export function layout({ origin, path, search = "", title, description, ogTitle, body, noindex = false, ssr = true, lang = "es", refresh = 0, home = false, narrow = false }) {
  const t = CHROME[lang] || CHROME.es;
  const X = fmt(lang);
  const canonical = origin + path + (lang === "en" ? "?lang=en" : "");
  return html`<!doctype html>
<html lang="${t.html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${Number.isInteger(refresh) && refresh > 0 ? html`<meta http-equiv="refresh" content="${refresh}">
` : ""}<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? html`<meta name="robots" content="noindex">
` : ""}<meta name="theme-color" content="#eef3f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1524" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Al Día">
<meta property="og:locale" content="${t.og}">
<meta property="og:title" content="${ogTitle || title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="es" href="${origin + path}">
<link rel="alternate" hreflang="en" href="${origin + path}?lang=en">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Al Día for language models">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400..700;1,400..700&family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
</head>
<body>
<div id="app"${ssr ? html` data-ssr="${path}"` : ""}>
<header class="top"><div class="wrap"><a class="brand" href="${X.u("/")}"><img src="/logo.svg" alt="" width="28" height="28">Al Día</a><nav><a class="nav-hide" href="${X.u("/transparencia")}">${t.transp}</a><a href="${X.u("/calculadora")}">${t.calc}</a><a class="lang" href="${toggleHref(path, search, lang)}" hreflang="${t.otherLang}" lang="${t.otherLang}" title="${t.otherName}">${t.other}</a><button class="theme" type="button" id="theme" hidden data-dark="${t.dark}" data-light="${t.light}" aria-label="${t.dark}">${icon("moon")}${icon("sun")}</button><a class="nav-cta" href="${X.u("/probar")}">${t.probar}</a></nav></div></header>
${home ? html`<main class="home">` : html`<main class="wrap${narrow ? " narrow" : ""}">`}
${body}
</main>
<footer><div class="wrap"><div class="foot"><div><a class="brand" href="${X.u("/")}"><img src="/logo.svg" alt="" width="28" height="28">Al Día</a><p>${t.by}</p></div><div><h4>${t.product}</h4><ul><li><a href="${X.u("/probar")}">${t.tryIt}</a></li><li><a href="${X.u("/calculadora")}">${t.calc}</a></li><li><a href="${X.u("/nuevo")}">${t.load}</a></li><li><a href="${X.u("/transparencia")}">${t.transp}</a></li></ul></div><div><h4>${t.sources}</h4><ul><li><a href="${LINKS.repo}" rel="noopener">${t.code}</a></li><li><a href="${LINKS.video}" rel="noopener">${t.video}</a></li><li>${t.idx}: <a href="${INDEC_PAGE}" rel="noopener">INDEC</a> ${t.and} <a href="${BCRA_PAGE}" rel="noopener">BCRA</a></li><li><a href="${LINKS.erc8004}" rel="noopener">ERC-8004</a></li></ul></div></div><p class="foot-base">${t.base}</p></div></footer>
</div>
<script src="/rent.js" defer></script>
<script src="/app.js" defer></script>
</body>
</html>
`.s;
}

/* ---------- small inline icons (one stroke width) ---------- */
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  bank: '<path d="M3 21h18"/><path d="M5 21V10M19 21V10M9 21V10M15 21V10"/><path d="m12 3 9 5H3z"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};
export const icon = (name) => new Raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`);

// A small line chart of official index levels (real data only), with the coordinates the hero animation reuses.
const SW = 300;
const SH = 64;
export function sparkPoints(levels) {
  if (!Array.isArray(levels) || levels.length < 2 || !levels.every(fin)) return null;
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = hi - lo || 1;
  return levels.map((v, i) => [Math.round((4 + (i * (SW - 8)) / (levels.length - 1)) * 10) / 10, Math.round((SH - 6 - ((v - lo) / span) * (SH - 14)) * 10) / 10]);
}
export function sparkSvg(levels) {
  const pts = sparkPoints(levels);
  if (!pts) return "";
  const d = "M" + pts.map(([x, y]) => `${x} ${y}`).join(" L");
  const [fx, fy] = pts[0];
  const [lx, ly] = pts.at(-1);
  return new Raw(`<svg class="spark" viewBox="0 0 ${SW} ${SH}" aria-hidden="true" data-xy="${pts.map((p) => p.join(",")).join(" ")}"><line class="gd" x1="0" y1="${fy}" x2="${SW}" y2="${fy}"/><path class="ar" d="${d} L${lx} ${SH} L${fx} ${SH} Z"/><path class="ln" d="${d}"/><circle class="pt" cx="${fx}" cy="${fy}" r="3.5"/><circle class="pt end" cx="${lx}" cy="${ly}" r="4"/></svg>`);
}
// The monthly series between two months of an index, or null when a month is missing.
export function seriesBetween(series, from, to) {
  if (!series || !isMonth(from) || !isMonth(to) || from > to) return null;
  const months = [];
  for (let m = from; m <= to && months.length < 40; m = addMonths(m, 1)) months.push(m);
  const levels = months.map((m) => series[m]);
  return levels.every(fin) ? { months, levels } : null;
}

/* ---------- shared parts ---------- */
function missingText(X, m) {
  const s = str(m, 40);
  const mm = s.match(/^(IPC de|ICL del) (\d{4}-\d{2}(?:-\d{2})?)$/);
  return X.en && mm ? `${mm[1].slice(0, 3)} for ${mm[2]}` : s;
}
export function explainRent(X, r) {
  const { s } = X;
  if (!r || typeof r !== "object") return "";
  if (r.missing) return html`<div class="note warn">${s(`Todavía no se publicó el ${missingText(X, r.missing)}. El aumento se calcula apenas salga.`, `The ${missingText(X, r.missing)} is not published yet. The increase is worked out as soon as it is.`)}</div>`;
  if (r.adjustments === 0) return html`<p class="muted">${s("Sin aumentos todavía: este es el monto inicial del contrato.", "No increase yet: this is the lease's starting rent.")}</p>`;
  const rows = [[s("Monto inicial", "Starting rent"), X.ars(r.baseRent)], [s("Aumento acumulado", "Total increase"), "+" + X.pctf(r.pct)]];
  if (r.stepPct !== undefined) rows.push([s("Último aumento", "Latest increase"), "+" + X.pctf(r.stepPct)]);
  const used = Array.isArray(r.monthsUsed) ? r.monthsUsed.filter(isMonth) : [];
  if (used.length) rows.push([s("Meses de IPC usados", "IPC months used"), used.map((m) => X.month(m, false)).join(", ") + " " + used.at(-1).slice(0, 4)]);
  const lv = (v) => (fin(v) ? (X.en ? String(v) : String(v).replace(".", ",")) : "—");
  if (r.index === "ICL") rows.push([s("ICL usado", "ICL used"), `${lv(r.levelFrom)} → ${lv(r.levelTo)}`]);
  return html`<div><dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>${
    r.index === "IPC" ? html`<p class="small muted" style="margin-top:10px">${s("Fuente", "Source")}: <a href="${INDEC_PAGE}" rel="noopener">${s("INDEC, IPC nivel general nacional", "INDEC, national general CPI (IPC)")}</a>.</p>` : ""}${
    r.index === "ICL" ? html`<p class="small muted" style="margin-top:10px">${s("Fuente", "Source")}: <a href="${BCRA_PAGE}" rel="noopener">${s("BCRA, Índice para Contratos de Locación", "BCRA, rental contracts index (ICL)")}</a>.</p>` : ""}</div>`;
}

const CHIPS = {
  pagado: ["ok", "Pagado", "Paid"], parcial: ["wait", "Pago parcial", "Part paid"], pendiente: ["wait", "Pendiente", "Due"],
  vencido: ["late", "Vencido", "Overdue"], "sin-indice": ["info", "Esperando índice", "Waiting for the index"],
};
const chipText = (X, st) => (CHIPS[st] ? CHIPS[st][X.en ? 2 : 1] : str(st, 20));
const statusChip = (X, st) => html`<span class="chip ${(CHIPS[st] || ["info"])[0]}">${chipText(X, st)}</span>`;
function clauseNote(X, c) {
  const { s } = X;
  const k = c && c.clauseCheck;
  if (!k || typeof k !== "object") return "";
  return html`<p class="small" style="margin:10px 0 0">${k.ok ? s("Revisamos este aumento contra la cláusula del contrato: coincide.", "We checked this increase against the contract clause: it matches.") : s("Ojo: este aumento podría no coincidir con la cláusula del contrato. ", "Careful: this increase may not match the contract clause. ")}${
    k.ok ? "" : str(k.note, 400)}${isTx(k.tx) ? html` <a href="${txUrl(k.tx)}" rel="noopener">${s("Ver la revisión paga en Celo", "See the paid review on Celo")}</a>.` : ""}</p>`;
}
// What a receipt paid the landlord, in one phrase.
function payoutPhrase(X, r) {
  const { s } = X;
  const peso = fin(r.pesoToLandlord) && r.pesoToLandlord > 0 ? X.ars(r.pesoToLandlord) : null;
  const dollar = fin(r.dollarToLandlord) && r.dollarToLandlord > 0 ? `${X.usd(r.dollarToLandlord)}${r.route ? s(` vía ${agentText(X, r.route, 40)}`, ` via ${agentText(X, r.route, 40)}`) : ""}` : null;
  if (peso && dollar) return s(`${peso} en pesos y ${dollar}`, `${peso} in pesos and ${dollar}`);
  return peso ? s(`${peso} en pesos`, `${peso} in pesos`) : dollar || "—";
}

/* ---------- outside payers (checked by worker/outside.js) ---------- */
export const REASONS = {
  es: { ours: "billetera nuestra", "funded-by-us": "sus primeros fondos vinieron de una billetera nuestra", "new-wallet": "su primera operación en Celo es posterior al 6 de octubre de 2026",
    unclear: "no se ve de dónde salieron sus primeros fondos", "no-history": "el explorador todavía no muestra su historial", indirect: "los wARS no salieron directo de la billetera que firmó",
    partial: "pagó menos de la mitad del alquiler del mes", unchecked: "todavía no la pudimos revisar", invalid: "dirección inválida",
    "ramp-amount": `lo que mandó Ripio no coincide, con un margen de ${RAMP_TOLERANCE_PCT} %, con el alquiler que pedía la página` },
  en: { ours: "one of our wallets", "funded-by-us": "its first funds came from one of our wallets", "new-wallet": "its first Celo activity is after 6 Oct 2026",
    unclear: "where its first funds came from is not visible", "no-history": "the explorer does not show its history yet", indirect: "the wARS did not come straight from the signing wallet",
    partial: "it paid less than half of that month's rent", unchecked: "not checked yet", invalid: "invalid address",
    "ramp-amount": `what Ripio delivered does not match, within ${RAMP_TOLERANCE_PCT}%, the rent the tenant page asked for` },
};
export const PAYER_LABEL = { es: "otro equipo de la hackatón", en: "fellow hackathon builder" };
export const RAMP_LABEL = { es: "inquilino por transferencia bancaria (Ripio)", en: "tenant paying by bank transfer (Ripio)" };
// The stored summary is our own record, but every value is checked again before it becomes text or a link.
export function cleanOutside(o) {
  const ok = o && typeof o === "object" ? o : {};
  const payers = (Array.isArray(ok.payers) ? ok.payers : []).filter((p) => p && isAddr(p.address) && isTx(p.tx)).slice(0, 200).map((p) => ({
    address: p.address, tx: p.tx, date: isDay(p.date) ? p.date.slice(0, 10) : null, firstSeen: isDay(p.firstSeen) ? p.firstSeen.slice(0, 10) : null,
    receipt: isId(p.id) && isMonth(p.month) ? `/recibo/${p.id}/${p.month}` : null, payments: Number.isInteger(p.payments) && p.payments > 0 ? Math.min(p.payments, 1000) : 1,
  }));
  const ramp = (Array.isArray(ok.ramp) ? ok.ramp : []).filter((r) => r && isTx(r.tx) && typeof r.key === "string" && /^[0-9a-f]{12}$/.test(r.key)).slice(0, 200).map((r) => ({
    tx: r.tx, key: r.key, date: isDay(r.date) ? r.date.slice(0, 10) : null, wars: Number.isInteger(r.wars) && r.wars >= 0 ? r.wars : null,
    receipt: isId(r.id) && isMonth(r.month) ? `/recibo/${r.id}/${r.month}` : null,
  }));
  const notCounted = (Array.isArray(ok.notCounted) ? ok.notCounted : []).filter((r) => r && Object.hasOwn(REASONS.es, r.reason)).slice(0, 50).map((r) => ({
    address: isAddr(r.address) ? r.address : null, reason: r.reason, tx: isTx(r.tx) ? r.tx : null, date: isDay(r.date) ? r.date.slice(0, 10) : null, ramp: r.via === "ripio",
  }));
  const rampPayers = new Set(ramp.map((r) => r.key)).size;
  return {
    count: payers.length + rampPayers, walletPayers: payers.length, rampPayers, rampPayments: ramp.length,
    payments: payers.reduce((a, p) => a + p.payments, 0) + ramp.length, payers, ramp, notCounted,
    checkedAt: isDay(ok.checkedAt) ? str(ok.checkedAt, 24) : null, complete: ok.complete === true,
  };
}
function outsideCard(X, o) {
  const { s, u } = X;
  const rule = s(
    `Un alquiler ya liquidado cuenta como pago externo de dos maneras, y este sitio lo revisa solo en el explorador público de Celo (Blockscout) antes de sumar a nadie. Desde una billetera: los wARS salieron directo de una billetera que no es nuestra, cuyos primeros fondos no vinieron de una billetera nuestra y que tiene actividad en Celo desde antes del 6 de octubre de 2026. Por transferencia bancaria vía Ripio: los wARS los mandó la billetera de Ripio y la firmó ella misma, lo que llegó coincide con el alquiler del mes (margen de ${RAMP_TOLERANCE_PCT} %) y el propietario no es una billetera nuestra ni recibió nunca nada de una billetera nuestra. Nosotros no tenemos cuenta en Ripio. Si algo no se puede comprobar, no cuenta.`,
    `A settled rent counts as an outside payment in one of two ways, and this site checks it by itself on Celo's public explorer (Blockscout) before counting anyone. From a wallet: the wARS came straight from a wallet that is not ours, whose first funds did not come from one of our wallets, and whose first Celo activity is before 6 October 2026. By bank transfer through Ripio: Ripio's wallet sent and signed the wARS transfer, the amount matches the month's rent (within ${RAMP_TOLERANCE_PCT}%), and the landlord is not one of our wallets and never received anything from one. We have no Ripio account. If something cannot be proven, it does not count.`);
  const label = X.en ? PAYER_LABEL.en : PAYER_LABEL.es;
  return html`<section class="card wide" id="externos"><div class="xgrid"><div><h2 class="h3">${s("Pagadores externos", "Outside payers")}</h2><p class="small">${rule}</p></div><div>${
    o.payers.length ? html`<h3 style="margin-top:14px">${s("Desde una billetera", "From a wallet")}</h3><table><tr><th>${s("Billetera", "Wallet")}</th><th>${s("Pagó el", "Paid on")}</th><th class="r">${s("En Celo", "On Celo")}</th></tr>${o.payers.map((p) => html`<tr><td><a href="${addrUrl(p.address)}" rel="noopener" class="mono">${short(p.address)}</a><br><span class="tiny">${label}${p.firstSeen ? s(` · en Celo desde ${X.month(p.firstSeen.slice(0, 7))}`, ` · on Celo since ${X.month(p.firstSeen.slice(0, 7))}`) : ""}</span></td><td>${X.dayFull(p.date)}</td><td class="r"><a href="${txUrl(p.tx)}" rel="noopener">${s("pago", "payment")}</a>${p.receipt ? html`<br><a href="${u(p.receipt)}">${s("recibo", "receipt")}</a>` : ""}</td></tr>`)}</table>` : ""}${
    o.ramp.length ? html`<h3 style="margin-top:14px">${s("Por transferencia vía Ripio", "By bank transfer through Ripio")}</h3><table><tr><th>${s("Pago", "Payment")}</th><th>${s("Fecha", "Date")}</th><th class="r">${s("En Celo", "On Celo")}</th></tr>${o.ramp.map((r) => html`<tr><td>${r.wars === null ? "—" : `${X.num(r.wars)} wARS`}<br><span class="tiny">${X.en ? RAMP_LABEL.en : RAMP_LABEL.es}</span></td><td>${X.dayFull(r.date)}</td><td class="r"><a href="${txUrl(r.tx)}" rel="noopener">${s("pago", "payment")}</a>${r.receipt ? html`<br><a href="${u(r.receipt)}">${s("recibo", "receipt")}</a>` : ""}</td></tr>`)}</table>` : ""}${
    !o.payers.length && !o.ramp.length ? html`<div class="countbox" style="margin:0 0 12px"><b>0</b><span class="muted">${s("pagadores externos verificados", "verified outside payers")}</span></div><p class="small muted" style="margin:0">${s("Todavía ninguno.", "None yet.")} <a href="${u("/probar")}">${s("Probalo con un alquiler real de 1.000 wARS", "Try it with a real 1,000 wARS rent")}</a>${s(": vos sos el propietario, así que la plata te vuelve, menos el 0,3 %.", ": you are the landlord, so the money comes back to you, less 0.3%.")}</p>` : ""}${
    o.notCounted.length ? html`<h3 style="margin-top:16px">${s("Pagos que no contamos", "Payments we did not count")}</h3><table>${o.notCounted.map((r) => html`<tr><td>${r.address ? html`<span class="mono">${short(r.address)}</span>` : r.ramp ? s("Transferencia vía Ripio", "Bank transfer through Ripio") : s("Billetera nuestra", "One of our wallets")}<br><span class="tiny">${(X.en ? REASONS.en : REASONS.es)[r.reason]}</span></td><td class="r">${r.tx ? html`<a href="${txUrl(r.tx)}" rel="noopener">${s("pago", "payment")}</a>` : "—"}</td></tr>`)}</table>` : ""}${
    o.checkedAt ? html`<p class="tiny" style="margin:10px 0 0">${s("Revisado", "Checked")}: ${o.checkedAt.slice(0, 16).replace("T", " ")} UTC${o.complete ? "" : s(", la revisión sigue en curso", ", the check is still running")}.</p>` : html`<p class="tiny" style="margin:10px 0 0">${s("La revisión todavía no corrió: hasta entonces no contamos a nadie.", "The check has not run yet: until it does, nobody is counted.")}</p>`}</div></div></section>`;
}

/* ---------- pages ---------- */
// The home page leads with the product: what a tenant sees this month, a settled receipt, the 2-minute test and the video.
// What is and is not real yet follows, in its own panel.
async function pageHome(env, X, waitUntil, origin) {
  const { s, u } = X;
  const [pub, rec, st0, o0, rents, idx] = await Promise.all([kv(env, `pub:${SAMPLE_TENANT}`), kv(env, `receipt:${SAMPLE_RECEIPT.id}:${SAMPLE_RECEIPT.month}`), kv(env, "stats"), outsideSummary(env, waitUntil), testRents(env), kv(env, "indices")]);
  const o = cleanOutside(o0);
  const st = st0 || {};
  const counts = testLeaseCounts(st, rents);
  const c = pub && pub.current && typeof pub.current === "object" && fin(pub.current.amount) && isMonth(pub.current.month) ? pub.current : null;
  const d = c && c.detail && typeof c.detail === "object" ? c.detail : null;
  // The one-line proof of the amount, shown only when the published levels give exactly the amount charged. When the
  // official monthly series between the two months is on hand and ends on those same levels, it is drawn as a chart and
  // handed to the browser, which replays the calculation month by month (web/app.js enhanceHome).
  let calcBox = "";
  let anim = null;
  if (d && d.index === "IPC" && d.adjustments > 0 && fin(d.levelFrom) && fin(d.levelTo) && d.levelFrom > 0 && Number.isInteger(d.baseRent) && isMonth(d.refFrom) && isMonth(d.refTo)) {
    const f = d.levelTo / d.levelFrom;
    if (Math.floor(d.baseRent * f + 0.5) === c.amount) {
      const ser = seriesBetween(idx && idx.ipc, d.refFrom, d.refTo);
      const okSer = ser && ser.levels[0] === d.levelFrom && ser.levels.at(-1) === d.levelTo ? ser : null;
      if (okSer) anim = { base: d.baseRent, amount: c.amount, levels: okSer.levels.join(","), months: okSer.months.join(",") };
      calcBox = html`<div class="calc"><div class="calc-head"><span>${s("IPC nivel general, INDEC", "IPC, national, INDEC")}</span>${fin(d.pct) ? html`<b data-pct>+${X.pctf(d.pct)}</b>` : ""}</div>${
        okSer ? html`${sparkSvg(okSer.levels)}<div class="spark-x"><span>${X.monthShort(okSer.months[0])}</span><span>${X.monthShort(okSer.months.at(-1))}</span></div>` : ""}<p class="calcline"><span class="nw">${X.ars(d.baseRent)} × <span data-f>${X.factor6(f)}</span></span> <span class="nw">= <b data-amt>${X.ars(c.amount)}</b></span></p><p class="tiny">${s("IPC ", "IPC ")}<span data-ref>${X.monthShort(d.refTo)}</span>${s(` ÷ IPC ${X.monthShort(d.refFrom)}, del INDEC`, ` ÷ IPC ${X.monthShort(d.refFrom)}, from INDEC`)}</p></div>`;
    }
  }
  // The tenant's rent, drawn as a note the agent issues: the amount is its denomination, the official IPC its security line,
  // the lease id its serial. web/app.js replays it once (index, charge, clause, paid); without JavaScript this is the final state.
  const demo = c ? html`<div class="demo" id="demo"${anim ? html` data-base="${anim.base}" data-amount="${anim.amount}" data-levels="${anim.levels}" data-months="${anim.months}"` : ""}><svg class="rosette" viewBox="-300 -300 600 600" aria-hidden="true" focusable="false"><use href="/guilloche.svg#ros"/></svg><div class="demo-top"><span class="who"><img src="/logo.svg" alt="" width="20" height="20">${s("Lo que ve el inquilino", "What the tenant sees")}</span>${statusChip(X, c.status)}</div><div class="mlabel">${s(`Alquiler de ${X.month(c.month, false)}`, `${X.month(c.month, false)} rent`)}</div><div class="amount">${X.ars(c.amount)}</div>${
    isDay(c.dueDate) ? html`<p class="due">${s(`Vence el ${X.dayMonth(c.dueDate)}`, `Due ${X.dayMonth(c.dueDate)}`)}${fin(d && d.pct) ? s(` · +${X.pctf(d.pct)} por IPC`, ` · +${X.pctf(d.pct)} by IPC`) : ""}</p>` : ""}${calcBox}${
    c.clauseCheck && c.clauseCheck.ok === true ? html`<p class="check">${icon("check")}<span>${s("Coincide con la cláusula (revisión paga en Celo)", "Matches the lease clause (paid check on Celo)")}</span></p>` : ""}<div class="demo-foot"><a href="${u(`/pagar/${SAMPLE_TENANT}`)}">${s("¿Por qué este monto?", "Why this amount?")}</a>${
    anim ? html`<button class="linkbtn" type="button" id="replay" hidden>${icon("replay")}${s("Recalcular", "Recalculate")}</button>` : ""}<span class="serial" aria-hidden="true">${s("N.º", "No.")} ${SAMPLE_TENANT}</span></div></div>` : "";
  const r = rec && fin(rec.received) && isDay(rec.paidAt) ? rec : null;
  const receipt = r ? html`<div class="rcpt"><div class="rcpt-top"><span class="chip ok seal">${icon("check")}${s("Liquidado en Celo", "Settled on Celo")}</span><a href="${u(`/recibo/${SAMPLE_RECEIPT.id}/${SAMPLE_RECEIPT.month}`)}">${s("Ver recibo", "View receipt")}</a></div><p>${s(
    `Recibo: ${X.ars(r.received)} cobrados el ${X.dayMonth(r.paidAt)}${r.index === "ICL" || r.index === "IPC" ? ` (${r.index})` : ""}; el propietario recibió ${payoutPhrase(X, r)}.`,
    `Receipt: ${X.ars(r.received)} collected on ${X.dayMonth(r.paidAt)}${r.index === "ICL" || r.index === "IPC" ? ` (${r.index})` : ""}; the landlord got ${payoutPhrase(X, r)}.`)}</p>${
    isTx(r.settleTx) ? html`<p class="hash">${s("Liquidación", "Settlement")} <a href="${txUrl(r.settleTx)}" rel="noopener" title="${r.settleTx}">${r.settleTx.slice(0, 10)}…${r.settleTx.slice(-6)}</a></p>` : ""}</div>` : "";
  const sample = c || r ? html`<p class="stage-cap">${s("Contrato y recibo de prueba nuestros, con índices oficiales reales.", "Our own test lease and receipt, with the real official indices.")} <a href="#real">${s("Qué es real hoy", "What is real today")}</a></p>` : "";
  const hero = html`<section class="hero" id="inicio"><div class="wrap hero-grid"><div class="h-copy"><h1>${s("El alquiler que se actualiza y se cobra solo.", "Rent that updates and collects itself.")}</h1><p class="lead">${s(
    "Para propietarios en Argentina: el agente calcula cada aumento con el índice oficial, cobra en pesos y te pasa a dólares la parte que elijas. Tu inquilino ve cuánto paga y por qué, y paga por transferencia, como siempre.",
    "For landlords in Argentina: the agent works out each increase from the official index, collects the rent in pesos and turns the share you choose into dollars. Your tenant sees what is due and why, and pays by bank transfer.")}</p>
<div class="h-act"><div class="ctas" id="hero-ctas"><a class="btn cta" href="${u("/probar")}">${s("Probalo en 2 minutos", "Try it in 2 minutes")}</a><a class="btn ghost" href="${u("/calculadora")}">${s("Calcular un aumento", "Work out an increase")}</a></div>
<p class="fine">${s("Pagás 1.000 wARS (unos US$ 0,60) a un contrato real en Celo y te vuelven 997 con su recibo.", "Pay 1,000 wARS (about US$0.60) into a real lease on Celo and get 997 back, with a receipt.")}</p>
<p class="proof"><a class="play" href="${LINKS.video}" rel="noopener">${icon("play")}${s("Ver el video (1:34)", "Watch the video (1:34)")}</a> · ${s("Agente en Celo", "Agent on Celo")} <a href="${LINKS.erc8004}" rel="noopener">ERC-8004 ${s(`n.º ${ONCHAIN.agentId}`, `#${ONCHAIN.agentId}`)}</a> · ${s("cada pago con comprobante en la red", "every payment with an onchain receipt")}</p></div></div>
<div class="h-vis"><div class="stage" id="stage">${demo}${receipt}</div>${sample}</div></div>
<div class="wrap"><ul class="metrics"><li class="metric"><b>${s("2 min", "2 min")}</b><span>${s("para probarlo con un alquiler real de 1.000 wARS en Celo", "to try it with a real 1,000 wARS rent on Celo")}</span></li><li class="metric"><b>${s("0,3 %", "0.3%")}</b><span>${s("de cada alquiler cobrado; la calculadora es gratis", "of each rent collected; the calculator is free")}</span></li><li class="metric"><b>IPC · ICL</b><span>${s("índices oficiales del INDEC y el BCRA", "official indices from INDEC and the BCRA")}</span></li><li class="metric"><b>${s(`n.º ${ONCHAIN.agentId}`, `#${ONCHAIN.agentId}`)}</b><span>${s("agente ERC-8004 en la red principal de Celo", "ERC-8004 agent on Celo mainnet")}</span></li></ul></div></section>`;

  // How it works, each step with a small picture built from the same sample lease and receipt.
  const terms = d ? termsFromDetail(d, pub.periodMonths) : null;
  const v1 = terms ? html`<div class="step-vis sv1" aria-hidden="true"><div class="sv-head">${icon("doc")}<span>${s("Contrato de locación", "Rental lease")}</span></div><div class="fr"><span>${s("Alquiler inicial", "Starting rent")}</span><b>${X.ars(terms.baseRent)}</b></div><div class="fr"><span>${s("Índice", "Index")}</span><b>${indexNames(X)[terms.index] || terms.index}</b></div><div class="fr"><span>${s("Aumenta", "Goes up")}</span><b>${((periods(X).find(([n]) => n === terms.periodMonths) || [0, ""])[1]).toLowerCase()}</b></div></div>` : "";
  const host = (() => { try { return new URL(origin).host; } catch { return "aldia.swiftbotlab.workers.dev"; } })();
  const v2 = c ? html`<div class="step-vis sv2" aria-hidden="true"><div class="url">${icon("link")}<span>${host}/pagar/${SAMPLE_TENANT}</span></div><div class="fr"><span>${s(`Alquiler de ${X.month(c.month, false)}`, `${X.month(c.month, false)} rent`)}</span><b>${X.ars(c.amount)}</b></div>${fin(d && d.pct) ? html`<div class="fr"><span>${s("Por qué", "Why")}</span><b>IPC +${X.pctf(d.pct)}</b></div>` : ""}</div>` : "";
  const v3 = r ? html`<div class="step-vis sv3" aria-hidden="true">${isTx(r.settleTx) ? html`<span class="chip ok seal stamp">${icon("check")}${s("Liquidado en Celo", "Settled on Celo")}</span>` : ""}<div class="fr"><span>${s("Cobrado", "Collected")}</span><b>${X.ars(r.received)}</b></div><div class="fr"><span>${s("Comisión Al Día", "Al Día fee")}</span><b>${X.ars(r.fee)}</b></div><div class="fr ok"><span>${s("Al propietario", "To the landlord")}</span><b>${payoutPhrase(X, r)}</b></div></div>` : "";
  const step = (k, title, body, vis) => html`<li class="st" data-step="${k}"><div class="st-text"><span class="num">${k}</span><h3>${title}</h3><p>${body}</p></div><div class="st-vis">${vis}</div></li>`;
  const steps = html`<section class="band how" id="como"><div class="wrap"><div class="sec-head"><h2>${s("Un contrato, un link y el recibo de cada mes", "One lease, one link, a receipt every month")}</h2><p>${s("El propietario carga el contrato una vez. Después el agente hace la cuenta, cobra y deja el comprobante.", "The landlord loads the lease once. From then on the agent does the maths, collects and leaves the proof.")}</p></div><div class="story-wrap"><span class="rail" aria-hidden="true"><i></i></span><ol class="story" aria-label="${s("Cómo funciona", "How it works")}">${
    step(1, s("Cargás el contrato", "You load the lease"), s("Monto, fecha de inicio, índice (IPC, ICL o un porcentaje fijo) y cada cuánto aumenta. Si lo tenés en PDF, lo leemos por vos.", "Amount, start date, index (IPC, ICL or a fixed percentage) and how often it goes up. If it is a PDF, we read it for you."), v1)}${
    step(2, s("Mandás un solo link", "You send one link"), s("Tu inquilino ve cuánto paga este mes, por qué y de dónde sale el número. Paga por transferencia desde su banco, como siempre.", "Your tenant sees what this month's rent is, why, and where the number comes from, and pays by bank transfer as usual."), v2)}${
    step(3, s("Cobrás como quieras", "You get paid your way"), s("Apenas entra el pago, el agente lo concilia, te manda la parte en pesos, pasa a dólares lo que elegiste y deja el recibo listo.", "As soon as the money arrives, the agent reconciles it, sends you the peso share, converts the share you chose to dollars and issues the receipt."), v3)}</ol></div></div></section>`;

  const n = (v) => (Number.isInteger(v) ? v : "—");
  const rampDone = o.rampPayments > 0;
  // The official sources and the cross-check, as a small wiring diagram (decorative; the list under it carries the words).
  const node = (x, y, w, a1, a2, cls = "") => html`<g class="nd${cls}" transform="translate(${x} ${y})"><rect width="${w}" height="44" rx="8"/><text x="${w / 2}" y="19" class="t1">${a1}</text><text x="${w / 2}" y="34" class="t2">${a2}</text></g>`;
  const diagram = html`<svg class="wires" viewBox="0 0 360 262" aria-hidden="true" focusable="false"><g class="ln"><path d="M58 52 C58 82 120 80 120 112"/><path d="M180 52 V112"/><path d="M150 156 C150 180 180 182 180 206"/><path d="M302 52 C302 140 300 200 236 226"/></g><g class="pl"><path d="M58 52 C58 82 120 80 120 112"/><path d="M180 52 V112"/><path d="M150 156 C150 180 180 182 180 206"/><path d="M302 52 C302 140 300 200 236 226"/></g>${
    node(6, 8, 104, "INDEC", "IPC")}${node(128, 8, 104, s("Min. Economía", "Ministry"), s("y BCRA: control", "and BCRA: check"))}${node(250, 8, 104, "BCRA", "ICL")}${
    node(70, 112, 160, s("¿Coinciden?", "Do they agree?"), s("si no, no hay cobro nuevo", "if not, no new charge"), " ck")}${node(124, 206, 112, s("Cobro del mes", "Month's charge"), s("con su fuente", "with its source"), " end")}</svg>`;
  const problem = html`<section class="band sources" id="fuentes"><div class="wrap two"><div class="src-copy"><h2>${s("Lo que deja de ser tu problema", "What stops being your problem")}</h2><p class="big">${s("Buscar el IPC del trimestre, hacer la cuenta, mandar el mensaje, mirar el banco para ver si pagó, armar el recibo y correr a comprar dólares antes de que se devalúe. Todo eso lo hace el agente, todos los meses, y lo deja a la vista de las dos partes.", "Looking up the quarter's IPC, doing the maths, sending the message, checking the bank to see whether the tenant paid, writing the receipt and rushing to buy dollars before the peso slides. The agent does all of that every month, in plain view of both sides.")}</p><div class="row"><a class="btn ghost" href="${u("/nuevo")}">${s("Cargar mi contrato", "Load my lease")}</a><a class="btn ghost" href="${u("/calculadora")}">${s("Calcular un aumento", "Work out an increase")}</a></div></div>
<div class="src-panel" id="diagram"><h3>${s("Solo fuentes oficiales", "Official sources only")}</h3>${diagram}<ul class="srcs"><li><span class="ic">${icon("chart")}</span><b>INDEC</b><span>${s("IPC nivel general nacional", "IPC, national general CPI")}</span></li><li><span class="ic">${icon("shield")}</span><b>${s("Ministerio de Economía y BCRA", "Ministry of Economy and BCRA")}</b><span>${s("Dos series oficiales más para controlar el IPC", "Two more official series to check the IPC")}</span></li><li><span class="ic">${icon("bank")}</span><b>BCRA</b><span>${s("ICL, Índice para Contratos de Locación", "ICL, the rental contracts index")}</span></li></ul><p class="src-note">${s("El cálculo usa solo fuentes oficiales: INDEC para el IPC y el BCRA para el ICL. El IPC del INDEC se compara con otras dos series oficiales (Ministerio de Economía y BCRA); si no coinciden, el agente no emite ningún cobro nuevo hasta que coincidan.", "Only official sources are used: INDEC for IPC and the central bank (BCRA) for ICL. INDEC's IPC is checked against two other official series (Ministry of Economy and BCRA); if they disagree, the agent issues no new charge until they match.")}</p></div></div></section>`;

  const row = (chip, body) => html`<li>${chip}<div>${body}</div></li>`;
  const real = html`<section class="band ledger-band" id="real"><div class="wrap"><div class="real"><div class="real-head"><h2>${s("Qué es real hoy", "What is real today")}</h2><p>${s("Sin letra chica: lo que funciona en la red, lo que es prueba nuestra y lo que todavía no se usó.", "No small print: what runs on chain, what is our own test and what nobody has used yet.")}</p></div><ul class="ledger">
${row(html`<span class="chip ok">${s("Red principal", "Mainnet")}</span>`, html`<b>${s("En la red principal de Celo, con wARS reales:", "On Celo mainnet, with real wARS:")}</b> ${s(`el agente (ERC-8004 n.º ${ONCHAIN.agentId}), sus contratos verificados y `, `the agent (ERC-8004 #${ONCHAIN.agentId}), its verified contracts and `)}${Number.isInteger(st.paymentsTest) && st.paymentsTest > 0 ? html`<span class="count" data-count="${st.paymentsTest}">${st.paymentsTest}</span>` : n(st.paymentsTest)}${s(" alquileres cobrados y liquidados, cada uno con su recibo y sus operaciones.", " rents collected and settled, each with its receipt and transactions.")}`)}
${row(html`<span class="chip mute">${s("Pruebas nuestras", "Our tests")}</span>`, html`<b>${s("Esos alquileres son pruebas nuestras.", "Those rents are our own tests.")}</b> ${counts ? testLeaseLine(X, counts, null) : s(`Los pagamos nosotros para probar el ciclo completo (${n(st.leasesTest)} contratos de prueba).`, `We paid them ourselves to run the full cycle (${n(st.leasesTest)} test leases).`)} ${s("Todavía no hay un propietario ni un inquilino reales.", "There is no real landlord or tenant yet.")}`)}
${row(html`<span class="chip info">${s(`Externos: ${o.count}`, `Outside: ${o.count}`)}</span>`, html`<b>${s(`Pagadores externos verificados: ${o.count}.`, `Verified outside payers: ${o.count}.`)}</b> ${s("Se cuentan solo después de un control automático en el explorador público de Celo.", "They are counted only after an automatic check on Celo's public explorer.")} <a href="${u("/transparencia#externos")}">${s("Ver la regla y la lista", "See the rule and the list")}</a>.`)}
${row(rampDone ? html`<span class="chip ok">${s("Verificado", "Verified")}</span>` : html`<span class="chip wait">${s("Sin uso real aún", "Not used for real yet")}</span>`, html`<b>${s("Pago por transferencia vía Ripio:", "Bank transfer through Ripio:")}</b> ${rampDone ? s(`${o.rampPayments} pago(s) verificados por este camino.`, `${o.rampPayments} verified payment(s) this way.`) : s("armado y conectado, pero ningún inquilino real lo completó todavía de punta a punta.", "built and wired in, but no real tenant has completed it end to end yet.")}`)}
${row(html`<span class="chip wait">${s("Con simulador", "Stub-tested")}</span>`, html`<b>MiniPay</b> ${s("probado con un simulador de billetera, todavía no dentro de MiniPay. El gas en dólares digitales está hecho y probado una vez, apagado en uso normal.", "tested with a wallet stub, not yet inside MiniPay. Gas paid in digital dollars is built and was tested once; it is off in normal running.")}`)}
</ul><p class="real-foot"><a href="${u("/transparencia")}">${s("Todo, con su fuente, en Transparencia", "Everything, with its source, on the Transparency page")}</a></p></div></div></section>`;
  const faq = [
    [s("¿Mi inquilino necesita saber de cripto?", "Does my tenant need to know about crypto?"), s("No. Paga por transferencia a través de Ripio, que convierte los pesos en wARS, un peso digital 1 a 1. La primera vez Ripio le pide validar su identidad.", "No. They pay by bank transfer through Ripio, which turns the pesos into wARS, a digital peso worth one peso. The first time, Ripio asks them to verify their identity.")],
    [s("¿Quién tiene la plata?", "Who holds the money?"), s("Cada contrato tiene su propia cuenta en la red Celo, un contrato inteligente que solo te puede pagar a vos. El alquiler nunca pasa por la billetera del agente; a ella solo va la comisión del 0,3 %. El agente puede repartir lo cobrado, pero no puede mandarlo a otro lado, y vos podés retirar todo o sacarlo del medio cuando quieras.", "Each lease has its own account on Celo, a smart contract that can only pay you. The rent never passes through the agent's wallet; only the 0.3% fee goes there. The agent can split what came in but cannot send it anywhere else, and you can withdraw everything or remove the agent at any time.")],
    [s("¿Qué necesito para cobrar?", "What do I need to get paid?"), s("Una billetera compatible con Celo, como MiniPay, Valora o MetaMask. Después podés pasar los pesos a tu banco con Ripio.", "A wallet that works on Celo, such as MiniPay, Valora or MetaMask. You can move the pesos to your bank with Ripio afterwards.")],
    [s("¿Cuánto cuesta?", "What does it cost?"), s("0,3 % de cada alquiler cobrado. Se descuenta solo y lo ves en cada recibo. Calcular aumentos con la calculadora es gratis.", "0.3% of each rent collected, taken automatically and shown on every receipt. The calculator is free.")],
    [s("¿Puedo usarlo con mi contrato actual?", "Can I use it with my current lease?"), s("Sí, si las dos partes están de acuerdo. Al Día no cambia el contrato: aplica lo que dice. Revisá que el índice y los meses que usamos coincidan con tu cláusula.", "Yes, if both sides agree. Al Día does not change the lease, it applies what it says. Check that the index and the months we use match your clause.")],
    [s("¿Qué pasa si el dólar se mueve fuerte?", "What if the dollar jumps?"), s("Cada conversión tiene un piso de precio que calcula el propio contrato. Si el mercado está por debajo, el agente no convierte y ese mes cobrás todo en pesos.", "Every conversion has a price floor computed by the lease contract itself. If the market is below it, the agent does not convert and you get everything in pesos that month.")],
    [s("¿Y si el pago entra incompleto?", "What if the payment comes in short?"), s("Queda en la cuenta del contrato y lo ves como pago parcial. El agente reparte cuando entra el resto, y vos podés retirarlo antes con tu billetera.", "It stays in the lease account and shows as part paid. The agent splits it when the rest arrives, and you can withdraw it earlier with your wallet.")],
    [s("¿Reemplaza la factura?", "Does it replace the invoice?"), s("No. El recibo de Al Día es un comprobante informativo. Lo que tengas que facturar o declarar lo seguís haciendo como siempre.", "No. Al Día's receipt is for information. Whatever you have to invoice or declare, you keep doing as usual.")],
  ];
  const faqHtml = html`<section class="band faq-band" id="preguntas"><div class="wrap faq-wrap"><div class="sec-head"><h2>${s("Lo que preguntan antes de empezar", "What people ask before they start")}</h2><p>${s("Propietarios e inquilinos, con respuestas cortas.", "Landlords and tenants, with short answers.")}</p></div><div class="faq">${faq.map(([q, a], i) => html`<details class="q"${i === 0 ? html` open` : ""}><summary>${q}</summary><p>${a}</p></details>`)}<details class="q"><summary>${s("¿Ya lo usa gente?", "Is anyone using it yet?")}</summary><p>${s("Estamos arrancando: mirá ", "We are just starting: see ")}<a href="#real">${s("qué es real hoy", "what is real today")}</a>${s(". En Transparencia publicamos cuántos contratos y pagos son reales y cuáles son pruebas nuestras.", ". The Transparency page shows how many leases and payments are real and which are our own tests.")}</p></details></div></div></section>`;
  const cta = html`<section class="band close-band"><div class="wrap"><div class="cta-band"><div class="stub" aria-hidden="true"><span>${s("Prueba abierta", "Open test")}</span><b>${s("1.000", "1,000")}</b><span>wARS</span></div><div class="cta-copy"><h2>${s("Probalo con tu propia billetera", "Try it with your own wallet")}</h2><p>${s("Un alquiler real de 1.000 wARS en Celo con vos como propietario: el agente lo cobra, lo liquida y te devuelve 997 con su recibo.", "A real 1,000 wARS rent on Celo with you as the landlord: the agent collects it, settles it and sends 997 back to you with a receipt.")}</p><div class="row"><a class="btn cta" href="${u("/probar")}">${s("Empezar la prueba", "Start the test")}</a><a class="btn ghost" href="${u("/calculadora")}">${s("Calculadora", "Calculator")}</a></div></div></div></div></section>
<div class="thumbbar" id="thumbbar"><a class="btn cta" href="${u("/probar")}">${s("Probalo en 2 minutos", "Try it in 2 minutes")}</a></div>`;
  return {
    title: s("Al Día · El alquiler que se actualiza y se cobra solo", "Al Día · Rent that updates and collects itself"),
    ogTitle: "Al Día",
    description: s("Para propietarios en Argentina: un agente en Celo calcula cada aumento con el índice oficial, cobra en pesos y deja el recibo. Probalo en 2 minutos con 1.000 wARS.",
      "For landlords in Argentina: an agent on Celo works out each increase from the official index, collects in pesos and issues the receipt. Try it in 2 minutes with 1,000 wARS."),
    home: true,
    body: html`${hero}${steps}${problem}${real}${faqHtml}${cta}`,
  };
}

// The calculator reads its inputs from the query string, so the form works as a plain GET form with no JavaScript.
export function calcInput(q) {
  const raw = {
    alquiler: str(q.get("alquiler") || "", 20),
    inicio: str(q.get("inicio") || "", 10),
    indice: ["IPC", "ICL", "FIJO"].includes(q.get("indice")) ? q.get("indice") : "IPC",
    cada: [1, 2, 3, 4, 6, 12].includes(Number(q.get("cada"))) ? Number(q.get("cada")) : 3,
    meses: [1, 2].includes(Number(q.get("meses"))) ? Number(q.get("meses")) : 2,
    pct: str(q.get("pct") || "", 8),
  };
  const base = parseInt(raw.alquiler.replace(/\D/g, ""), 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw.inicio) ? new Date(raw.inicio + "T00:00:00Z") : null;
  const dateOk = d && !isNaN(d) && d.toISOString().slice(0, 10) === raw.inicio && raw.inicio >= "2000-01-01" && raw.inicio <= "2100-12-31";
  if (!dateOk) raw.inicio = "";
  const pct = parseFloat(raw.pct.replace(",", "."));
  const lease = base > 0 && base <= 1e12 && dateOk
    ? { baseRent: base, startDate: raw.inicio, index: raw.indice, periodMonths: raw.cada, lagMonths: raw.meses, fixedPct: pct > 0 && pct <= 100 ? pct : 0 }
    : null;
  return { raw, lease };
}
const indexNames = (X) => ({ IPC: "IPC (INDEC)", ICL: "ICL (BCRA)", FIJO: X.s("Porcentaje fijo", "Fixed percentage") });
const periods = (X) => [[1, X.s("Todos los meses", "Every month")], [2, X.s("Cada 2 meses", "Every 2 months")], [3, X.s("Cada 3 meses", "Every 3 months")], [4, X.s("Cada 4 meses", "Every 4 months")], [6, X.s("Cada 6 meses", "Every 6 months")], [12, X.s("Cada 12 meses", "Every 12 months")]];

function calcResult(X, lease, idx) {
  const { s, u } = X;
  const m = nowMonth();
  const r = rentForMonth(lease, m, idx);
  if (!r) return html`<div class="note">${s("El contrato todavía no empezó.", "The lease has not started yet.")}</div>`;
  const next = addMonths(r.adjustmentMonth, lease.periodMonths);
  return html`<div class="card" id="calc-result"><div class="muted small">${s(`Alquiler de ${X.month(m)}`, `Rent for ${X.month(m)}`)}</div>${r.missing ? "" : html`<div class="amount">${X.ars(r.amount)}</div>`}${explainRent(X, r)}<p class="muted small" style="margin-top:12px">${s("Próximo aumento", "Next increase")}: ${X.month(next)}.</p><a class="btn block" href="${u("/nuevo")}">${s("Que se haga solo todos los meses", "Have it done for you every month")}</a></div>`;
}
// What the result column shows before there is a result. web/app.js draws the same box (calcEmpty) when inputs are cleared.
function calcEmpty(X, withExample) {
  const { s } = X;
  return html`<div class="card result-empty" id="calc-empty"><span class="ico">${icon("calc")}</span><h2 class="h3">${s("Tu resultado aparece acá", "Your result shows here")}</h2><p class="small muted">${s("Poné el alquiler inicial y la fecha de inicio: te mostramos el monto de este mes, cuánto aumentó y de dónde sale el número.", "Enter the starting rent and the start date: you get this month's amount, how much it went up and where the number comes from.")}</p>${
    withExample ? html`<a class="small" href="#ejemplo">${s("Ver un ejemplo resuelto", "See a worked example")} ↓</a>` : ""}</div>`;
}

// One worked example: the sample tenant's IPC rent, recomputed here from the official series and compared with the amount
// the agent charged. Shown only for a builder-test lease.
export function workedExample(pub, idx) {
  if (!pub || pub.builderTest !== true || !pub.current || !idx || !idx.ipc) return null;
  const d = pub.current.detail;
  const terms = termsFromDetail(d, pub.periodMonths);
  if (!terms) return null;
  const r = rentForMonth(terms, d.month, idx);
  if (!r || r.missing || !r.refFrom || !r.refTo) return null;
  const from = idx.ipc[r.refFrom];
  const to = idx.ipc[r.refTo];
  if (!fin(from) || !fin(to)) return null;
  return { terms, r, from, to, factor: to / from, agent: fin(pub.current.amount) ? pub.current.amount : null, label: str(pub.propertyLabel, 80), series: seriesBetween(idx.ipc, r.refFrom, r.refTo) };
}
function exampleCard(X, ex) {
  const { s, u } = X;
  if (!ex) return "";
  const { terms, r, from, to, factor, agent, label, series } = ex;
  const period = ((periods(X).find(([n]) => n === terms.periodMonths) || [0, ""])[1]).toLowerCase();
  return html`<section class="card" id="ejemplo"><div class="example"><div><h2>${s("Ejemplo resuelto", "Worked example")}</h2><p class="small muted">${s("El ", "The ")}<a href="${u(`/pagar/${SAMPLE_TENANT}`)}">${s("contrato de prueba", "test lease")}</a> «${agentText(X, label, 80)}»${s(", con los datos que publica el agente, recalculado acá con los índices oficiales.", ", from the data the agent publishes, recomputed here from the official indices.")}</p><dl class="kv"><dt>${s("Alquiler inicial", "Starting rent")}</dt><dd>${X.ars(terms.baseRent)}</dd><dt>${s("Inicio del contrato", "Lease start")}</dt><dd>${X.month(terms.startDate.slice(0, 7))}</dd><dt>${s("Índice", "Index")}</dt><dd>${indexNames(X).IPC}, ${period}</dd><dt>${s("Alquiler de", "Rent for")}</dt><dd>${X.month(r.month)}</dd></dl>${explainRent(X, r)}</div>
<div class="eq">${series ? html`<div class="calc-head"><span>${s("IPC nivel general, INDEC", "IPC, national, INDEC")}</span><b>+${X.pctf((factor - 1) * 100)}</b></div>${sparkSvg(series.levels)}<div class="spark-x"><span>${X.monthShort(series.months[0])}</span><span>${X.monthShort(series.months.at(-1))}</span></div>` : ""}<p class="lv"><span>${s(`IPC de ${X.month(r.refTo)}`, `IPC ${X.month(r.refTo)}`)}:</span> <b>${X.level(to)}</b></p><p class="lv"><span>${s(`IPC de ${X.month(r.refFrom)}`, `IPC ${X.month(r.refFrom)}`)}:</span> <b>${X.level(from)}</b></p><p class="lv"><span>${s("Factor", "Factor")}</span> <b>${X.level(to)} ÷ ${X.level(from)} = ${X.factor6(factor)}</b></p><p class="res">${X.ars(terms.baseRent)} × ${X.factor6(factor)} = <b>${X.ars(r.amount)}</b>${s(", redondeado al peso.", ", rounded to the peso.")}</p>${
    agent === null ? "" : html`<p class="small match" style="margin:14px 0 0">${agent === r.amount ? html`<span class="chip ok">${icon("check")}${s("Coincide", "Matches")}</span> ` : ""}${agent === r.amount ? s(`El agente cobró ${X.ars(agent)} en ese contrato: coincide.`, `The agent charged ${X.ars(agent)} on that lease: it matches.`) : s(`El agente publicó ${X.ars(agent)} para ese mes.`, `The agent published ${X.ars(agent)} for that month.`)}</p>`}</div></div></section>`;
}

async function pageCalc(env, url, X) {
  const { s } = X;
  const [idx, pub] = await Promise.all([kv(env, "indices"), kv(env, `pub:${SAMPLE_TENANT}`)]);
  const { raw, lease } = calcInput(url.searchParams);
  const indexOk = idx && idx.ipc && idx.icl && isMonth(idx.ipcLast);
  const ex = indexOk ? workedExample(pub, idx) : null;
  const opt = (list, cur) => list.map(([v, t]) => html`<option value="${v}"${String(v) === String(cur) ? html` selected` : ""}>${t}</option>`);
  const field = (label, control, hint, cls) => html`<div${cls ? html` class="${cls}"` : ""}><label>${label}${hint ? html`<span class="hint">${hint}</span>` : ""}${control}</label></div>`;
  const form = indexOk
    ? html`<form class="card" id="calc" method="get" action="/calculadora">${X.en ? html`<input type="hidden" name="lang" value="en">` : ""}<div class="fields">${
      field(s("Alquiler inicial del contrato", "Starting rent in the lease"), html`<input name="alquiler" inputmode="numeric" placeholder="${s("$ 500.000", "ARS 500,000")}" autocomplete="off" value="${raw.alquiler}">`)}${
      field(s("Fecha de inicio del contrato", "Lease start date"), html`<input name="inicio" type="date" value="${raw.inicio}">`)}${
      field(s("¿Con qué índice aumenta?", "Which index raises it?"), html`<select name="indice">${opt(Object.entries(indexNames(X)), raw.indice)}</select>`)}${
      field(s("¿Cada cuánto aumenta?", "How often does it go up?"), html`<select name="cada">${opt(periods(X), raw.cada)}</select>`)}${
      field(s("Meses de IPC", "IPC months"), html`<select name="meses">${opt([[2, s("El último publicado al inicio del mes (lo más común)", "The latest published at the start of the month (most common)")], [1, s("Incluye el mes anterior al aumento", "Includes the month before the increase")]], raw.meses)}</select>`, s("Solo para IPC.", "IPC only."), "full")}${
      field(s("Porcentaje de cada aumento", "Percentage of each increase"), html`<input name="pct" inputmode="decimal" placeholder="10" value="${raw.pct}">`, s("Solo si aumenta un porcentaje fijo.", "Only for a fixed percentage."), "full")}</div><button class="btn block" type="submit">${s("Calcular", "Calculate")}</button><p class="tiny foot-note">${s(`IPC disponible hasta ${X.month(idx.ipcLast)}. Datos leídos de INDEC y BCRA el ${str(idx.retrievedAt, 10)}.`, `IPC available up to ${X.month(idx.ipcLast)}. Data read from INDEC and BCRA on ${str(idx.retrievedAt, 10)}.`)}</p></form>`
    : html`<div class="card" id="calc"><div class="note err">${s("No pudimos traer los índices. Probá en un rato.", "We could not load the indices. Please try again later.")}</div></div>`;
  const out = indexOk ? (lease ? calcResult(X, lease, idx) : calcEmpty(X, !!ex)) : "";
  const body = html`<div class="phead"><p class="kicker">${s("IPC, ICL o porcentaje fijo", "IPC, ICL or a fixed percentage")}</p><h1>${s("Calculadora de aumento", "Rent increase calculator")}</h1><p>${s("Gratis y con datos oficiales. No hace falta registrarse.", "Free, official data, no sign-up.")}</p></div><div class="cols calc-page">${form}<div class="sticky" id="calc-out" aria-live="polite">${out}</div></div>${exampleCard(X, ex)}`;
  const exText = ex ? s(` Ejemplo resuelto: ${X.ars(ex.terms.baseRent)} desde ${X.month(ex.terms.startDate.slice(0, 7))} con IPC cada ${ex.terms.periodMonths} meses da ${X.ars(ex.r.amount)} en ${X.month(ex.r.month)}.`,
    ` Worked example: ${X.ars(ex.terms.baseRent)} from ${X.month(ex.terms.startDate.slice(0, 7))} with IPC every ${ex.terms.periodMonths} months gives ${X.ars(ex.r.amount)} in ${X.month(ex.r.month)}.`) : "";
  return {
    title: s("Calculadora de aumento de alquiler · Al Día", "Rent increase calculator · Al Día"),
    description: s(`Calculá el aumento de un alquiler por IPC (INDEC), ICL (BCRA) o un porcentaje fijo, con los índices oficiales.${exText}`, `Work out an Argentine rent increase by IPC (INDEC), ICL (BCRA) or a fixed percentage, from the official indices.${exText}`),
    body,
  };
}

// Use of the free calculator by visitors, from worker/calcstats.js. One sentence, the same on /transparencia (ES, EN).
export function calcUseLine(X, c) {
  if (!c || !Number.isInteger(c.calculations) || !Number.isInteger(c.pageViews)) return "";
  const since = X.en ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(CALC_SINCE + "T12:00:00Z")) : X.dayMonth(CALC_SINCE);
  const N = c.calculations;
  const M = c.pageViews;
  return X.s(`Calculadora: ${X.num(N)} ${N === 1 ? "cálculo" : "cálculos"} de visitantes desde el ${since} (${X.num(M)} ${M === 1 ? "visita" : "visitas"} a la página), contados sin guardar IP ni datos ingresados.`,
    `Calculator: ${X.num(N)} ${N === 1 ? "calculation" : "calculations"} by visitors since ${since} (${X.num(M)} page ${M === 1 ? "view" : "views"}), counted without storing IPs or inputs.`);
}
function calcUseCard(X, c) {
  const { s } = X;
  const line = calcUseLine(X, c);
  if (!line) return "";
  const b = c.byIndex || {};
  const mins = DEDUPE_MS / 60000;
  const capped = Array.isArray(c.cappedDays) ? c.cappedDays.length : 0;
  return html`<section class="card" id="uso-calculadora"><h2 class="h3">${s("Uso de la calculadora", "Calculator use")}</h2><p class="small" id="calc-uso">${line}</p><p class="tiny" style="margin:0">${s(
    `Por índice: IPC ${X.num(b.ipc)}, ICL ${X.num(b.icl)}, porcentaje fijo ${X.num(b.fijo)}. Cómo contamos: guardamos solo totales por día. Un cálculo es el formulario enviado con un alquiler y una fecha (funciona sin JavaScript) o un resultado de la calculadora en vivo, que avisa solo el tipo de índice. Cada visitante cuenta una vez por índice cada ${mins} minutos, y sus visitas una vez: para eso usamos un hash de la IP con una sal aleatoria, que vive ${mins} minutos en memoria y nunca se escribe. No contamos nuestras pruebas (?test=1), bots, navegadores sin pantalla, nuestros monitores ni el enlace de ejemplo que publicamos.`,
    `By index: IPC ${X.num(b.ipc)}, ICL ${X.num(b.icl)}, fixed percentage ${X.num(b.fijo)}. How we count: only daily totals are stored. A calculation is the form sent with a rent and a start date (works without JavaScript) or a result shown by the live calculator, which reports only the index type. Each visitor counts once per index every ${mins} minutes, and their page views once: for that we use a salted hash of the IP address that lives ${mins} minutes in memory and is never written down. Our own tests (?test=1), bots, headless browsers, our monitors and the example link we publish are left out.`)}${
    capped ? s(` En ${capped} ${capped === 1 ? "día" : "días"} el conteo se detuvo antes de terminar el día por el límite de escrituras.`, ` On ${capped} ${capped === 1 ? "day" : "days"} counting stopped early at the daily write limit.`) : ""} <a href="/api/calc-stats">${s("Totales por día (JSON)", "Daily totals (JSON)")}</a>.</p></section>`;
}

function rentsTable(X, rents) {
  const { s, u } = X;
  if (!rents.length) return "";
  return html`<section class="card wide" id="pruebas"><h2 class="h3">${s("Alquileres de prueba cobrados", "Test rents collected")}</h2><p class="small muted">${s("Los pagamos nosotros con wARS propios para probar el ciclo completo. Cada uno tiene su recibo y sus operaciones en la red Celo.", "We paid these ourselves with our own wARS to run the full cycle. Each one has its receipt and its Celo transactions.")}</p><table><tr><th>${s("Contrato", "Lease")}</th><th class="r">${s("Monto", "Amount")}</th><th class="r">${s("En Celo", "On Celo")}</th></tr>${rents.map((x) => html`<tr><td><a href="${u(x.receipt)}">${agentText(X, x.label, 80)}</a><br><span class="tiny">${X.month(x.month)}${x.route ? html` · ${agentText(X, x.route, 40)}` : ""}</span></td><td class="r">${X.ars(x.amount)}</td><td class="r"><span class="txl">${
    x.paymentTxs.map((t, i) => html`<a href="${txUrl(t)}" rel="noopener">${s("pago", "payment")}${x.paymentTxs.length > 1 ? " " + (i + 1) : ""}</a>`)}${x.settleTx ? html`<a href="${txUrl(x.settleTx)}" rel="noopener">${s("liquidación", "settlement")}</a>` : ""}${
    x.lease ? html`<a href="${addrUrl(x.lease)}" rel="noopener">${s("cuenta", "account")}</a>` : ""}</span></td></tr>`)}</table></section>`;
}

async function pageTransparency(env, X, waitUntil) {
  const { s } = X;
  const [s0, idx, rents, o0, health, cu] = await Promise.all([kv(env, "stats"), kv(env, "indices"), testRents(env), outsideSummary(env, waitUntil), kv(env, "health"), calcStats(env).catch(() => null)]);
  const o = cleanOutside(o0);
  const st = s0 || {};
  const n = (v) => (Number.isInteger(v) ? v : "—");
  const ipcLastOk = idx && isMonth(idx.ipcLast) && idx.ipc && idx.ipcMonthlyPct;
  const calls = st.paidCalls && Number.isInteger(st.paidCalls.count) ? st.paidCalls : null;
  const recent = calls && Array.isArray(calls.recent) ? calls.recent.filter((c) => c && typeof c === "object").slice(0, 20) : [];
  const leases = Array.isArray(st.leases) ? st.leases.filter((l) => l && typeof l === "object").slice(0, 12) : [];
  const counts = testLeaseCounts(st, rents);
  // Which of our test leases were paid: each settled receipt marks one lease with the same label, at most once.
  const paidLabels = rents.map((r) => r.label);
  const leasePaid = leases.map((l) => {
    const i = paidLabels.indexOf(str(l.label, 80));
    if (i < 0) return false;
    paidLabels.splice(i, 1);
    return true;
  });
  const at = health && isDay(health.at) ? str(health.at, 24).slice(0, 16).replace("T", " ") : null;
  const fresh = [at ? s(`el agente dio su última vuelta a las ${at} UTC`, `the agent's last check ran at ${at} UTC`) : null,
    o.checkedAt ? s(`la revisión de pagadores externos corrió a las ${o.checkedAt.slice(0, 16).replace("T", " ")} UTC`, `the outside-payer check ran at ${o.checkedAt.slice(0, 16).replace("T", " ")} UTC`) : null].filter(Boolean);
  const tile = (v, label) => html`<div class="stat"><b>${v}</b><span class="small muted">${label}</span></div>`;
  const body = html`<div class="phead"><p class="kicker">${s("Datos públicos, con su fuente", "Public data, with its source")}</p><h1>${s("Transparencia", "Transparency")}</h1><p>${s("Lo que se puede comprobar, con su fuente. Separamos lo nuestro de lo real.", "What can be checked, with its source. Our own tests are kept apart from real use.")}</p></div>${
    fresh.length ? html`<p class="fresh" id="fresh">${s("Al día: ", "Up to date: ")}${fresh.join(s("; ", "; "))}.</p>` : ""}<section class="stats">${
    tile(n(st.paymentsTest), s("alquileres de prueba nuestros, cobrados en Celo", "test rents of ours, collected on Celo"))}${
    tile(n(st.leasesTest), s("contratos de prueba nuestros", "test leases of ours"))}${
    tile(o.count, s("pagadores externos verificados", "verified outside payers"))}${
    tile(o.payments, s("pagos externos verificados", "verified outside payments"))}</section>
<div class="tgrid">
<section class="card"><h2 class="h3">${s("De dónde salen estos números", "Where these numbers come from")}</h2><p class="small">${s("Un pago cuenta como externo solo si pasa el control de abajo, que se hace solo con datos públicos de la red. Nuestras pruebas se cuentan aparte, como pruebas nuestras.", "A payment counts as outside only if it passes the check below, which uses public chain data alone. Our tests are counted separately, as ours.")}</p>${
    counts ? html`<p class="small" id="conteo">${testLeaseLine(X, counts, null)}</p>` : ""}${
    st.updatedAt ? html`<p class="tiny" style="margin:0">${s("Los números del agente cambiaron por última vez el", "The agent's numbers last changed on")} ${str(st.updatedAt, 30)}.</p>` : ""}</section>
${calcUseCard(X, cu)}
${outsideCard(X, o)}
${ipcLastOk ? html`<section class="card"><h2 class="h3">${s("Índices oficiales", "Official indices")}</h2><dl class="kv"><dt>${s("Último IPC", "Latest IPC")}</dt><dd>${X.month(idx.ipcLast)}: ${X.pctf(idx.ipcMonthlyPct[idx.ipcLast], 1)}</dd><dt>${s("Nivel", "Level")}</dt><dd>${fin(idx.ipc[idx.ipcLast]) ? new Intl.NumberFormat(X.loc).format(idx.ipc[idx.ipcLast]) : "—"}</dd><dt>${s("Controles", "Checks")}</dt><dd>${idx.ok ? s("Las fuentes coinciden", "The sources agree") : s("Hay una diferencia: el agente no emite aumentos", "They disagree: the agent issues no increase")}</dd><dt>${s("Leído el", "Read on")}</dt><dd>${str(idx.retrievedAt, 16).replace("T", " ")} UTC</dd></dl><p class="small muted" style="margin-top:10px">${s("IPC: archivo de INDEC, comparado contra la API de series del Ministerio de Economía y la variable 27 del BCRA. ICL: variable 40 del BCRA.", "IPC: INDEC's file, checked against the Ministry of Economy series API and BCRA variable 27. ICL: BCRA variable 40.")}</p></section>` : ""}
<section class="card"><h2 class="h3">${s("En la red", "On chain")}</h2><dl class="kv"><dt>${s("Agente", "Agent")}</dt><dd><a href="${LINKS.erc8004}" rel="noopener">ERC-8004 ${s(`n.º ${ONCHAIN.agentId}`, `#${ONCHAIN.agentId}`)}</a></dd><dt>${s("Billetera del agente", "Agent wallet")}</dt><dd><a href="${addrUrl(ONCHAIN.agentWallet)}" rel="noopener" class="mono">${short(ONCHAIN.agentWallet)}</a></dd><dt>${s("Fábrica de cuentas", "Lease factory")}</dt><dd><a href="${addrUrl(ONCHAIN.factory.toLowerCase())}" rel="noopener" class="mono">${short(ONCHAIN.factory.toLowerCase())}</a></dd></dl>${
    leases.length ? html`<table style="margin-top:10px">${leases.map((l, i) => html`<tr><td>${agentText(X, l.label, 80)}</td><td class="r">${agentText(X, l.kind, 40)}${counts ? (leasePaid[i] ? s(" · cobrado", " · paid") : s(" · sin pago", " · never paid")) : ""}</td></tr>`)}</table>` : ""}</section>
${rentsTable(X, rents)}
${calls ? html`<section class="card wide"><h2 class="h3">${s("Servicios que pagamos", "Services we paid for")}</h2><p class="small muted">${s(`${calls.count} llamadas pagas por x402 en Celo, por ${X.usd3(calls.usd)} en total, desde la billetera del agente.`, `${calls.count} paid x402 calls on Celo, ${X.usd3(calls.usd)} in total, from the agent wallet.`)}</p><table>${recent.map((c) => html`<tr><td>${agentText(X, c.service, 120)}</td><td class="r">${X.usd3(c.usd)}</td><td class="r">${isTx(c.tx) ? html`<a href="${txUrl(c.tx)}" rel="noopener" class="mono">${c.tx.slice(0, 8)}…</a>` : "—"}</td></tr>`)}</table></section>` : ""}
</div>`;
  const parts = [s(`Pagadores externos verificados: ${o.count}. Pagos externos verificados: ${o.payments}. Pruebas nuestras: ${n(st.leasesTest)} contratos y ${n(st.paymentsTest)} pagos.`,
    `Verified outside payers: ${o.count}. Verified outside payments: ${o.payments}. Our tests: ${n(st.leasesTest)} leases and ${n(st.paymentsTest)} payments.`)];
  if (calls) parts.push(s(`${calls.count} llamadas pagas por x402.`, `${calls.count} paid x402 calls.`));
  return {
    title: s("Transparencia · Al Día", "Transparency · Al Día"),
    description: `${parts.join(" ")} ${s(`Índices oficiales, agente ERC-8004 n.º ${ONCHAIN.agentId} y cada operación con su enlace a la red Celo.`, `Official indices, ERC-8004 agent #${ONCHAIN.agentId} and every transaction linked on Celo.`)}`.trim(),
    body,
  };
}

// The id of an open-test lease (made on /probar), or null. Read from the Worker's own record, never from the agent's.
export async function probarId(env, id) {
  const r = isId(id) ? await kv(env, `probar:${id}`) : null;
  return r && r.id === id ? id : null;
}

async function pagePay(env, id, X) {
  const { s, u } = X;
  const [pub, probar] = await Promise.all([kv(env, `pub:${id}`), probarId(env, id)]);
  if (!pub) {
    if (await env.KV.get(`lease:${id}`)) {
      return { title: s("Pagar alquiler · Al Día", "Pay rent · Al Día"), description: s("Estamos preparando este alquiler.", "We are setting up this rent."), noindex: true, refresh: 20, narrow: true,
        body: html`<h1>${s("Estamos preparando este alquiler", "We are setting up this rent")}</h1><p class="muted">${s("Tarda menos de dos minutos. Esta página se actualiza sola.", "It takes less than two minutes. This page refreshes by itself.")}</p>` };
    }
    return { status: 404, title: s("No encontramos este alquiler · Al Día", "We could not find this rent · Al Día"), description: s("Revisá el link que te pasaron.", "Check the link you were sent."), noindex: true,
      body: html`<h1>${s("No encontramos este alquiler", "We could not find this rent")}</h1><p class="muted">${s("Revisá el link que te pasaron.", "Check the link you were sent.")}</p>` };
  }
  const c = pub.current && typeof pub.current === "object" ? pub.current : null;
  const collector = isAddr(pub.collector) ? pub.collector : null;
  const label = agentText(X, pub.propertyLabel, 80);
  const amount = c && fin(c.amount) ? c.amount : null;
  const received = c && fin(c.received) ? c.received : 0;
  const open = c && c.status !== "pagado" && amount && !pub.closed;
  const owed = amount ? amount - received : 0;
  const det = c && c.detail && typeof c.detail === "object" ? c.detail : null;
  const history = Array.isArray(pub.history) ? pub.history.filter((x) => x && isMonth(x.month)).slice(0, 60) : [];
  const paid = history.filter((x) => x.status === "pagado");
  // A builder-test lease shows how a tenant sees the rent, but it must never invite a real payment: no pay buttons.
  const payBlock = !open || !collector ? "" : pub.builderTest === true
    ? html`<section class="note" id="no-pay"><b>${s("Contrato de prueba de Swift Bot Labs: no pagues acá.", "Swift Bot Labs test lease: do not pay here.")}</b> ${s("Muestra cómo ve su alquiler un inquilino, con un cálculo real; no hay propietario ni inquilino reales. Para probar un pago de verdad, usá la prueba abierta: pagás 1.000 wARS y te vuelven a tu billetera.", "It shows how a tenant sees the rent, with real arithmetic; there is no real landlord or tenant. To try a real payment, use the open test: you pay 1,000 wARS and they come back to your wallet.")}<div style="margin-top:10px"><a class="btn block" href="${u("/probar")}">${s("Probalo con 1.000 wARS", "Try it with 1,000 wARS")}</a></div></section>`
    : html`<section class="card"><h2 class="h3">${s("Cómo pagar", "How to pay")}</h2><a class="btn block" href="${rampUrl(owed, collector)}" rel="noopener">${s("Pagar por transferencia", "Pay by bank transfer")}</a><p class="small muted" style="margin-top:8px">${s("Te lleva a Ripio. Pagás en pesos desde tu banco o billetera y el pago llega directo a la cuenta de este alquiler. La primera vez Ripio te pide validar tu identidad.", "It takes you to Ripio. You pay in pesos from your bank or wallet and the payment goes straight to this rent's account. The first time, Ripio asks you to verify your identity.")}</p><div id="pay-wallet" data-id="${id}" data-collector="${collector}" data-owed="${owed}" data-lang="${X.lang}"></div><a class="btn ghost block" style="margin-top:10px" href="${`${BOT}?start=t_${id}`}" rel="noopener">${s("Avisame por Telegram cuando venza", "Remind me on Telegram when it is due")}</a></section>`;
  const body = html`${probar && !pub.builderTest ? html`<div class="note">${s("Prueba abierta de Al Día: quien paga es también el propietario, así que los wARS vuelven a su billetera, menos el 0,3 %.", "Al Día open test: the payer is also the landlord, so the wARS go back to their wallet, less 0.3%.")} <a href="${u(`/probar/${probar}`)}">${s("Ver los pasos", "See the steps")}</a>.</div>` : ""}${
    pub.closed ? html`<div class="note warn">${s("Este alquiler ya no se cobra por Al Día. Consultá con tu propietario antes de pagar.", "This rent is no longer collected through Al Día. Check with your landlord before paying.")}</div>` : ""}<div class="cols"><div class="stack"><section class="card doc"><div class="doc-head"><div><p class="kicker">${label}</p><h1>${c ? s(`Alquiler de ${X.month(c.month, false)}`, `${X.month(c.month, false)} rent`) : s("Alquiler", "Rent")}</h1></div>${c ? statusChip(X, c.status) : ""}</div>${
    c ? html`<div class="amount">${X.ars(open ? owed : amount)}</div>${open && isDay(c.dueDate) ? html`<p class="muted">${s(`Vence el ${X.dayMonth(c.dueDate)}.`, `Due ${X.dayMonth(c.dueDate)}.`)}</p>` : ""}${
      received && open ? html`<p class="small">${s(`Ya recibimos ${X.ars(received)} de ${X.ars(amount)}.`, `We have received ${X.ars(received)} of ${X.ars(amount)}.`)}</p>` : ""}<details${det && det.adjustments > 0 && det.adjustmentMonth === c.month ? html` open` : ""}><summary>${s("¿Por qué este monto?", "Why this amount?")}</summary>${explainRent(X, det)}</details>${clauseNote(X, c)}${
      isMonth(pub.nextAdjustment) ? html`<p class="small muted" style="margin:10px 0 0">${s("Próximo aumento", "Next increase")}: ${X.month(pub.nextAdjustment)}.</p>` : ""}` : ""}</section></div><aside class="stack">${payBlock}${
    pub.builderTest === true && !payBlock ? html`<div class="note">${s("Contrato de prueba de Swift Bot Labs: muestra cómo ve su alquiler un inquilino. No hay propietario ni inquilino reales.", "Swift Bot Labs test lease: it shows how a tenant sees the rent. There is no real landlord or tenant.")}</div>` : ""}${
    paid.length ? html`<section class="card"><h2 class="h3">${s("Recibos", "Receipts")}</h2><table>${paid.map((x) => html`<tr><td>${X.month(x.month)}</td><td class="r">${X.ars(x.amount)}</td><td class="r"><a href="${u(`/recibo/${id}/${x.month}`)}">${s("Ver", "View")}</a></td></tr>`)}</table></section>` : ""}${
    collector ? html`<p class="tiny">${s("Esta cuenta solo le puede pagar al propietario.", "This account can only pay the landlord.")} <a href="${addrUrl(collector)}" rel="noopener">${s("Ver la cuenta en Celo", "See the account on Celo")}</a>.</p>` : ""}</aside></div>`;
  const month = c ? X.month(c.month, false) : "";
  const descParts = [];
  if (c) {
    descParts.push(s(`Alquiler de ${month}: ${X.ars(open ? owed : amount)}, ${chipText(X, c.status).toLowerCase()}${open && isDay(c.dueDate) ? `, vence el ${X.dayMonth(c.dueDate)}` : ""}.`,
      `${month} rent: ${X.ars(open ? owed : amount)}, ${chipText(X, c.status).toLowerCase()}${open && isDay(c.dueDate) ? `, due ${X.dayMonth(c.dueDate)}` : ""}.`));
    if (det && det.adjustments > 0 && fin(det.pct)) descParts.push(s(`${det.index === "ICL" ? "ICL" : det.index === "IPC" ? "IPC" : "Aumento"}: +${X.pctf(det.pct)} desde el inicio, con el detalle del cálculo.`, `${det.index === "ICL" ? "ICL" : det.index === "IPC" ? "IPC" : "Increase"}: +${X.pctf(det.pct)} since the start, with the working shown.`));
  }
  if (pub.builderTest) descParts.push(s("Contrato de prueba de Swift Bot Labs.", "Swift Bot Labs test lease."));
  return {
    title: `${c ? s(`Alquiler de ${month} · `, `${month} rent · `) : ""}${label} · Al Día`,
    description: descParts.join(" ") || s("Cuánto pagás este mes, por qué y cómo pagar.", "What you pay this month, why, and how to pay."),
    body,
  };
}

// How the agent chose the venue for a receipt's dollar share, from the execution record it published. Mirrors
// agent/lease_ops.py plan_route: venues more than 1% apart = no conversion; else Textile if its firm quote clears the floor
// and beats Uniswap (or the builder test was set to exercise Textile); else Uniswap if it clears the floor.
function decisionCard(X, r, id, month) {
  const { s } = X;
  const e = r.execution && typeof r.execution === "object" ? r.execution : null;
  const n = (v) => (fin(v) && v >= 0 ? v : null);
  const head = html`<h2 class="h3">${s("Cómo decidió el agente", "How the agent decided")}</h2>`;
  const json = html`<p class="tiny" style="margin:10px 0 0"><a href="/api/recibo/${id}/${month}">${s("Los mismos datos en JSON", "The same data as JSON")}</a></p>`;
  if (!e) {
    if (fin(r.dollarToLandlord) && r.dollarToLandlord > 0) return "";
    return html`<section class="card" id="decision">${head}<p class="small" style="margin:0">${s("Este contrato cobra todo en pesos: no hubo conversión a dólares, así que no había que elegir dónde cambiar.", "This lease is paid out all in pesos: there was no dollar conversion, so no venue to choose.")}</p>${json}</section>`;
  }
  const floor = n(e.floor);
  const uni = n(e.uniswap);
  const prev = n(e.textilePreview);
  const firm = e.textileFirm && typeof e.textileFirm === "object" ? e.textileFirm : null;
  const firmAmt = firm && firm.ok === true ? n(firm.buyAmount) : null;
  const route = str(r.route, 40);
  let why;
  if (e.skipped === "venues disagree") why = s("Uniswap y Textile FX diferían en más de 1 %: uno de los dos estaba mal o lo estaban empujando, así que el agente no convirtió y ese mes pagó todo en pesos.", "Uniswap and Textile FX were more than 1% apart, so one of them was wrong or being pushed: the agent did not convert and paid everything in pesos that month.");
  else if (route === "Textile FX" && firmAmt !== null) {
    why = uni !== null && firmAmt < uni
      ? s("Uniswap ofrecía apenas más, pero en esta prueba nuestra el agente tenía que usar Textile FX para probar ese camino. El precio firme quedó por encima del piso.", "Uniswap offered slightly more, but this builder test was set to take Textile FX to exercise that path. The firm price was above the floor.")
      : s("El precio firme de Textile FX era el mejor y estaba por encima del piso.", "Textile FX's firm price was the best one and above the floor.");
  } else if (route === "Uniswap") {
    if (firm && firm.ok !== true) why = s(`Textile FX no dio un precio firme («${str(firm.reason, 160)}»), así que el agente cambió en Uniswap, por encima del piso.`, `Textile FX gave no firm price ("${str(firm.reason, 160)}"), so the agent swapped on Uniswap, above the floor.`);
    else why = s("Uniswap ofrecía más que Textile FX y estaba por encima del piso.", "Uniswap offered more than Textile FX and was above the floor.");
  } else why = s("Ningún precio llegaba al piso, así que el agente no convirtió.", "No price reached the floor, so the agent did not convert.");
  const rows = [[s("Piso que calcula el contrato", "Floor computed by the contract"), X.usdt6(floor)], ["Uniswap", X.usdt6(uni)], [s("Textile FX, indicativo", "Textile FX, indicative"), X.usdt6(prev)]];
  if (firm) rows.push([s("Textile FX, firme", "Textile FX, firm"), firmAmt !== null ? X.usdt6(firmAmt) : s("sin precio", "no price")]);
  rows.push([s("Elegido", "Chosen"), route ? agentText(X, route, 40) : "—"]);
  return html`<section class="card" id="decision">${head}<p class="small muted" style="margin:0 0 6px">${s("Para la parte en dólares, por los wARS que se convirtieron:", "For the dollar share, for the wARS that were converted:")}</p><dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl><p class="small" style="margin:10px 0 0">${why}</p><p class="tiny" style="margin:8px 0 0">${s("El piso es el más alto de los promedios de Uniswap de 30 minutos y de 4 horas, menos el margen que fijó el propietario. Lo calcula el contrato del alquiler, así que el agente no lo puede bajar.", "The floor is the higher of Uniswap's 30-minute and 4-hour averages, less the landlord's slippage limit. The lease contract computes it, so the agent cannot lower it.")}</p>${json}</section>`;
}

async function pageReceipt(env, id, month, X) {
  const { s, u } = X;
  const [r, probar] = await Promise.all([kv(env, `receipt:${id}:${month}`), probarId(env, id)]);
  if (!r) {
    return { status: 404, title: s("No hay recibo para ese mes · Al Día", "No receipt for that month · Al Día"), description: s("No hay recibo para ese mes.", "There is no receipt for that month."), noindex: true,
      body: html`<h1>${s("No hay recibo para ese mes", "No receipt for that month")}</h1>` };
  }
  const pays = [...(Array.isArray(r.paymentTxs) ? r.paymentTxs : []), ...(Array.isArray(r.paymentTxsLate) ? r.paymentTxsLate : [])].filter(isTx);
  const label = agentText(X, r.propertyLabel, 80);
  const rate = fin(r.rate) ? r.rate : null;
  const body = html`${probar && !r.builderTest ? html`<div class="note">${s("Recibo de una prueba abierta de Al Día: quien pagó es también el propietario.", "Receipt of an Al Día open test: the payer is also the landlord.")} <a href="${u(`/probar/${probar}`)}">${s("Ver los pasos", "See the steps")}</a>.</div>` : ""}<div class="cols"><section class="card doc"><div class="doc-head"><div><p class="kicker">${label}</p><h1>${s(`Recibo de ${X.month(month)}`, `Receipt for ${X.month(month)}`)}</h1></div>${isTx(r.settleTx) ? html`<span class="chip ok">${icon("check")}${s("Liquidado", "Settled")}</span>` : ""}</div><div class="amount">${X.ars(r.received)}</div><dl class="kv"><dt>${s("Alquiler del mes", "Rent for the month")}</dt><dd>${X.ars(r.amount)}</dd><dt>${s("Cobrado el", "Collected on")}</dt><dd>${X.dayMonth(r.paidAt)}</dd><dt>${s("Comisión Al Día", "Al Día fee")}</dt><dd>${X.ars(r.fee)}</dd><dt>${s("Al propietario en pesos", "To the landlord in pesos")}</dt><dd>${X.ars(r.pesoToLandlord)}</dd><dt>${s("Al propietario en dólares", "To the landlord in dollars")}</dt><dd>${fin(r.dollarToLandlord) && r.dollarToLandlord ? X.usd(r.dollarToLandlord) : "—"}</dd>${
    rate ? html`<dt>${s("Tipo de cambio", "Exchange rate")}</dt><dd>${X.ars2(rate)} ${s("por USD₮", "per USD₮")}</dd><dt>${s("Convertido en", "Converted on")}</dt><dd>${agentText(X, r.route, 40)}</dd>` : ""}</dl><details open><summary>${s("Cómo se calculó el monto", "How the amount was worked out")}</summary>${explainRent(X, r.detail)}</details><p class="small muted proofline" style="margin-top:14px">${s("Comprobantes en la red Celo", "Proof on Celo")}: ${
    pays.map((t, i) => html`<a href="${txUrl(t)}" rel="noopener">${s("pago", "payment")} ${i + 1}</a>, `)}${isTx(r.settleTx) ? html`<a href="${txUrl(r.settleTx)}" rel="noopener">${s("liquidación", "settlement")}</a>` : ""}</p><p class="tiny">${s("Huella del recibo", "Receipt fingerprint")}: <span class="mono">${str(r.receiptHash, 80)}</span></p><p class="tiny">${s("Comprobante informativo. No reemplaza la factura ni el recibo que corresponda según tu situación impositiva.", "For information. It does not replace the invoice or receipt your tax situation requires.")}</p><button class="btn ghost noprint" type="button" id="print" hidden>${s("Imprimir o guardar en PDF", "Print or save as PDF")}</button></section><aside class="stack">${
    decisionCard(X, r, id, month)}${r.builderTest ? html`<div class="note">${s("Recibo de prueba de Swift Bot Labs: este alquiler lo pagamos nosotros para probar el ciclo completo. No hay propietario ni inquilino reales.", "Swift Bot Labs test receipt: we paid this rent ourselves to run the full cycle. There is no real landlord or tenant.")}</div>` : ""}</aside></div>`;
  const desc = [s(`Cobrado ${X.ars(r.received)}${isDay(r.paidAt) ? ` el ${X.dayMonth(r.paidAt)}` : ""}.`, `Collected ${X.ars(r.received)}${isDay(r.paidAt) ? ` on ${X.dayMonth(r.paidAt)}` : ""}.`)];
  if (fin(r.pesoToLandlord)) desc.push(s(`Al propietario: ${X.ars(r.pesoToLandlord)}${fin(r.dollarToLandlord) && r.dollarToLandlord ? ` y ${X.usd(r.dollarToLandlord)}${r.route ? ` vía ${str(r.route, 40)}` : ""}` : ""}.`,
    `To the landlord: ${X.ars(r.pesoToLandlord)}${fin(r.dollarToLandlord) && r.dollarToLandlord ? ` and ${X.usd(r.dollarToLandlord)}${r.route ? ` via ${agentText(X, r.route, 40)}` : ""}` : ""}.`));
  desc.push(s("Con las operaciones de pago y liquidación en la red Celo.", "With the payment and settlement transactions on Celo."));
  if (r.builderTest) desc.push(s("Recibo de prueba.", "Test receipt."));
  return { title: `${s(`Recibo de ${X.month(month)}`, `Receipt for ${X.month(month)}`)} · ${label} · Al Día`, description: desc.join(" "), body };
}

function pageNew(X) {
  const { s, u } = X;
  return {
    title: s("Cargar contrato · Al Día", "Load a lease · Al Día"), narrow: true,
    description: s("Cargá tu contrato de alquiler en tres pasos: monto, índice y billetera. Si lo tenés en PDF, lo leemos en tu teléfono. Costo: 0,3 % de cada alquiler cobrado.",
      "Load your rental lease in three steps: amount, index and wallet. If it is a PDF, we read it on your phone. Cost: 0.3% of each rent collected."),
    body: html`<h1>${s("Cargá tu contrato", "Load your lease")}</h1><div class="card"><p>${s("Son tres pasos: los datos del contrato (monto, fecha de inicio, índice y cada cuánto aumenta), un nombre para la propiedad y la billetera donde cobrás. Si tenés el contrato en PDF, lo leemos en tu teléfono y completamos los datos para que los revises.", "Three steps: the lease terms (amount, start date, index and how often it goes up), a name for the property and the wallet you get paid in. If you have the lease as a PDF, we read it on your phone and fill in the terms for you to check.")}</p><p class="small muted">${s("El agente crea la cuenta del contrato en la red Celo recién cuando entra el primer pago.", "The agent deploys the lease account on Celo only when the first payment arrives.")}</p></div><div class="note">${s("Costo: 0,3 % de cada alquiler cobrado. Sin abono ni permanencia.", "Cost: 0.3% of each rent collected. No subscription, no lock-in.")}</div><noscript><div class="note warn">${s("Para cargar un contrato hace falta JavaScript. La ", "Loading a lease needs JavaScript. The ")}<a href="${u("/calculadora")}">${s("calculadora", "calculator")}</a>${s(" funciona sin él.", " works without it.")}</div></noscript>`,
  };
}

function pagePanel(X) {
  const { s } = X;
  return {
    title: s("Tu contrato · Al Día", "Your lease · Al Día"), narrow: true,
    description: s("Panel privado del propietario: el link para el inquilino, los avisos, cómo cobrás y el historial. Se abre solo con el link guardado.", "The landlord's private panel: the tenant link, reminders, how you get paid and the history. It opens only with the saved link."),
    noindex: true,
    body: html`<h1>${s("Tu contrato", "Your lease")}</h1><p class="muted">${s("Este panel es privado: se abre con el link que guardaste cuando creaste el contrato.", "This panel is private: it opens with the link you saved when you created the lease.")}</p><noscript><div class="note warn">${s("Para abrir el panel hace falta JavaScript: la clave de tu link privado se queda en tu teléfono y nunca llega a nuestro servidor.", "The panel needs JavaScript: the key in your private link stays on your phone and never reaches our server.")}</div></noscript>`,
  };
}

function pageMissing(X) {
  const { s, u } = X;
  return { status: 404, narrow: true, title: s("Esta página no existe · Al Día", "This page does not exist · Al Día"), description: s("Esta página no existe.", "This page does not exist."), noindex: true, ssr: false,
    body: html`<h1>${s("Esta página no existe", "This page does not exist")}</h1><p><a href="${u("/")}">${s("Volver al inicio", "Back to the start")}</a></p>` };
}

// Returns { status, html } for a page path. Unknown paths get a real 404.
export async function renderPage(url, env, waitUntil) {
  const path = url.pathname;
  const lang = langOf(url);
  const X = fmt(lang);
  let m;
  let page;
  if (path === "/") page = await pageHome(env, X, waitUntil, url.origin);
  else if (path === "/calculadora") page = await pageCalc(env, url, X);
  else if (path === "/nuevo") page = pageNew(X);
  else if (path === "/transparencia") page = await pageTransparency(env, X, waitUntil);
  else if ((m = path.match(/^\/pagar\/([0-9a-f]{12})$/))) page = await pagePay(env, m[1], X);
  else if ((m = path.match(/^\/panel\/([0-9a-f]{12})$/))) page = pagePanel(X);
  else if ((m = path.match(/^\/recibo\/([0-9a-f]{12})\/(\d{4}-(?:0[1-9]|1[0-2]))$/))) page = await pageReceipt(env, m[1], m[2], X);
  else page = pageMissing(X);
  return { status: page.status || 200, html: layout({ origin: url.origin, path, search: url.search, lang, ...page }) };
}

/* ---------- llms.txt ---------- */
// Plain text for language models and for judges who read without a browser. English, with the page names.
export async function renderLlms(url, env, waitUntil) {
  const o = url.origin;
  const [s0, idx, pub, rents, out0, cu] = await Promise.all([kv(env, "stats"), kv(env, "indices"), kv(env, `pub:${SAMPLE_TENANT}`), testRents(env), outsideSummary(env, waitUntil), calcStats(env).catch(() => null)]);
  const out = cleanOutside(out0);
  const s = s0 || {};
  const n = (v) => (Number.isInteger(v) ? String(v) : "unknown");
  const num = (v) => (fin(v) ? String(v) : "unknown");
  const ex = idx && idx.ipc ? workedExample(pub, idx) : null;
  const L = [];
  L.push("# Al Día", "");
  L.push("> Rent that updates and collects itself, in pesos, on Celo mainnet. A small landlord in Argentina loads a rental contract once. Every month the agent works out the rent from the official index (INDEC's IPC or the BCRA's ICL), the tenant pays in pesos, and the money lands as wARS in a contract made for that one lease, which can only pay the landlord. The agent reconciles the payment, converts the share the landlord chose into USD₮ at the better of Textile FX and Uniswap under a price floor the contract computes itself, and issues the receipt.", "");
  L.push("By Swift Bot Labs. The site is in Argentine Spanish by default and in English with ?lang=en on every page (toggle in the header), built for a phone. Every public page listed below is server-rendered HTML, readable without JavaScript; JavaScript only adds interaction (live calculator, wallet payment, PDF reading).", "");
  L.push("## Status, read live from the agent's published records");
  L.push(`- Outside payers so far: ${out.count} (verified payments: ${out.payments}; from a wallet: ${out.walletPayers}; by bank transfer through Ripio: ${out.rampPayers}). Counted automatically, before listing, from Celo's public explorer (Blockscout).`);
  L.push(`   - From a wallet: a settled rent paid straight from a wallet that is not ours, whose first funds did not come from one of our wallets, and whose first Celo activity is before ${CUTOFF_DAY}. We cannot tell who is behind a wallet, so each is listed as a "${PAYER_LABEL.en}".`);
  L.push(`   - By bank transfer through Ripio's ramp (the tenant path): Ripio's delivery wallet sent and signed the wARS transfer into the lease, the amount is within ${RAMP_TOLERANCE_PCT}% of the charge the tenant page asked for, and the landlord is not one of our wallets and never received anything from one of our wallets up to that payment. We have no Ripio account. One payer per landlord.`);
  L.push("   - Anything we cannot prove is not counted.");
  for (const p of out.payers) L.push(`   - ${short(p.address)}, paid ${p.date || "unknown"}, on Celo since ${p.firstSeen ? p.firstSeen.slice(0, 7) : "unknown"}: ${txUrl(p.tx)}${p.receipt ? ` , receipt ${o}${p.receipt}` : ""}`);
  for (const r of out.ramp) L.push(`   - Bank transfer through Ripio, ${r.wars === null ? "unknown" : r.wars} wARS, ${r.date || "unknown"}: ${txUrl(r.tx)}${r.receipt ? ` , receipt ${o}${r.receipt}` : ""}`);
  if (out.notCounted.length) L.push(`- Payments not counted: ${out.notCounted.length} (${[...new Set(out.notCounted.map((r) => REASONS.en[r.reason]))].join("; ")}).`);
  const tc = testLeaseCounts(s, rents);
  L.push(`- Builder-test leases: ${n(s.leasesTest)}. Builder-test payments: ${n(s.paymentsTest)}.${tc ? ` ${testLeaseLine(fmt("en"), tc, null).replace(/^\d+ test leases? of ours: /, "Of the leases, ")}` : ""}${tc ? "" : " We funded these payments from our own wallet;"} ${tc ? "They are" : "they are"} labelled as tests on every page and never counted as outside payers.`);
  if (cu && Number.isInteger(cu.calculations)) {
    const b = cu.byIndex || {};
    L.push(`- Free calculator use since ${CALC_SINCE}: ${cu.calculations} calculations by visitors (${cu.pageViews} page views without inputs; IPC ${n(b.ipc)}, ICL ${n(b.icl)}, fixed ${n(b.fijo)}), counted without storing IPs or inputs: daily totals only, one per visitor and index every ${DEDUPE_MS / 60000} minutes (a salted IP hash held in memory, never written), our own tests (?test=1), bots and monitors left out. Daily totals: ${o}/api/calc-stats`);
  }
  if (s.updatedAt) L.push(`- Agent stats last changed: ${str(s.updatedAt, 30)}.${out.checkedAt ? ` Outside payers checked: ${out.checkedAt.slice(0, 16).replace("T", " ")} UTC.` : ""}`);
  L.push(`- Open test, anyone with a Celo wallet: ${o}/probar?lang=en . Pay a real 1,000 wARS rent (about US$0.60) with your own address as the landlord, from a wallet or by bank transfer through Ripio; the agent settles it and 997 wARS come back to you (0.3% fee).`, "");
  L.push("## How to verify it on chain (Celo mainnet, chain id 42220)");
  L.push(`1. Agent identity: ERC-8004 agent ${ONCHAIN.agentId}, ${LINKS.erc8004} . Registered from the agent wallet as its first transaction: https://celoscan.io/tx/${ONCHAIN.identityTx}`);
  L.push(`2. Agent wallet: ${ONCHAIN.agentWallet}, ${addrUrl(ONCHAIN.agentWallet)} . Every transaction it sends carries the ERC-8021 attribution tag ${ONCHAIN.tag} at the end of its calldata.`);
  L.push(`3. Contracts, verified on Sourcify with an exact match: AlDiaFactory ${ONCHAIN.factory} (${addrUrl(ONCHAIN.factory)}) and the AlDiaLease implementation ${ONCHAIN.implementation} (${addrUrl(ONCHAIN.implementation)}). An earlier factory, ${ONCHAIN.oldFactory}, ran the first three test rents.`);
  L.push("4. What a lease contract cannot do, even with the agent's key: settle pays only the landlord plus a fee capped at 1%; a swap must return at least the higher of the Uniswap 30-minute and 4-hour TWAPs less the landlord's slippage limit; the landlord can withdraw everything or remove the agent at any time.");
  if (rents.length) {
    L.push("5. Test rents settled on mainnet, from the receipts the agent published (each receipt page also shows how the agent chose the venue: floor, Uniswap quote, Textile quotes, the venue chosen and why):");
    for (const x of rents) {
      const usdPart = x.dollarToLandlord ? `, ${num(x.dollarToLandlord)} USD₮ to the landlord via ${x.route || "unknown"}` : "";
      L.push(`   - ${agentText(fmt("en"), x.label, 80)} (${x.month}): ${num(x.amount)} wARS received, fee ${num(x.fee)}, ${num(x.pesoToLandlord)} wARS to the landlord${usdPart}.`);
      for (const t of x.paymentTxs) L.push(`     payment: ${txUrl(t)}`);
      if (x.settleTx) L.push(`     settlement: ${txUrl(x.settleTx)}`);
      if (x.lease) L.push(`     lease contract: ${addrUrl(x.lease)}`);
      L.push(`     receipt page: ${o}${x.receipt}?lang=en`);
    }
  }
  const calls = s.paidCalls && Number.isInteger(s.paidCalls.count) ? s.paidCalls : null;
  if (calls) {
    L.push(`6. Paid calls over x402 on Celo (through buy) from the agent wallet: ${calls.count} calls, ${num(calls.usd)} USD in total. Most recent:`);
    for (const c of (Array.isArray(calls.recent) ? calls.recent : []).slice(0, 20)) {
      if (c && typeof c === "object") L.push(`   - ${agentText(fmt("en"), c.service, 120)}: ${num(c.usd)} USD${isTx(c.tx) ? `, ${txUrl(c.tx)}` : ""}`);
    }
  }
  if (ex) {
    L.push(`7. Rent arithmetic: ${o}/calculadora shows a worked example. The sample tenant's contract (${ex.label}) starts at ${ex.terms.baseRent} pesos in ${ex.terms.startDate.slice(0, 7)} and moves with IPC every ${ex.terms.periodMonths} months. For ${ex.r.month}: IPC ${ex.r.refTo} (${ex.to}) / IPC ${ex.r.refFrom} (${ex.from}) = ${ex.factor.toFixed(6)}, so ${ex.terms.baseRent} x ${ex.factor.toFixed(6)} = ${ex.r.amount} pesos. The agent charged ${ex.agent === null ? "unknown" : ex.agent} pesos on that lease${ex.agent === ex.r.amount ? " (they match)" : ""}.`);
  }
  if (idx && isMonth(idx.ipcLast)) {
    L.push(`8. Official indices: latest IPC ${idx.ipcLast}, read ${str(idx.retrievedAt, 16)} UTC; sources ${idx.ok ? "agree" : "disagree, so the agent issues no new adjustment"}. IPC from INDEC, checked against the Ministry of Economy series API and BCRA variable 27; ICL from BCRA variable 40.`);
  }
  L.push("");
  L.push("## Pages (server-rendered; add ?lang=en for English)");
  L.push(`- Home: ${o}/?lang=en , what a tenant sees this month, a settled receipt, the 2-minute test, the video, and a "What is real today" panel.`);
  L.push(`- Transparency, proof page: ${o}/transparencia?lang=en , verified outside payers (and payments not counted, with the reason), official indices, agent identity, test rents and paid calls with their transactions.`);
  L.push(`- Open test: ${o}/probar?lang=en . Enter a Celo address, the site creates a 1,000 wARS test lease with that address as the landlord, you pay it (from a wallet, or by bank transfer through Ripio), the agent settles it and you get the receipt. Works without JavaScript; with a wallet in the browser it pays with one tap.`);
  L.push(`- Calculator: ${o}/calculadora?lang=en , free, official data, with the worked example above. Works without JavaScript as a GET form, e.g. ${o}/calculadora?alquiler=500000&inicio=2026-03-01&indice=IPC&cada=4&lang=en`);
  L.push(`- Sample tenant page: ${o}/pagar/${SAMPLE_TENANT}?lang=en , this month's rent, why it is that amount, how to pay. Rent raised by IPC, contract read from a PDF and the increase audited against its clause by a paid model call. A test lease, so it shows no pay button.`);
  L.push(`- Sample receipt: ${o}/recibo/${SAMPLE_RECEIPT.id}/${SAMPLE_RECEIPT.month}?lang=en , ICL rent settled through Textile FX, with payment and settlement transactions and the agent's venue decision.`);
  L.push(`- Create a lease: ${o}/nuevo?lang=en (needs JavaScript; the agent deploys the lease contract only when the first payment arrives).`, "");
  L.push("## Data (JSON, the same records the pages use)");
  L.push(`- ${o}/api/stats , ${o}/api/indices , ${o}/api/pruebas , ${o}/api/externos , ${o}/api/calc-stats`);
  L.push(`- ${o}/api/lease/<id> , ${o}/api/recibo/<id>/<YYYY-MM>`);
  L.push(`- ${o}/agent.json (ERC-8004 registration file)`, "");
  L.push("## Links");
  L.push(`- Source code: ${LINKS.repo}`);
  L.push(`- Demo video (1:34): ${LINKS.video}`, "");
  L.push("## Known limits");
  L.push(out.count ? `- Outside payers so far come from the open test at /probar, where the payer is also the landlord; there is no independent tenant-landlord pair yet.` : "- No outside payer has passed the check yet, and there is no independent tenant or landlord yet.");
  L.push(out.rampPayments ? `- ${out.rampPayments} payment(s) have arrived by bank transfer through Ripio's ramp.` : "- The tenant path through Ripio's bank-transfer ramp is built but not completed end to end: it needs an Argentine account and Ripio's KYC. Our tests pay wARS directly.");
  L.push("- Ripio's ramp delivery wallet (0x0f776cc057622f0da2f257d2b987a7cf3386b7cc) was identified from public chain data, not confirmed by Ripio.");
  L.push("- MiniPay payment is tested with a wallet stub, not yet inside MiniPay. Stablecoin gas (CIP-64) is implemented and tested once, off in normal running.");
  L.push("- Al Día is not an estate agent or a bank and does not replace a contract or legal or tax advice.");
  return L.join("\n") + "\n";
}
