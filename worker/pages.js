// Server-rendered pages for Al Día. The browser app (web/app.js) draws the same pages and takes over when JavaScript
// runs; these exist so every public page reads correctly without it: judges, crawlers, AI readers, slow phones.
// Rules: every dynamic value goes through html``, which escapes it; a link is built only from a value that passes a strict
// pattern; every figure comes from the records the agent publishes to KV (stats, indices, pub:, receipt:) or is computed
// from the official index series with the same rent.js the browser uses. Nothing here moves money or holds a key.
import { AlDiaRent } from "./rent.mjs";

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
const INDEX_NAMES = { IPC: "IPC (INDEC)", ICL: "ICL (BCRA)", FIJO: "Porcentaje fijo" };
const PERIODS = [[1, "Todos los meses"], [2, "Cada 2 meses"], [3, "Cada 3 meses"], [4, "Cada 4 meses"], [6, "Cada 6 meses"], [12, "Cada 12 meses"]];

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

/* ---------- checks and formats (same output as web/app.js) ---------- */
const fin = (n) => typeof n === "number" && Number.isFinite(n);
const str = (s, max = 200) => (typeof s === "string" ? s.slice(0, max) : "");
const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const isDay = (d) => typeof d === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.test(d);
export const isTx = (t) => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t);
export const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const txUrl = (t) => `https://celoscan.io/tx/${t}`;
const addrUrl = (a) => `https://celoscan.io/address/${a}`;
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const ars = (n) => (fin(n) ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n) : "—");
const pctf = (n, d = 2) => (fin(n) ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n) + " %" : "—");
const usd = (n) => (fin(n) ? "US$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n) : "—");
const usd3 = (n) => (fin(n) ? "US$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4, minimumFractionDigits: 2 }).format(n) : "—");
const level = (n) => (fin(n) ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(n) : "—");
const factor6 = (n) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(n);
const monthName = (ym, year = true) =>
  isMonth(ym) ? new Intl.DateTimeFormat("es-AR", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(ym + "-15T00:00:00Z")) : "";
const dayMonth = (d) => (isDay(d) ? new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d.slice(0, 10) + "T12:00:00Z")) : "");
const nowMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);

/* ---------- data: the KV records the app's own API serves ---------- */
// A short per-isolate memo so a burst of page views costs a few KV reads, not one per view. Tests set SSR_CACHE_MS=0.
const memo = new Map();
async function kv(env, key) {
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

/* ---------- page parts (mirror web/app.js) ---------- */
function layout({ origin, path, title, description, ogTitle, body, noindex = false, ssr = true }) {
  const canonical = origin + path;
  return html`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? html`<meta name="robots" content="noindex">
` : ""}<meta name="theme-color" content="#0b6b4f">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Al Día">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="${ogTitle || title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Al Día for language models">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="app"${ssr ? html` data-ssr="${path}"` : ""}>
<header class="top"><a class="brand" href="/" data-link="1"><img src="/logo.svg" alt="">Al Día</a><nav><a href="/calculadora" data-link="1">Calculadora</a><a href="/nuevo" data-link="1">Cargar contrato</a></nav></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap"><p>Al Día es un producto de Swift Bot Labs. No somos una inmobiliaria ni un banco, y este sitio no reemplaza tu contrato ni un asesoramiento legal o impositivo.</p><p><a href="/transparencia" data-link="1">Transparencia</a> · <a href="${LINKS.repo}" rel="noopener">Código abierto</a> · Índices: <a href="${INDEC_PAGE}" rel="noopener">INDEC</a> y <a href="${BCRA_PAGE}" rel="noopener">BCRA</a></p></div></footer>
</div>
<script src="/rent.js" defer></script>
<script src="/app.js" defer></script>
</body>
</html>
`.s;
}

function explainRent(r) {
  if (!r || typeof r !== "object") return "";
  if (r.missing) return html`<div class="note warn">Todavía no se publicó el ${str(r.missing, 40)}. El aumento se calcula apenas salga.</div>`;
  if (r.adjustments === 0) return html`<p class="muted">Sin aumentos todavía: este es el monto inicial del contrato.</p>`;
  const rows = [["Monto inicial", ars(r.baseRent)], ["Aumento acumulado", "+" + pctf(r.pct)]];
  if (r.stepPct !== undefined) rows.push(["Último aumento", "+" + pctf(r.stepPct)]);
  const used = Array.isArray(r.monthsUsed) ? r.monthsUsed.filter(isMonth) : [];
  if (used.length) rows.push(["Meses de IPC usados", used.map((m) => monthName(m, false)).join(", ") + " " + used.at(-1).slice(0, 4)]);
  const lv = (v) => (fin(v) ? String(v).replace(".", ",") : "—");
  if (r.index === "ICL") rows.push(["ICL usado", `${lv(r.levelFrom)} → ${lv(r.levelTo)}`]);
  return html`<div><dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>${
    r.index === "IPC" ? html`<p class="small muted" style="margin-top:10px">Fuente: <a href="${INDEC_PAGE}" rel="noopener">INDEC, IPC nivel general nacional</a>.</p>` : ""}${
    r.index === "ICL" ? html`<p class="small muted" style="margin-top:10px">Fuente: <a href="${BCRA_PAGE}" rel="noopener">BCRA, Índice para Contratos de Locación</a>.</p>` : ""}</div>`;
}

const CHIPS = { pagado: ["ok", "Pagado"], parcial: ["wait", "Pago parcial"], pendiente: ["wait", "Pendiente"], vencido: ["late", "Vencido"], "sin-indice": ["info", "Esperando índice"] };
const chipText = (st) => (CHIPS[st] || ["info", str(st, 20)])[1];
const statusChip = (st) => html`<span class="chip ${(CHIPS[st] || ["info"])[0]}">${chipText(st)}</span>`;
function clauseNote(c) {
  const k = c && c.clauseCheck;
  if (!k || typeof k !== "object") return "";
  return html`<p class="small" style="margin:10px 0 0">${k.ok ? "Revisamos este aumento contra la cláusula del contrato: coincide." : "Ojo: este aumento podría no coincidir con la cláusula del contrato. "}${
    k.ok ? "" : str(k.note, 400)}${isTx(k.tx) ? html` <a href="${txUrl(k.tx)}" rel="noopener">Ver la revisión paga en Celo</a>.` : ""}</p>`;
}

/* ---------- pages ---------- */
function pageHome() {
  const body = html`<section class="hero"><h1>El alquiler que se actualiza y se cobra solo.</h1><p>Cargás el contrato una vez. Cada mes calculamos el monto con el índice oficial, tu inquilino paga por transferencia y vos cobrás en pesos, en dólares o en las dos cosas.</p><div class="row"><a class="btn" href="/nuevo" data-link="1">Cargar mi contrato</a><a class="btn ghost" href="/calculadora" data-link="1">Calcular un aumento</a></div></section>
<section class="steps" aria-label="Cómo funciona"><div class="card"><span class="num">1</span><h3>Cargás el contrato</h3><p class="muted small">Monto, fecha de inicio, índice (IPC, ICL o un porcentaje fijo) y cada cuánto aumenta. Si lo tenés en PDF, lo leemos por vos.</p></div><div class="card"><span class="num">2</span><h3>Mandás un solo link</h3><p class="muted small">Tu inquilino ve cuánto paga este mes, por qué y de dónde sale el número. Paga por transferencia desde su banco, como siempre.</p></div><div class="card"><span class="num">3</span><h3>Cobrás como quieras</h3><p class="muted small">Apenas entra el pago, el agente lo concilia, te manda la parte en pesos, pasa a dólares lo que elegiste y deja el recibo listo.</p></div></section>
<section class="card"><h2>Lo que deja de ser tu problema</h2><p>Buscar el IPC del trimestre, hacer la cuenta, mandar el mensaje, mirar el banco para ver si pagó, armar el recibo y correr a comprar dólares antes de que se devalúe. Todo eso lo hace el agente, todos los meses, y lo deja a la vista de las dos partes.</p><p class="muted small">El cálculo usa solo fuentes oficiales: INDEC para el IPC y el BCRA para el ICL. Si esas fuentes no coinciden entre sí, el agente no emite el aumento hasta que se aclare.</p></section>
<section class="faq"><h2>Preguntas</h2><h3>¿Mi inquilino necesita saber de cripto?</h3><p class="muted">No. Paga por transferencia a través de Ripio, que convierte los pesos en wARS, un peso digital 1 a 1. La primera vez Ripio le pide validar su identidad.</p><h3>¿Quién tiene la plata?</h3><p class="muted">Cada contrato tiene su propia cuenta en la red Celo, un contrato inteligente que solo te puede pagar a vos. El agente puede repartir lo cobrado, pero no puede mandarlo a otro lado, y vos podés retirar todo o sacarlo del medio cuando quieras.</p><h3>¿Qué necesito para cobrar?</h3><p class="muted">Una billetera compatible con Celo, como MiniPay, Valora o MetaMask. Después podés pasar los pesos a tu banco con Ripio.</p><h3>¿Cuánto cuesta?</h3><p class="muted">0,3 % de cada alquiler cobrado. Se descuenta solo y lo ves en cada recibo. Calcular aumentos con la calculadora es gratis.</p><h3>¿Puedo usarlo con mi contrato actual?</h3><p class="muted">Sí, si las dos partes están de acuerdo. Al Día no cambia el contrato: aplica lo que dice. Revisá que el índice y los meses que usamos coincidan con tu cláusula.</p><h3>¿Qué pasa si el dólar se mueve fuerte?</h3><p class="muted">Cada conversión tiene un piso de precio que calcula el propio contrato. Si el mercado está por debajo, el agente no convierte y ese mes cobrás todo en pesos.</p><h3>¿Y si el pago entra incompleto?</h3><p class="muted">Queda en la cuenta del contrato y lo ves como pago parcial. El agente reparte cuando entra el resto, y vos podés retirarlo antes con tu billetera.</p><h3>¿Reemplaza la factura?</h3><p class="muted">No. El recibo de Al Día es un comprobante informativo. Lo que tengas que facturar o declarar lo seguís haciendo como siempre.</p><h3>¿Ya lo usa gente?</h3><p class="muted">Estamos arrancando. En <a href="/transparencia" data-link="1">Transparencia</a> publicamos cuántos contratos y pagos son reales y cuáles son pruebas nuestras.</p></section>`;
  return {
    title: "Al Día · El alquiler que se actualiza y se cobra solo",
    ogTitle: "Al Día",
    description: "Cargás el contrato una vez. Cada mes calculamos el monto con el índice oficial, tu inquilino paga por transferencia y vos cobrás en pesos o en dólares.",
    body,
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

function calcResult(lease, idx) {
  const m = nowMonth();
  const r = rentForMonth(lease, m, idx);
  if (!r) return html`<div class="note">El contrato todavía no empezó.</div>`;
  const next = addMonths(r.adjustmentMonth, lease.periodMonths);
  return html`<div class="card"><div class="muted small">Alquiler de ${monthName(m)}</div>${r.missing ? "" : html`<div class="amount">${ars(r.amount)}</div>`}${explainRent(r)}<p class="muted small" style="margin-top:12px">Próximo aumento: ${monthName(next)}.</p><a class="btn block" href="/nuevo" data-link="1">Que se haga solo todos los meses</a></div>`;
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
  return { terms, r, from, to, factor: to / from, agent: fin(pub.current.amount) ? pub.current.amount : null, label: str(pub.propertyLabel, 80) };
}
function exampleCard(ex) {
  if (!ex) return "";
  const { terms, r, from, to, factor, agent, label } = ex;
  const period = (PERIODS.find(([n]) => n === terms.periodMonths) || [0, ""])[1].toLowerCase();
  return html`<section class="card" id="ejemplo"><h2>Ejemplo resuelto</h2><p class="small muted">El <a href="/pagar/${SAMPLE_TENANT}" data-link="1">contrato de prueba</a> «${label}», con los datos que publica el agente, recalculado acá con los índices oficiales.</p><dl class="kv"><dt>Alquiler inicial</dt><dd>${ars(terms.baseRent)}</dd><dt>Inicio del contrato</dt><dd>${monthName(terms.startDate.slice(0, 7))}</dd><dt>Índice</dt><dd>${INDEX_NAMES.IPC}, ${period}</dd><dt>Alquiler de</dt><dd>${monthName(r.month)}</dd></dl><p class="small" style="margin:12px 0 4px">IPC de ${monthName(r.refTo)}: ${level(to)}<br>IPC de ${monthName(r.refFrom)}: ${level(from)}</p><p class="small" style="margin:0 0 4px">${level(to)} ÷ ${level(from)} = ${factor6(factor)}</p><p class="small" style="margin:0">${ars(terms.baseRent)} × ${factor6(factor)} = <b>${ars(r.amount)}</b>, redondeado al peso.</p>${explainRent(r)}${
    agent === null ? "" : html`<p class="small" style="margin:12px 0 0">${agent === r.amount ? html`El agente cobró ${ars(agent)} en ese contrato: coincide.` : html`El agente publicó ${ars(agent)} para ese mes.`}</p>`}</section>`;
}

async function pageCalc(env, url) {
  const [idx, pub] = await Promise.all([kv(env, "indices"), kv(env, `pub:${SAMPLE_TENANT}`)]);
  const { raw, lease } = calcInput(url.searchParams);
  const indexOk = idx && idx.ipc && idx.icl && isMonth(idx.ipcLast);
  const opt = (list, cur) => list.map(([v, t]) => html`<option value="${v}"${String(v) === String(cur) ? html` selected` : ""}>${t}</option>`);
  const field = (label, control, hint) => html`<div><label>${label}${hint ? html`<span class="hint">${hint}</span>` : ""}${control}</label></div>`;
  const form = indexOk
    ? html`<form class="card" id="calc" method="get" action="/calculadora">${
      field("Alquiler inicial del contrato", html`<input name="alquiler" inputmode="numeric" placeholder="$ 500.000" autocomplete="off" value="${raw.alquiler}">`)}${
      field("Fecha de inicio del contrato", html`<input name="inicio" type="date" value="${raw.inicio}">`)}${
      field("¿Con qué índice aumenta?", html`<select name="indice">${opt(Object.entries(INDEX_NAMES), raw.indice)}</select>`)}${
      field("¿Cada cuánto aumenta?", html`<select name="cada">${opt(PERIODS, raw.cada)}</select>`)}${
      field("Meses de IPC", html`<select name="meses">${opt([[2, "El último publicado al inicio del mes (lo más común)"], [1, "Incluye el mes anterior al aumento"]], raw.meses)}</select>`, "Solo para IPC.")}${
      field("Porcentaje de cada aumento", html`<input name="pct" inputmode="decimal" placeholder="10" value="${raw.pct}">`, "Solo si aumenta un porcentaje fijo.")}<button class="btn block" type="submit" style="margin-top:14px">Calcular</button><p class="tiny" style="margin:12px 0 0">IPC disponible hasta ${monthName(idx.ipcLast)}. Datos leídos de INDEC y BCRA el ${str(idx.retrievedAt, 10)}.</p></form>`
    : html`<div class="card" id="calc"><div class="note err">No pudimos traer los índices. Probá en un rato.</div></div>`;
  const ex = indexOk ? workedExample(pub, idx) : null;
  const body = html`<h1>Calculadora de aumento</h1><p class="muted">Gratis y con datos oficiales. No hace falta registrarse.</p>${form}${indexOk && lease ? calcResult(lease, idx) : ""}${exampleCard(ex)}`;
  const exText = ex ? ` Ejemplo resuelto: ${ars(ex.terms.baseRent)} desde ${monthName(ex.terms.startDate.slice(0, 7))} con IPC cada ${ex.terms.periodMonths} meses da ${ars(ex.r.amount)} en ${monthName(ex.r.month)}.` : "";
  return {
    title: "Calculadora de aumento de alquiler · Al Día",
    description: `Calculá el aumento de un alquiler por IPC (INDEC), ICL (BCRA) o un porcentaje fijo, con los índices oficiales.${exText}`,
    body,
  };
}

function rentsTable(rents) {
  if (!rents.length) return "";
  return html`<section class="card" id="pruebas"><h3>Alquileres de prueba cobrados</h3><p class="small muted">Los pagamos nosotros con wARS propios para probar el ciclo completo. Cada uno tiene su recibo y sus operaciones en la red Celo.</p><table><tr><th>Contrato</th><th class="r">Monto</th><th class="r">En Celo</th></tr>${rents.map((x) => html`<tr><td><a href="${x.receipt}" data-link="1">${x.label}</a><br><span class="tiny">${monthName(x.month)}${x.route ? html` · ${x.route}` : ""}</span></td><td class="r">${ars(x.amount)}</td><td class="r">${
    x.paymentTxs.map((t, i) => html`<a href="${txUrl(t)}" rel="noopener">pago${x.paymentTxs.length > 1 ? " " + (i + 1) : ""}</a><br>`)}${x.settleTx ? html`<a href="${txUrl(x.settleTx)}" rel="noopener">liquidación</a><br>` : ""}${
    x.lease ? html`<a href="${addrUrl(x.lease)}" rel="noopener">cuenta</a>` : ""}</td></tr>`)}</table></section>`;
}

async function pageTransparency(env) {
  const [s0, idx, rents] = await Promise.all([kv(env, "stats"), kv(env, "indices"), testRents(env)]);
  const s = s0 || {};
  const n = (v) => (Number.isInteger(v) ? v : "—");
  const ipcLastOk = idx && isMonth(idx.ipcLast) && idx.ipc && idx.ipcMonthlyPct;
  const calls = s.paidCalls && Number.isInteger(s.paidCalls.count) ? s.paidCalls : null;
  const recent = calls && Array.isArray(calls.recent) ? calls.recent.filter((c) => c && typeof c === "object").slice(0, 20) : [];
  const leases = Array.isArray(s.leases) ? s.leases.filter((l) => l && typeof l === "object").slice(0, 12) : [];
  const body = html`<h1>Transparencia</h1><p class="muted">Lo que se puede comprobar, con su fuente. Separamos lo nuestro de lo real.</p><section class="stats"><div class="stat"><b>${n(s.leasesThird)}</b><span class="small muted">contratos de terceros</span></div><div class="stat"><b>${n(s.paymentsThird)}</b><span class="small muted">pagos de terceros</span></div><div class="stat"><b>${n(s.leasesTest)}</b><span class="small muted">contratos de prueba nuestros</span></div><div class="stat"><b>${n(s.paymentsTest)}</b><span class="small muted">pagos de prueba nuestros</span></div></section>
<section class="card" style="margin-top:14px"><h3>De dónde salen estos números</h3><p class="small">${str(s.note, 600) || "Un pago cuenta como de terceros solo si los wARS no salieron de una billetera nuestra. Hasta que eso pase, todo lo que ves son pruebas hechas por nosotros."}</p>${s.updatedAt ? html`<p class="tiny">Actualizado: ${str(s.updatedAt, 30)}</p>` : ""}</section>
${ipcLastOk ? html`<section class="card"><h3>Índices oficiales</h3><dl class="kv"><dt>Último IPC</dt><dd>${monthName(idx.ipcLast)}: ${pctf(idx.ipcMonthlyPct[idx.ipcLast], 1)}</dd><dt>Nivel</dt><dd>${fin(idx.ipc[idx.ipcLast]) ? new Intl.NumberFormat("es-AR").format(idx.ipc[idx.ipcLast]) : "—"}</dd><dt>Controles</dt><dd>${idx.ok ? "Las fuentes coinciden" : "Hay una diferencia: el agente no emite aumentos"}</dd><dt>Leído el</dt><dd>${str(idx.retrievedAt, 16).replace("T", " ")} UTC</dd></dl><p class="small muted" style="margin-top:10px">IPC: archivo de INDEC, comparado contra la API de series del Ministerio de Economía y la variable 27 del BCRA. ICL: variable 40 del BCRA.</p></section>` : ""}
<section class="card"><h3>En la red</h3><dl class="kv"><dt>Agente</dt><dd><a href="${LINKS.erc8004}" rel="noopener">ERC-8004 n.º ${ONCHAIN.agentId}</a></dd><dt>Billetera del agente</dt><dd><a href="${addrUrl(ONCHAIN.agentWallet)}" rel="noopener" class="mono">${short(ONCHAIN.agentWallet)}</a></dd><dt>Fábrica de cuentas</dt><dd><a href="${addrUrl(ONCHAIN.factory.toLowerCase())}" rel="noopener" class="mono">${short(ONCHAIN.factory.toLowerCase())}</a></dd></dl>${
    leases.length ? html`<table style="margin-top:10px">${leases.map((l) => html`<tr><td>${str(l.label, 80)}</td><td class="r">${str(l.kind, 40)}</td></tr>`)}</table>` : ""}</section>
${rentsTable(rents)}
${calls ? html`<section class="card"><h3>Servicios que pagamos</h3><p class="small muted">${calls.count} llamadas pagas por x402 en Celo, por ${usd3(calls.usd)} en total, desde la billetera del agente.</p><table>${recent.map((c) => html`<tr><td>${str(c.service, 120)}</td><td class="r">${usd3(c.usd)}</td><td class="r">${isTx(c.tx) ? html`<a href="${txUrl(c.tx)}" rel="noopener">tx</a>` : "—"}</td></tr>`)}</table></section>` : ""}`;
  const parts = [];
  if (Number.isInteger(s.leasesThird)) parts.push(`Contratos de terceros: ${s.leasesThird}. Pagos de terceros: ${n(s.paymentsThird)}. Pruebas nuestras: ${n(s.leasesTest)} contratos y ${n(s.paymentsTest)} pagos.`);
  if (calls) parts.push(`${calls.count} llamadas pagas por x402.`);
  return {
    title: "Transparencia · Al Día",
    description: `${parts.join(" ")} Índices oficiales, agente ERC-8004 n.º ${ONCHAIN.agentId} y cada operación con su enlace a la red Celo.`.trim(),
    body,
  };
}

function testBanner(pub) {
  return pub.builderTest ? html`<div class="note warn">Este es un contrato de prueba de Swift Bot Labs para mostrar el producto. No hay propietario ni inquilino reales.</div>` : "";
}

async function pagePay(env, id) {
  const pub = await kv(env, `pub:${id}`);
  if (!pub) {
    if (await env.KV.get(`lease:${id}`)) {
      return { title: "Pagar alquiler · Al Día", description: "Estamos preparando este alquiler.", noindex: true,
        body: html`<h1>Estamos preparando este alquiler</h1><p class="muted">Tarda menos de dos minutos. Esta página se actualiza sola.</p>` };
    }
    return { status: 404, title: "No encontramos este alquiler · Al Día", description: "Revisá el link que te pasaron.", noindex: true,
      body: html`<h1>No encontramos este alquiler</h1><p class="muted">Revisá el link que te pasaron.</p>` };
  }
  const c = pub.current && typeof pub.current === "object" ? pub.current : null;
  const collector = isAddr(pub.collector) ? pub.collector : null;
  const label = str(pub.propertyLabel, 80);
  const amount = c && fin(c.amount) ? c.amount : null;
  const received = c && fin(c.received) ? c.received : 0;
  const open = c && c.status !== "pagado" && amount && !pub.closed;
  const owed = amount ? amount - received : 0;
  const det = c && c.detail && typeof c.detail === "object" ? c.detail : null;
  const history = Array.isArray(pub.history) ? pub.history.filter((x) => x && isMonth(x.month)).slice(0, 60) : [];
  const paid = history.filter((x) => x.status === "pagado");
  const body = html`${testBanner(pub)}${pub.closed ? html`<div class="note warn">Este alquiler ya no se cobra por Al Día. Consultá con tu propietario antes de pagar.</div>` : ""}<h1>${c ? `Alquiler de ${monthName(c.month, false)}` : "Alquiler"}</h1><p class="muted">${label}</p>${
    c ? html`<section class="card">${statusChip(c.status)}<div class="amount">${ars(open ? owed : amount)}</div>${open && isDay(c.dueDate) ? html`<p class="muted">Vence el ${dayMonth(c.dueDate)}.</p>` : ""}${
      received && open ? html`<p class="small">Ya recibimos ${ars(received)} de ${ars(amount)}.</p>` : ""}<details${det && det.adjustments > 0 && det.adjustmentMonth === c.month ? html` open` : ""}><summary>¿Por qué este monto?</summary>${explainRent(det)}</details>${clauseNote(c)}${
      isMonth(pub.nextAdjustment) ? html`<p class="small muted" style="margin:10px 0 0">Próximo aumento: ${monthName(pub.nextAdjustment)}.</p>` : ""}</section>` : ""}${
    open && collector ? html`<section><a class="btn block" href="${`https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=${owed}&address=${collector}`}" rel="noopener">Pagar por transferencia</a><p class="small muted" style="margin-top:8px">Te lleva a Ripio. Pagás en pesos desde tu banco o billetera y el pago llega directo a la cuenta de este alquiler. La primera vez Ripio te pide validar tu identidad.</p><a class="btn ghost block" style="margin-top:10px" href="${`${BOT}?start=t_${id}`}" rel="noopener">Avisame por Telegram cuando venza</a></section>` : ""}${
    paid.length ? html`<section class="card"><h3>Recibos</h3><table>${paid.map((x) => html`<tr><td>${monthName(x.month)}</td><td class="r">${ars(x.amount)}</td><td class="r"><a href="/recibo/${id}/${x.month}" data-link="1">Ver</a></td></tr>`)}</table></section>` : ""}${
    collector ? html`<p class="tiny">Esta cuenta solo le puede pagar al propietario. <a href="${addrUrl(collector)}" rel="noopener">Ver la cuenta en Celo</a>.</p>` : ""}`;
  const month = c ? monthName(c.month, false) : "";
  const descParts = [];
  if (c) {
    descParts.push(`Alquiler de ${month}: ${ars(open ? owed : amount)}, ${chipText(c.status).toLowerCase()}${open && isDay(c.dueDate) ? `, vence el ${dayMonth(c.dueDate)}` : ""}.`);
    if (det && det.adjustments > 0 && fin(det.pct)) descParts.push(`${det.index === "ICL" ? "ICL" : det.index === "IPC" ? "IPC" : "Aumento"}: +${pctf(det.pct)} desde el inicio, con el detalle del cálculo.`);
  }
  if (pub.builderTest) descParts.push("Contrato de prueba de Swift Bot Labs.");
  return {
    title: `${c ? `Alquiler de ${month} · ` : ""}${label} · Al Día`,
    description: descParts.join(" ") || "Cuánto pagás este mes, por qué y cómo pagar.",
    body,
  };
}

async function pageReceipt(env, id, month) {
  const r = await kv(env, `receipt:${id}:${month}`);
  if (!r) {
    return { status: 404, title: "No hay recibo para ese mes · Al Día", description: "No hay recibo para ese mes.", noindex: true,
      body: html`<h1>No hay recibo para ese mes</h1>` };
  }
  const pays = [...(Array.isArray(r.paymentTxs) ? r.paymentTxs : []), ...(Array.isArray(r.paymentTxsLate) ? r.paymentTxsLate : [])].filter(isTx);
  const label = str(r.propertyLabel, 80);
  const rate = fin(r.rate) ? r.rate : null;
  const body = html`${r.builderTest ? html`<div class="note warn">Recibo de prueba de Swift Bot Labs. No hay propietario ni inquilino reales.</div>` : ""}<section class="card"><h1>Recibo de ${monthName(month)}</h1><p class="muted">${label}</p><div class="amount">${ars(r.received)}</div><dl class="kv"><dt>Alquiler del mes</dt><dd>${ars(r.amount)}</dd><dt>Cobrado el</dt><dd>${dayMonth(r.paidAt)}</dd><dt>Comisión Al Día</dt><dd>${ars(r.fee)}</dd><dt>Al propietario en pesos</dt><dd>${ars(r.pesoToLandlord)}</dd><dt>Al propietario en dólares</dt><dd>${fin(r.dollarToLandlord) && r.dollarToLandlord ? usd(r.dollarToLandlord) : "—"}</dd>${
    rate ? html`<dt>Tipo de cambio</dt><dd>${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(rate)} por USD₮</dd><dt>Convertido en</dt><dd>${str(r.route, 40)}</dd>` : ""}</dl><details open><summary>Cómo se calculó el monto</summary>${explainRent(r.detail)}</details><p class="small muted" style="margin-top:14px">Comprobantes en la red Celo: ${
    pays.map((t, i) => html`<a href="${txUrl(t)}" rel="noopener">pago ${i + 1}</a>, `)}${isTx(r.settleTx) ? html`<a href="${txUrl(r.settleTx)}" rel="noopener">liquidación</a>` : ""}</p><p class="tiny">Huella del recibo: <span class="mono">${str(r.receiptHash, 80)}</span></p><p class="tiny">Comprobante informativo. No reemplaza la factura ni el recibo que corresponda según tu situación impositiva.</p></section>`;
  const desc = [`Cobrado ${ars(r.received)}${isDay(r.paidAt) ? ` el ${dayMonth(r.paidAt)}` : ""}.`];
  if (fin(r.pesoToLandlord)) desc.push(`Al propietario: ${ars(r.pesoToLandlord)}${fin(r.dollarToLandlord) && r.dollarToLandlord ? ` y ${usd(r.dollarToLandlord)}${r.route ? ` vía ${str(r.route, 40)}` : ""}` : ""}.`);
  desc.push("Con las operaciones de pago y liquidación en la red Celo.");
  if (r.builderTest) desc.push("Recibo de prueba.");
  return { title: `Recibo de ${monthName(month)} · ${label} · Al Día`, description: desc.join(" "), body };
}

function pageNew() {
  return {
    title: "Cargar contrato · Al Día",
    description: "Cargá tu contrato de alquiler en tres pasos: monto, índice y billetera. Si lo tenés en PDF, lo leemos en tu teléfono. Costo: 0,3 % de cada alquiler cobrado.",
    body: html`<h1>Cargá tu contrato</h1><div class="card"><p>Son tres pasos: los datos del contrato (monto, fecha de inicio, índice y cada cuánto aumenta), un nombre para la propiedad y la billetera donde cobrás. Si tenés el contrato en PDF, lo leemos en tu teléfono y completamos los datos para que los revises.</p><p class="small muted">El agente crea la cuenta del contrato en la red Celo recién cuando entra el primer pago.</p></div><div class="note">Costo: 0,3 % de cada alquiler cobrado. Sin abono ni permanencia.</div><noscript><div class="note warn">Para cargar un contrato hace falta JavaScript. La <a href="/calculadora">calculadora</a> funciona sin él.</div></noscript>`,
  };
}

function pagePanel() {
  return {
    title: "Tu contrato · Al Día",
    description: "Panel privado del propietario: el link para el inquilino, los avisos, cómo cobrás y el historial. Se abre solo con el link guardado.",
    noindex: true,
    body: html`<h1>Tu contrato</h1><p class="muted">Este panel es privado: se abre con el link que guardaste cuando creaste el contrato.</p><noscript><div class="note warn">Para abrir el panel hace falta JavaScript: la clave de tu link privado se queda en tu teléfono y nunca llega a nuestro servidor.</div></noscript>`,
  };
}

function pageMissing() {
  return { status: 404, title: "Esta página no existe · Al Día", description: "Esta página no existe.", noindex: true, ssr: false,
    body: html`<h1>Esta página no existe</h1><p><a href="/" data-link="1">Volver al inicio</a></p>` };
}

// Returns { status, html } for a page path. Unknown paths get a real 404.
export async function renderPage(url, env) {
  const path = url.pathname;
  let m;
  let page;
  if (path === "/") page = pageHome();
  else if (path === "/calculadora") page = await pageCalc(env, url);
  else if (path === "/nuevo") page = pageNew();
  else if (path === "/transparencia") page = await pageTransparency(env);
  else if ((m = path.match(/^\/pagar\/([0-9a-f]{12})$/))) page = await pagePay(env, m[1]);
  else if ((m = path.match(/^\/panel\/([0-9a-f]{12})$/))) page = pagePanel();
  else if ((m = path.match(/^\/recibo\/([0-9a-f]{12})\/(\d{4}-(?:0[1-9]|1[0-2]))$/))) page = await pageReceipt(env, m[1], m[2]);
  else page = pageMissing();
  return { status: page.status || 200, html: layout({ origin: url.origin, path, ...page }) };
}

/* ---------- llms.txt ---------- */
// Plain text for language models and for judges who read without a browser. English, with the Spanish page names.
export async function renderLlms(url, env) {
  const o = url.origin;
  const [s0, idx, pub, rents] = await Promise.all([kv(env, "stats"), kv(env, "indices"), kv(env, `pub:${SAMPLE_TENANT}`), testRents(env)]);
  const s = s0 || {};
  const n = (v) => (Number.isInteger(v) ? String(v) : "unknown");
  const num = (v) => (fin(v) ? String(v) : "unknown");
  const ex = idx && idx.ipc ? workedExample(pub, idx) : null;
  const L = [];
  L.push("# Al Día", "");
  L.push("> Rent that updates and collects itself, in pesos, on Celo mainnet. A small landlord in Argentina loads a rental contract once. Every month the agent works out the rent from the official index (INDEC's IPC or the BCRA's ICL), the tenant pays in pesos, and the money lands as wARS in a contract made for that one lease, which can only pay the landlord. The agent reconciles the payment, converts the share the landlord chose into USD₮ at the better of Textile FX and Uniswap under a price floor the contract computes itself, and issues the receipt.", "");
  L.push("By Swift Bot Labs. The site is in Argentine Spanish and built for a phone. Every public page listed below is server-rendered HTML, readable without JavaScript; JavaScript only adds interaction (live calculator, wallet payment, PDF reading).", "");
  L.push("## Status, read live from the agent's published records");
  L.push(`- Leases from third parties: ${n(s.leasesThird)}. Payments from third parties: ${n(s.paymentsThird)}.`);
  L.push(`- Builder-test leases: ${n(s.leasesTest)}. Builder-test payments: ${n(s.paymentsTest)}. We funded these payments from our own wallet; they are labelled as tests on every page.`);
  if (s.updatedAt) L.push(`- Stats updated: ${str(s.updatedAt, 30)}.`);
  L.push("- A payment counts as third-party only when its wARS come from a wallet that is not ours. No independent user has paid yet.", "");
  L.push("## How to verify it on chain (Celo mainnet, chain id 42220)");
  L.push(`1. Agent identity: ERC-8004 agent ${ONCHAIN.agentId}, ${LINKS.erc8004} . Registered from the agent wallet as its first transaction: https://celoscan.io/tx/${ONCHAIN.identityTx}`);
  L.push(`2. Agent wallet: ${ONCHAIN.agentWallet}, ${addrUrl(ONCHAIN.agentWallet)} . Every transaction it sends carries the ERC-8021 attribution tag ${ONCHAIN.tag} at the end of its calldata.`);
  L.push(`3. Contracts, verified on Sourcify with an exact match: AlDiaFactory ${ONCHAIN.factory} (${addrUrl(ONCHAIN.factory)}) and the AlDiaLease implementation ${ONCHAIN.implementation} (${addrUrl(ONCHAIN.implementation)}). An earlier factory, ${ONCHAIN.oldFactory}, ran the first three test rents.`);
  L.push("4. What a lease contract cannot do, even with the agent's key: settle pays only the landlord plus a fee capped at 1%; a swap must return at least the higher of the Uniswap 30-minute and 4-hour TWAPs less the landlord's slippage limit; the landlord can withdraw everything or remove the agent at any time.");
  if (rents.length) {
    L.push("5. Test rents settled on mainnet, from the receipts the agent published:");
    for (const x of rents) {
      const usdPart = x.dollarToLandlord ? `, ${num(x.dollarToLandlord)} USD₮ to the landlord via ${x.route || "unknown"}` : "";
      L.push(`   - ${x.label} (${x.month}): ${num(x.amount)} wARS received, fee ${num(x.fee)}, ${num(x.pesoToLandlord)} wARS to the landlord${usdPart}.`);
      for (const t of x.paymentTxs) L.push(`     payment: ${txUrl(t)}`);
      if (x.settleTx) L.push(`     settlement: ${txUrl(x.settleTx)}`);
      if (x.lease) L.push(`     lease contract: ${addrUrl(x.lease)}`);
      L.push(`     receipt page: ${o}${x.receipt}`);
    }
  }
  const calls = s.paidCalls && Number.isInteger(s.paidCalls.count) ? s.paidCalls : null;
  if (calls) {
    L.push(`6. Paid calls over x402 on Celo (through buy) from the agent wallet: ${calls.count} calls, ${num(calls.usd)} USD in total. Most recent:`);
    for (const c of (Array.isArray(calls.recent) ? calls.recent : []).slice(0, 20)) {
      if (c && typeof c === "object") L.push(`   - ${str(c.service, 120)}: ${num(c.usd)} USD${isTx(c.tx) ? `, ${txUrl(c.tx)}` : ""}`);
    }
  }
  if (ex) {
    L.push(`7. Rent arithmetic: ${o}/calculadora shows a worked example. The sample tenant's contract (${ex.label}) starts at ${ex.terms.baseRent} pesos in ${ex.terms.startDate.slice(0, 7)} and moves with IPC every ${ex.terms.periodMonths} months. For ${ex.r.month}: IPC ${ex.r.refTo} (${ex.to}) / IPC ${ex.r.refFrom} (${ex.from}) = ${ex.factor.toFixed(6)}, so ${ex.terms.baseRent} x ${ex.factor.toFixed(6)} = ${ex.r.amount} pesos. The agent charged ${ex.agent === null ? "unknown" : ex.agent} pesos on that lease${ex.agent === ex.r.amount ? " (they match)" : ""}.`);
  }
  if (idx && isMonth(idx.ipcLast)) {
    L.push(`8. Official indices: latest IPC ${idx.ipcLast}, read ${str(idx.retrievedAt, 16)} UTC; sources ${idx.ok ? "agree" : "disagree, so the agent issues no new adjustment"}. IPC from INDEC, checked against the Ministry of Economy series API and BCRA variable 27; ICL from BCRA variable 40.`);
  }
  L.push("");
  L.push("## Pages (server-rendered, Spanish)");
  L.push(`- Transparency, proof page: ${o}/transparencia , counts of real vs test use, official indices, agent identity, test rents and paid calls with their transactions.`);
  L.push(`- Calculator: ${o}/calculadora , free, official data, with the worked example above. Works without JavaScript as a GET form, e.g. ${o}/calculadora?alquiler=500000&inicio=2026-03-01&indice=IPC&cada=4`);
  L.push(`- Sample tenant page: ${o}/pagar/${SAMPLE_TENANT} , this month's rent, why it is that amount, how to pay. Rent raised by IPC, contract read from a PDF and the increase audited against its clause by a paid model call.`);
  L.push(`- Sample receipt: ${o}/recibo/${SAMPLE_RECEIPT.id}/${SAMPLE_RECEIPT.month} , ICL rent settled through Textile FX, with payment and settlement transactions.`);
  L.push(`- Home and FAQ: ${o}/`);
  L.push(`- Create a lease: ${o}/nuevo (needs JavaScript; the agent deploys the lease contract only when the first payment arrives).`, "");
  L.push("## Data (JSON, the same records the pages use)");
  L.push(`- ${o}/api/stats , ${o}/api/indices , ${o}/api/pruebas`);
  L.push(`- ${o}/api/lease/<id> , ${o}/api/recibo/<id>/<YYYY-MM>`);
  L.push(`- ${o}/agent.json (ERC-8004 registration file)`, "");
  L.push("## Links");
  L.push(`- Source code: ${LINKS.repo}`);
  L.push(`- Demo video (1:34): ${LINKS.video}`, "");
  L.push("## Known limits");
  L.push("- No independent tenant or landlord yet.");
  L.push("- The tenant path through Ripio's bank-transfer ramp is built but not completed end to end: it needs an Argentine account and Ripio's KYC. Our tests pay wARS directly.");
  L.push("- MiniPay payment is tested with a wallet stub, not yet inside MiniPay. Stablecoin gas (CIP-64) is implemented and tested once, off in normal running.");
  L.push("- Al Día is not an estate agent or a bank and does not replace a contract or legal or tax advice.");
  return L.join("\n") + "\n";
}
