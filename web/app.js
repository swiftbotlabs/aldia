"use strict";
/* Al Día front end. No framework and no user text goes through innerHTML: h() builds nodes and text stays text.
   The Worker renders every public page (Spanish, or English with ?lang=en). This file only adds what needs a browser:
   wallet buttons, the live calculator, the lease form, the private landlord panel and the open test's live state. */
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const TAG_SUFFIX = "63656c6f5f326565303237303461353664110080218021802180218021802180218021"; // ERC-8021: celo_2ee02704a56d
const LEASE_URL = (a) => `https://celoscan.io/address/${a}`;
const TX_URL = (t) => `https://celoscan.io/tx/${t}`;
const INDEC_PAGE = "https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31";
const BCRA_PAGE = "https://www.bcra.gob.ar/estadisticas-indicadores/";
const REPO = "https://github.com/swiftbotlabs/aldia";
const app = document.getElementById("app");
const SAMPLE_TENANT = "c658d0b11729"; // the builder-test lease the calculator's worked example recomputes
// The Worker sends each page already rendered. The first view replaces it in place, without a "Cargando…" flash.
let hydrating = app.dataset.ssr === location.pathname;

/* ---------- language: the page's own, as the Worker rendered it ---------- */
const EN = document.documentElement.lang === "en";
const S = (es, en) => (EN ? en : es);
const LOC = EN ? "en-US" : "es-AR";
const U = (p) => {
  if (!EN) return p;
  const i = p.indexOf("#");
  const [a, b] = i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i)];
  return a + (a.includes("?") ? "&" : "?") + "lang=en" + b;
};
function otherLang() {
  const q = new URLSearchParams(location.search);
  if (EN) q.delete("lang");
  else q.set("lang", "en");
  const qs = q.toString();
  return location.pathname + (qs ? "?" + qs : "") + location.hash;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "open") el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}
const ars = (n) => new Intl.NumberFormat(LOC, { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const pctf = (n, d = 2) => new Intl.NumberFormat(LOC, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n) + (EN ? "%" : " %");
const monthName = (ym, year = true) =>
  new Intl.DateTimeFormat(LOC, { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(ym + "-15T00:00:00Z"));
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const nowMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const isTx = (t) => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t);
const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

const { addMonths, rentForMonth, termsFromDetail } = window.AlDiaRent;

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message || S("Algo salió mal.", "Something went wrong.")), { status: r.status, body });
  return body;
}
let idxCache = null;
async function indices() {
  if (!idxCache) idxCache = await api("/api/indices");
  return idxCache;
}

// The same header and footer the Worker renders, for the pages this file draws itself.
function shell(...content) {
  const first = hydrating;
  hydrating = false;
  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: U("/") }, h("img", { src: "/logo.svg", alt: "" }), "Al Día"),
      h("nav", {}, h("a", { href: U("/probar") }, S("Probar", "Try it")), h("a", { href: U("/calculadora") }, S("Calculadora", "Calculator")),
        h("a", { class: "lang", href: otherLang(), hreflang: EN ? "es" : "en", lang: EN ? "es" : "en", title: EN ? "Español" : "English" }, EN ? "ES" : "EN"))),
    h("main", { class: "wrap" }, ...content),
    h("footer", {}, h("div", { class: "wrap" },
      h("p", {}, S("Al Día es un producto de Swift Bot Labs. No somos una inmobiliaria ni un banco, y este sitio no reemplaza tu contrato ni un asesoramiento legal o impositivo.",
        "Al Día is a Swift Bot Labs product. We are not an estate agent or a bank, and this site does not replace your contract or legal or tax advice.")),
      h("p", {}, h("a", { href: U("/transparencia") }, S("Transparencia", "Transparency")), " · ",
        h("a", { href: U("/probar") }, S("Probalo con 1.000 wARS", "Try it with 1,000 wARS")), " · ",
        h("a", { href: U("/nuevo") }, S("Cargar contrato", "Load a lease")), " · ",
        h("a", { href: REPO, rel: "noopener" }, S("Código abierto", "Open source")), S(" · Índices: ", " · Indices: "),
        h("a", { href: INDEC_PAGE, rel: "noopener" }, "INDEC"), S(" y ", " and "), h("a", { href: BCRA_PAGE, rel: "noopener" }, "BCRA")))));
  if (!first) window.scrollTo(0, 0);
}
// A loading placeholder, skipped while the server-rendered page is still on screen.
function loading(...content) {
  if (!hydrating) shell(...content);
}

/* ---------- Calculator (live; the server renders the same page as a GET form) ---------- */
function field(labelText, control, hint, errKey, errors) {
  return h("div", {},
    h("label", {}, labelText, hint ? h("span", { class: "hint" }, hint) : null, control),
    errors && errors[errKey] ? h("div", { class: "err" }, errors[errKey]) : null);
}
function selectEl(value, options, onchange) {
  return h("select", { onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t)));
}
const PERIODS = [[1, S("Todos los meses", "Every month")], [2, S("Cada 2 meses", "Every 2 months")], [3, S("Cada 3 meses", "Every 3 months")], [4, S("Cada 4 meses", "Every 4 months")], [6, S("Cada 6 meses", "Every 6 months")], [12, S("Cada 12 meses", "Every 12 months")]];
const INDEX_NAMES = { IPC: "IPC (INDEC)", ICL: "ICL (BCRA)", FIJO: S("Porcentaje fijo", "Fixed percentage") };
const LAGS = [[2, S("El último publicado al inicio del mes (lo más común)", "The latest published at the start of the month (most common)")], [1, S("Incluye el mes anterior al aumento", "Includes the month before the increase")]];
function missingText(m) {
  const mm = String(m).match(/^(IPC de|ICL del) (\d{4}-\d{2}(?:-\d{2})?)$/);
  return EN && mm ? `${mm[1].slice(0, 3)} for ${mm[2]}` : String(m);
}

function explainRent(r) {
  if (!r) return null;
  if (r.missing) return h("div", { class: "note warn" }, S(`Todavía no se publicó el ${missingText(r.missing)}. El aumento se calcula apenas salga.`, `The ${missingText(r.missing)} is not published yet. The increase is worked out as soon as it is.`));
  if (r.adjustments === 0) return h("p", { class: "muted" }, S("Sin aumentos todavía: este es el monto inicial del contrato.", "No increase yet: this is the lease's starting rent."));
  const rows = [[S("Monto inicial", "Starting rent"), ars(r.baseRent)], [S("Aumento acumulado", "Total increase"), "+" + pctf(r.pct)]];
  if (r.stepPct !== undefined) rows.push([S("Último aumento", "Latest increase"), "+" + pctf(r.stepPct)]);
  if (r.monthsUsed) rows.push([S("Meses de IPC usados", "IPC months used"), r.monthsUsed.map((m) => monthName(m, false)).join(", ") + " " + r.monthsUsed.at(-1).slice(0, 4)]);
  const lv = (v) => (Number.isFinite(v) ? (EN ? String(v) : String(v).replace(".", ",")) : "—");
  if (r.index === "ICL") rows.push([S("ICL usado", "ICL used"), `${lv(r.levelFrom)} → ${lv(r.levelTo)}`]);
  return h("div", {},
    h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    r.index === "IPC" ? h("p", { class: "small muted", style: "margin-top:10px" }, S("Fuente: ", "Source: "), h("a", { href: INDEC_PAGE, rel: "noopener" }, S("INDEC, IPC nivel general nacional", "INDEC, national general CPI (IPC)")), ".") : null,
    r.index === "ICL" ? h("p", { class: "small muted", style: "margin-top:10px" }, S("Fuente: ", "Source: "), h("a", { href: BCRA_PAGE, rel: "noopener" }, S("BCRA, Índice para Contratos de Locación", "BCRA, rental contracts index (ICL)")), ".") : null);
}

// The worked example: the sample tenant's IPC rent recomputed from the official series. Same as worker/pages.js.
function workedExample(pub, idx) {
  if (!pub || pub.builderTest !== true || !pub.current || !idx || !idx.ipc) return null;
  const d = pub.current.detail;
  const terms = termsFromDetail(d, pub.periodMonths);
  if (!terms) return null;
  const r = rentForMonth(terms, d.month, idx);
  if (!r || r.missing || !r.refFrom || !r.refTo) return null;
  const from = idx.ipc[r.refFrom];
  const to = idx.ipc[r.refTo];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { terms, r, from, to, factor: to / from, agent: Number.isFinite(pub.current.amount) ? pub.current.amount : null, label: pub.propertyLabel };
}
const level = (n) => new Intl.NumberFormat(LOC, { maximumFractionDigits: 4 }).format(n);
const factor6 = (n) => new Intl.NumberFormat(LOC, { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(n);
function exampleCard(ex) {
  if (!ex) return null;
  const { terms, r, from, to, factor, agent, label } = ex;
  const period = (PERIODS.find(([n]) => n === terms.periodMonths) || [0, ""])[1].toLowerCase();
  return h("section", { class: "card", id: "ejemplo" },
    h("h2", {}, S("Ejemplo resuelto", "Worked example")),
    h("p", { class: "small muted" }, S("El ", "The "), h("a", { href: U(`/pagar/${SAMPLE_TENANT}`) }, S("contrato de prueba", "test lease")), S(` «${label}», con los datos que publica el agente, recalculado acá con los índices oficiales.`, ` «${label}», from the data the agent publishes, recomputed here from the official indices.`)),
    h("dl", { class: "kv" },
      h("dt", {}, S("Alquiler inicial", "Starting rent")), h("dd", {}, ars(terms.baseRent)),
      h("dt", {}, S("Inicio del contrato", "Lease start")), h("dd", {}, monthName(terms.startDate.slice(0, 7))),
      h("dt", {}, S("Índice", "Index")), h("dd", {}, `${INDEX_NAMES.IPC}, ${period}`),
      h("dt", {}, S("Alquiler de", "Rent for")), h("dd", {}, monthName(r.month))),
    h("p", { class: "small", style: "margin:12px 0 4px" }, `${S("IPC de", "IPC")} ${monthName(r.refTo)}: ${level(to)}`, h("br"), `${S("IPC de", "IPC")} ${monthName(r.refFrom)}: ${level(from)}`),
    h("p", { class: "small", style: "margin:0 0 4px" }, `${level(to)} ÷ ${level(from)} = ${factor6(factor)}`),
    h("p", { class: "small", style: "margin:0" }, `${ars(terms.baseRent)} × ${factor6(factor)} = `, h("b", {}, ars(r.amount)), S(", redondeado al peso.", ", rounded to the peso.")),
    explainRent(r),
    agent === null ? null : h("p", { class: "small", style: "margin:12px 0 0" },
      agent === r.amount ? S(`El agente cobró ${ars(agent)} en ese contrato: coincide.`, `The agent charged ${ars(agent)} on that lease: it matches.`) : S(`El agente publicó ${ars(agent)} para ese mes.`, `The agent published ${ars(agent)} for that month.`)));
}

// Inputs can come from the query string: the server-rendered form is a plain GET form that works without JavaScript.
function calcStart() {
  const q = new URLSearchParams(location.search);
  const inicio = q.get("inicio") || "";
  return {
    baseRent: (q.get("alquiler") || "").slice(0, 20),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : "",
    index: ["IPC", "ICL", "FIJO"].includes(q.get("indice")) ? q.get("indice") : "IPC",
    periodMonths: [1, 2, 3, 4, 6, 12].includes(+q.get("cada")) ? +q.get("cada") : 3,
    lagMonths: [1, 2].includes(+q.get("meses")) ? +q.get("meses") : 2,
    fixedPct: (q.get("pct") || "").slice(0, 8),
  };
}

// Anonymous use count: once per index type per page load, 2 s after a result settles, the calculator tells the Worker
// only which index it used (no inputs, no cookies). Not sent on ?test=1 (our own checks), nor for the result a link's
// inputs bring on load (the Worker already counted that request). See worker/calcstats.js.
const CALC_TEST = new URLSearchParams(location.search).get("test") === "1";
const calcPinged = new Set();
let calcPingTimer = 0;
function calcPing(index) {
  clearTimeout(calcPingTimer);
  const i = String(index).toLowerCase();
  if (CALC_TEST || calcPinged.has(i) || !["ipc", "icl", "fijo"].includes(i)) return;
  calcPingTimer = setTimeout(() => {
    calcPinged.add(i);
    fetch(`/api/calc-ping?i=${i}`, { method: "POST", keepalive: true, credentials: "omit" }).catch(() => {});
  }, 2000);
}

async function viewCalc() {
  document.title = S("Calculadora de aumento de alquiler · Al Día", "Rent increase calculator · Al Día");
  const s = calcStart();
  const result = h("div", {});
  function compute(idx) {
    const base = parseInt(String(s.baseRent).replace(/\D/g, ""), 10);
    if (!base || !s.startDate) {
      result.replaceChildren();
      return false;
    }
    const lease = { ...s, baseRent: base, fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
    const m = nowMonth();
    const r = rentForMonth(lease, m, idx);
    if (!r) {
      result.replaceChildren(h("div", { class: "note" }, S("El contrato todavía no empezó.", "The lease has not started yet.")));
      return false;
    }
    const next = addMonths(r.adjustmentMonth, lease.periodMonths);
    result.replaceChildren(h("div", { class: "card", id: "calc-result" },
      h("div", { class: "muted small" }, S(`Alquiler de ${monthName(m)}`, `Rent for ${monthName(m)}`)),
      r.missing ? null : h("div", { class: "amount" }, ars(r.amount)),
      explainRent(r),
      h("p", { class: "muted small", style: "margin-top:12px" }, `${S("Próximo aumento", "Next increase")}: ${monthName(next)}.`),
      h("a", { class: "btn block", href: U("/nuevo") }, S("Que se haga solo todos los meses", "Have it done for you every month"))));
    return true;
  }
  const head = [h("h1", {}, S("Calculadora de aumento", "Rent increase calculator")), h("p", { class: "muted" }, S("Gratis y con datos oficiales. No hace falta registrarse.", "Free, official data, no sign-up."))];
  loading(...head, h("div", { class: "card", id: "calc" }, h("p", { class: "muted" }, S("Cargando índices…", "Loading the indices…"))));
  const pubP = api(`/api/lease/${SAMPLE_TENANT}`).catch(() => null);
  let idx;
  try {
    idx = await indices();
  } catch {
    shell(...head, h("div", { class: "card", id: "calc" }, h("div", { class: "note err" }, S("No pudimos traer los índices. Probá en un rato.", "We could not load the indices. Please try again later."))));
    return;
  }
  // Every edit calls run(); only an edit that ends in a result is counted, and only once per index type.
  const run = (byUser = true) => {
    const ok = compute(idx);
    if (!byUser) return;
    if (ok) calcPing(s.index);
    else clearTimeout(calcPingTimer);
  };
  const fixedRow = h("div", { style: s.index === "FIJO" ? "" : "display:none" }, field(S("Porcentaje de cada aumento", "Percentage of each increase"), h("input", { inputmode: "decimal", placeholder: "10", value: s.fixedPct, oninput: (e) => { s.fixedPct = e.target.value; run(); } })));
  const lagRow = h("div", { style: s.index === "IPC" ? "" : "display:none" }, field(S("Meses de IPC", "IPC months"), selectEl(s.lagMonths, LAGS, (v) => { s.lagMonths = +v; run(); })));
  const example = h("div", {});
  shell(...head,
    h("div", { class: "card", id: "calc" },
      field(S("Alquiler inicial del contrato", "Starting rent in the lease"), h("input", { inputmode: "numeric", placeholder: S("$ 500.000", "ARS 500,000"), autocomplete: "off", value: s.baseRent, oninput: (e) => { s.baseRent = e.target.value; run(); } })),
      field(S("Fecha de inicio del contrato", "Lease start date"), h("input", { type: "date", value: s.startDate, oninput: (e) => { s.startDate = e.target.value; run(); } })),
      field(S("¿Con qué índice aumenta?", "Which index raises it?"), selectEl(s.index, Object.entries(INDEX_NAMES), (v) => { s.index = v; fixedRow.style.display = v === "FIJO" ? "" : "none"; lagRow.style.display = v === "IPC" ? "" : "none"; run(); })),
      field(S("¿Cada cuánto aumenta?", "How often does it go up?"), selectEl(s.periodMonths, PERIODS, (v) => { s.periodMonths = +v; run(); })),
      lagRow, fixedRow,
      h("p", { class: "tiny", style: "margin:12px 0 0" }, S(`IPC disponible hasta ${monthName(idx.ipcLast)}. Datos leídos de INDEC y BCRA el ${idx.retrievedAt.slice(0, 10)}.`, `IPC available up to ${monthName(idx.ipcLast)}. Data read from INDEC and BCRA on ${idx.retrievedAt.slice(0, 10)}.`))),
    result, example);
  run(false);
  const card = exampleCard(workedExample(await pubP, idx));
  if (card) example.replaceChildren(card);
}

/* ---------- New lease ---------- */
const DRAFT = "aldia:draft";
function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT)) || {};
  } catch {
    return {};
  }
}
function saveDraft(s) {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(s));
  } catch { /* private mode */ }
}
function rememberLease(id, token, label) {
  try {
    const all = JSON.parse(localStorage.getItem("aldia:mine") || "{}");
    all[id] = { token, label };
    localStorage.setItem("aldia:mine", JSON.stringify(all));
    localStorage.removeItem(DRAFT);
  } catch { /* private mode */ }
}

function redact(text) {
  return text
    .replace(/\b\d{2}[- ]?\d{8}[- ]?\d\b/g, "[CUIT]")
    .replace(/\b(D\.?\s?N\.?\s?I\.?|documento[^0-9]{0,20})\s*(N[°ºo.]*\s*)?\d{1,2}\.?\d{3}\.?\d{3}\b/gi, "$1 [DNI]")
    .replace(/\b\d{22}\b/g, "[CBU]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")
    .replace(/\b(tel[eé]fono|celular|tel\.?)[^0-9]{0,12}[\d() -]{8,}/gi, "$1 [TEL]");
}
let pdfjsLoading = null;
function loadPdfJs() {
  if (!pdfjsLoading) {
    pdfjsLoading = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.integrity = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";
      s.crossOrigin = "anonymous";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        ok(window.pdfjsLib);
      };
      s.onerror = () => bad(new Error("pdf"));
      document.head.append(s);
    });
  }
  return pdfjsLoading;
}
async function pdfText(file) {
  if (file.size > 8e6) throw new Error(S("El archivo pesa más de 8 MB.", "The file is larger than 8 MB."));
  const buf = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") throw new Error(S("Ese archivo no es un PDF.", "That file is not a PDF."));
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((x) => x.str).join(" ") + "\n";
  }
  return out;
}

// The Worker checks every field again; in English its field names map to these messages.
const FIELD_EN = {
  propertyLabel: "Enter a short name for the property.", tenantLabel: "That name is too long.", baseRent: "The rent must be between ARS 1,000 and ARS 100,000,000.",
  startDate: "Check the lease start date.", dueDay: "Choose a day between 1 and 28.", index: "Choose an index.", periodMonths: "Choose how often it goes up.",
  lagMonths: "Invalid value.", fixedPct: "Enter a percentage between 0 and 100.", sweepBps: "Invalid value.", payout: "That address does not look valid. It must start with 0x and be 42 characters long.",
};
function viewNew() {
  document.title = S("Cargar contrato · Al Día", "Load a lease · Al Día");
  const s = Object.assign({ step: 1, baseRent: "", startDate: "", dueDay: 10, index: "IPC", periodMonths: 3, lagMonths: 2, fixedPct: "", propertyLabel: "", tenantLabel: "", sweepBps: 5000, payout: "" }, loadDraft());
  let errors = {};
  let busy = false;
  const root = h("div", {});
  shell(h("h1", {}, S("Cargá tu contrato", "Load your lease")), root);

  function choice(name, val, title, sub) {
    return h("label", { class: "choice" + (String(s[name]) === String(val) ? " on" : "") },
      h("input", { type: "radio", name, checked: String(s[name]) === String(val), onchange: () => { s[name] = typeof s[name] === "number" ? +val : val; draw(); } }), title, sub ? h("small", {}, sub) : null);
  }
  async function preview() {
    const box = h("div", { class: "note" }, S("Calculando…", "Working it out…"));
    const base = parseInt(String(s.baseRent).replace(/\D/g, ""), 10);
    if (!base || !s.startDate) return h("div", {});
    indices().then((idx) => {
      const lease = { ...s, baseRent: base, fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
      const m = nowMonth();
      const r = rentForMonth(lease, m < s.startDate.slice(0, 7) ? s.startDate.slice(0, 7) : m, idx);
      if (!r || r.missing) return box.replaceChildren(r ? S(`Falta el ${missingText(r.missing)}.`, `The ${missingText(r.missing)} is missing.`) : "");
      box.replaceChildren(S(`Con estos datos, el alquiler de ${monthName(r.month, false)} es `, `With these terms, the rent for ${monthName(r.month, false)} is `), h("b", {}, ars(r.amount)),
        r.adjustments ? S(` (+${pctf(r.pct)} desde el inicio).`, ` (+${pctf(r.pct)} since the start).`) : S(" (sin aumentos todavía).", " (no increase yet)."));
    }).catch(() => box.remove());
    return box;
  }
  function readBox() {
    const status = h("div", {});
    const onFile = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      status.replaceChildren(h("div", { class: "note" }, S("Leyendo el PDF en tu celular…", "Reading the PDF on your phone…")));
      try {
        const raw = await pdfText(f);
        if (raw.replace(/\s/g, "").length < 200) {
          status.replaceChildren(h("div", { class: "note warn" }, S("Este PDF parece una foto y no tiene texto. Cargá los datos a mano.", "This PDF looks like a photo with no text. Enter the terms by hand.")));
          return;
        }
        await sendForReading(redact(raw), status);
      } catch (err) {
        status.replaceChildren(h("div", { class: "note warn" }, err.message && err.message.length > 5 ? err.message : S("No pudimos leer ese archivo. Cargá los datos a mano.", "We could not read that file. Enter the terms by hand.")));
      }
    };
    return h("details", { class: "card" },
      h("summary", {}, S("¿Tenés el contrato en PDF? Lo leemos por vos", "Have the lease as a PDF? We read it for you")),
      h("p", { class: "small muted" }, S("El PDF no sale de tu teléfono: sacamos el texto acá mismo, borramos DNI, CUIT, CBU, mails y teléfonos, y le pasamos solo eso a un modelo de lenguaje para encontrar el monto, las fechas y el índice. Después revisás vos.",
        "The PDF never leaves your phone: we take the text out here, remove ID, tax and bank numbers, emails and phone numbers, and send only that to a language model to find the amount, the dates and the index. Then you check them.")),
      h("input", { type: "file", accept: "application/pdf", onchange: onFile }), status);
  }
  async function sendForReading(text, status) {
    status.replaceChildren(h("div", { class: "note" }, S("Mandamos el texto sin datos personales. Esto puede tardar un minuto.", "Sending the text without personal data. This can take a minute.")));
    const { rid } = await api("/api/leer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await api(`/api/leer/${rid}`);
      if (res.status === "done") {
        const f = res.fields || {};
        for (const k of ["startDate", "dueDay", "index", "periodMonths", "fixedPct"]) if (f[k] !== undefined && f[k] !== null) s[k] = f[k];
        if (f.baseRent) s.baseRent = String(f.baseRent);
        s.contractRef = res.rid || rid;
        saveDraft(s);
        draw();
        root.prepend(h("div", { class: "note" }, S("Listo. Completamos lo que encontramos: revisá cada dato contra tu contrato antes de seguir.", "Done. We filled in what we found: check every term against your lease before you go on.")));
        return;
      }
      if (res.status === "failed") break;
    }
    status.replaceChildren(h("div", { class: "note warn" }, S("No pudimos leerlo esta vez. Cargá los datos a mano.", "We could not read it this time. Enter the terms by hand.")));
  }

  async function step1() {
    return [
      readBox(),
      h("div", { class: "card" },
        field(S("Alquiler inicial del contrato", "Starting rent in the lease"), h("input", { inputmode: "numeric", placeholder: S("$ 500.000", "ARS 500,000"), value: s.baseRent, oninput: (e) => { s.baseRent = e.target.value; } }), S("El monto que figura en el contrato, en pesos.", "The amount in the lease, in pesos."), "baseRent", errors),
        field(S("Fecha de inicio del contrato", "Lease start date"), h("input", { type: "date", value: s.startDate, onchange: (e) => { s.startDate = e.target.value; draw(); } }), null, "startDate", errors),
        h("label", {}, S("¿Con qué índice aumenta?", "Which index raises it?")),
        h("div", { class: "choices" }, choice("index", "IPC", "IPC", "INDEC"), choice("index", "ICL", "ICL", "BCRA"), choice("index", "FIJO", S("Fijo", "Fixed"), S("Un porcentaje", "A percentage"))),
        s.index === "FIJO" ? field(S("Porcentaje de cada aumento", "Percentage of each increase"), h("input", { inputmode: "decimal", placeholder: "10", value: s.fixedPct, oninput: (e) => { s.fixedPct = e.target.value; } }), null, "fixedPct", errors) : null,
        field(S("¿Cada cuánto aumenta?", "How often does it go up?"), selectEl(s.periodMonths, PERIODS, (v) => { s.periodMonths = +v; draw(); }), null, "periodMonths", errors),
        s.index === "IPC" ? field(S("¿Qué meses de IPC usa tu contrato?", "Which IPC months does your lease use?"), selectEl(s.lagMonths, LAGS, (v) => { s.lagMonths = +v; draw(); }), S("INDEC publica cada IPC a mitad del mes siguiente.", "INDEC publishes each month's IPC in the middle of the next month.")) : null,
        field(S("Día de vencimiento", "Due day"), h("input", { inputmode: "numeric", value: s.dueDay, oninput: (e) => { s.dueDay = parseInt(e.target.value, 10) || ""; } }), S("Entre 1 y 28.", "Between 1 and 28."), "dueDay", errors),
        await preview()),
    ];
  }
  function step2() {
    return [h("div", { class: "card" },
      field(S("¿Cómo llamamos a la propiedad?", "What should we call the property?"), h("input", { value: s.propertyLabel, maxlength: 60, placeholder: S("Depto 2 ambientes, Almagro", "Two-room flat, Almagro"), oninput: (e) => { s.propertyLabel = e.target.value; } }), S("Lo ve tu inquilino. No hace falta la dirección exacta.", "Your tenant sees it. No need for the exact address."), "propertyLabel", errors),
      field(S("Nombre de tu inquilino (opcional)", "Your tenant's name (optional)"), h("input", { value: s.tenantLabel, maxlength: 40, placeholder: "Martina", oninput: (e) => { s.tenantLabel = e.target.value; } }), S("Con un nombre de pila alcanza. Se usa para el mensaje de WhatsApp.", "A first name is enough. It goes in the WhatsApp message."), "tenantLabel", errors))];
  }
  const splitLabel = (bps) => [h("span", {}, S(`${100 - bps / 100} % pesos`, `${100 - bps / 100}% pesos`)), h("span", {}, S(`${bps / 100} % dólares`, `${bps / 100}% dollars`))];
  function step3() {
    const label = h("div", { class: "split" }, ...splitLabel(s.sweepBps));
    const connect = window.ethereum ? h("button", { class: "btn ghost block", type: "button", onclick: async () => {
      try {
        const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
        s.payout = a;
        draw();
      } catch { /* user said no */ }
    } }, S("Usar la billetera de este teléfono", "Use this phone's wallet")) : null;
    return [h("div", { class: "card" },
      h("h3", {}, S("¿Cómo querés cobrar?", "How do you want to be paid?")),
      h("p", { class: "small muted" }, S("Cada vez que entra un alquiler, la parte en dólares se convierte sola a USD₮ al mejor precio disponible, con un piso de seguridad. Lo podés cambiar después.", "Every time a rent comes in, the dollar share is converted to USD₮ at the best price available, with a safety floor. You can change it later.")),
      h("input", { type: "range", min: 0, max: 10000, step: 500, value: s.sweepBps, "aria-label": S("Parte en dólares", "Dollar share"), oninput: (e) => {
        s.sweepBps = +e.target.value;
        label.replaceChildren(...splitLabel(s.sweepBps));
      } }),
      label),
      h("div", { class: "card" },
        h("h3", {}, S("¿Dónde recibís?", "Where do you get paid?")),
        h("p", { class: "small muted" }, S("Tu dirección en la red Celo. Empieza con 0x. La sacás de MiniPay, Valora o MetaMask, y solo vos tenés acceso.", "Your address on Celo. It starts with 0x. You get it from MiniPay, Valora or MetaMask, and only you control it.")),
        h("details", {}, h("summary", {}, S("No tengo billetera", "I have no wallet")),
          h("ol", { class: "small muted" },
            h("li", {}, S("Instalá Valora o MetaMask en tu teléfono. Si ya usás Opera Mini, MiniPay viene incluida.", "Install Valora or MetaMask on your phone. If you use Opera Mini, MiniPay is built in.")),
            h("li", {}, S("Creá tu billetera y guardá la frase de recuperación en papel. Nadie más la tiene que ver.", "Create your wallet and write the recovery phrase on paper. Nobody else should see it.")),
            h("li", {}, S("Copiá tu dirección, la que empieza con 0x, y pegala acá abajo. Sirve para la red Celo.", "Copy your address, the one that starts with 0x, and paste it below. It works on Celo.")))),
        connect,
        field(S("Dirección de tu billetera", "Your wallet address"), h("input", { value: s.payout, autocomplete: "off", spellcheck: "false", placeholder: "0x…", class: "mono", oninput: (e) => { s.payout = e.target.value.trim(); } }), null, "payout", errors),
        h("p", { class: "tiny", style: "margin:10px 0 0" }, S("Revisala dos veces. Esta dirección queda escrita en la cuenta del contrato y el agente no la puede cambiar.", "Check it twice. This address is written into the lease account and the agent cannot change it."))),
      h("div", { class: "note" }, S("Costo: 0,3 % de cada alquiler cobrado. Sin abono ni permanencia.", "Cost: 0.3% of each rent collected. No subscription, no lock-in."))];
  }
  async function submit() {
    if (busy) return;
    busy = true;
    errors = {};
    const body = { ...s, baseRent: parseInt(String(s.baseRent).replace(/\D/g, ""), 10), fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
    try {
      const { id, token } = await api("/api/leases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      rememberLease(id, token, s.propertyLabel);
      history.pushState({}, "", `${U(`/panel/${id}`)}#k=${token}`);
      route();
    } catch (e) {
      busy = false;
      if (e.body && e.body.fields) {
        errors = EN ? Object.fromEntries(Object.keys(e.body.fields).map((k) => [k, FIELD_EN[k] || "Invalid value."])) : e.body.fields;
        s.step = ["baseRent", "startDate", "index", "periodMonths", "dueDay", "fixedPct"].some((k) => errors[k]) ? 1 : ["propertyLabel", "tenantLabel"].some((k) => errors[k]) ? 2 : 3;
      } else {
        errors = { form: e.message };
      }
      draw();
    }
  }
  function validStep() {
    errors = {};
    if (s.step === 1) {
      if (!parseInt(String(s.baseRent).replace(/\D/g, ""), 10)) errors.baseRent = S("Poné el monto del contrato.", "Enter the lease amount.");
      if (!s.startDate) errors.startDate = S("Poné la fecha de inicio.", "Enter the start date.");
      if (!(s.dueDay >= 1 && s.dueDay <= 28)) errors.dueDay = S("Elegí un día entre 1 y 28.", "Choose a day between 1 and 28.");
      if (s.index === "FIJO" && !(parseFloat(String(s.fixedPct).replace(",", ".")) > 0)) errors.fixedPct = S("Poné el porcentaje.", "Enter the percentage.");
    }
    if (s.step === 2 && !s.propertyLabel.trim()) errors.propertyLabel = S("Poné un nombre corto para la propiedad.", "Enter a short name for the property.");
    return Object.keys(errors).length === 0;
  }
  async function draw() {
    saveDraft(s);
    const body = s.step === 1 ? await step1() : s.step === 2 ? step2() : step3();
    root.replaceChildren(...[
      h("div", { class: "progress" }, [1, 2, 3].map((n) => h("span", { class: n <= s.step ? "on" : "" }))),
      ...body,
      errors.form ? h("div", { class: "note err" }, errors.form) : null,
      h("div", { class: "row" },
        s.step > 1 ? h("button", { class: "btn ghost", type: "button", onclick: () => { s.step--; draw(); } }, S("Volver", "Back")) : null,
        h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
          if (!validStep()) return draw();
          if (s.step < 3) {
            s.step++;
            draw();
            window.scrollTo(0, 0);
          } else submit();
        } }, s.step < 3 ? S("Seguir", "Next") : S("Crear la cuenta del contrato", "Create the lease account"))),
    ].filter(Boolean));
  }
  draw();
}

/* ---------- Tenant payment from a wallet in the browser (MiniPay and other injected wallets) ---------- */
const PAY_MSG = {
  es: { low: "Tu billetera no tiene suficientes wARS. Usá el pago por transferencia.", sent: "Pago enviado. En unos minutos el agente lo concilia y queda el recibo. ", see: "Ver operación", fail: "No se pudo enviar el pago.", btn: "Pagar con wARS desde esta billetera" },
  en: { low: "Your wallet does not hold enough wARS.", sent: "Payment sent. The agent settles it within minutes and the receipt appears here. ", see: "See transaction", fail: "The payment could not be sent.", btn: "Pay with wARS from this wallet" },
};
const PM = EN ? PAY_MSG.en : PAY_MSG.es;
async function payWithWallet(pub, status, msg = PM, account = null) {
  const eth = window.ethereum;
  const [from] = account ? [account] : await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] });
  } catch { /* MiniPay is already on Celo */ }
  const owed = BigInt(pub.current.amount - (pub.current.received || 0)) * 10n ** 18n;
  const data = "0xa9059cbb" + pub.collector.slice(2).toLowerCase().padStart(64, "0") + owed.toString(16).padStart(64, "0") + TAG_SUFFIX;
  const bal = await eth.request({ method: "eth_call", params: [{ to: WARS, data: "0x70a08231" + from.slice(2).toLowerCase().padStart(64, "0") }, "latest"] });
  if (BigInt(bal) < owed) {
    status.replaceChildren(h("div", { class: "note warn" }, msg.low));
    return null;
  }
  const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to: WARS, data }] });
  status.replaceChildren(h("div", { class: "note" }, msg.sent, isTx(hash) ? h("a", { href: TX_URL(hash), rel: "noopener" }, msg.see) : null));
  return hash;
}
// /pagar/<id>: the Worker leaves a placeholder only on a real lease with money owed; a wallet adds the pay button there.
function enhancePay(id) {
  const box = document.getElementById("pay-wallet");
  const d = box ? box.dataset : {};
  if (box && window.ethereum && d.id === id && isAddr(d.collector) && /^\d{1,12}$/.test(d.owed || "") && Number(d.owed) > 0) {
    const status = h("div", {});
    box.replaceChildren(h("button", { class: "btn ghost block", type: "button", style: "margin-top:10px", onclick: () =>
      payWithWallet({ collector: d.collector, current: { amount: Number(d.owed), received: 0 } }, status).catch(() => status.replaceChildren(h("div", { class: "note warn" }, PM.fail))) }, PM.btn), status);
  }
  // While money is owed the page checks the lease every 30 s and reloads when the agent has seen a payment.
  if (box) {
    const poll = async () => {
      try {
        const now = await api(`/api/lease/${id}`);
        const c = now.current || {};
        if (c.status === "pagado" || (c.received || 0) > 0) return location.reload();
      } catch { /* try again */ }
      setTimeout(poll, 30000);
    };
    setTimeout(poll, 30000);
  }
}
function enhanceReceipt() {
  const b = document.getElementById("print");
  if (b) {
    b.hidden = false;
    b.addEventListener("click", () => window.print());
  }
}

/* ---------- Landlord ---------- */
// Actions only the landlord's own wallet can take on the lease contract. Nothing here passes through our servers.
// A plain projection for planning: the last three IPC prints repeated. Clearly labelled as an estimate.
function nextEstimate(c, t, idx) {
  if (!c || !c.amount) return "";
  if (t.index === "FIJO") return S(`Va a ser de ${ars(Math.floor(c.amount * (1 + t.fixedPct / 100) + 0.5))}.`, `It will be ${ars(Math.floor(c.amount * (1 + t.fixedPct / 100) + 0.5))}.`);
  if (t.index !== "IPC" || !idx) return "";
  const months = Object.keys(idx.ipcMonthlyPct).sort().slice(-3);
  const avg = months.reduce((a, m) => a + idx.ipcMonthlyPct[m], 0) / months.length;
  const projected = c.amount * Math.pow(1 + avg / 100, t.periodMonths);
  return S(`Si la inflación sigue como en los últimos tres meses, sería de unos ${ars(Math.round(projected / 1000) * 1000)}.`, `If inflation stays as in the last three months, it would be about ${ars(Math.round(projected / 1000) * 1000)}.`);
}
const STATUS_CHIPS = { pagado: ["ok", "Pagado", "Paid"], parcial: ["wait", "Pago parcial", "Part paid"], pendiente: ["wait", "Pendiente", "Due"], vencido: ["late", "Vencido", "Overdue"], "sin-indice": ["info", "Esperando índice", "Waiting for the index"] };
function statusChip(st) {
  const [c, es, en] = STATUS_CHIPS[st] || ["info", st, st];
  return h("span", { class: "chip " + c }, EN ? en : es);
}
const clauseNote = (c) => (c && c.clauseCheck ? h("p", { class: "small", style: "margin:10px 0 0" }, c.clauseCheck.ok ? S("Revisamos este aumento contra la cláusula del contrato: coincide.", "We checked this increase against the contract clause: it matches.") : S("Ojo: este aumento podría no coincidir con la cláusula del contrato. ", "Careful: this increase may not match the contract clause. "), c.clauseCheck.ok ? null : c.clauseCheck.note,
  isTx(c.clauseCheck.tx) ? [" ", h("a", { href: TX_URL(c.clauseCheck.tx), rel: "noopener" }, S("Ver la revisión paga en Celo", "See the paid review on Celo")), "."] : null) : null);
const BOT = "https://t.me/AlDiaAvisosBot";
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function landlordTx(pub, terms, data, status, okText) {
  const eth = window.ethereum;
  try {
    const [from] = await eth.request({ method: "eth_requestAccounts" });
    if (from.toLowerCase() !== terms.payout.toLowerCase()) {
      status.replaceChildren(h("div", { class: "note warn" }, S(`Conectá la billetera ${short(terms.payout)}: es la única que puede hacer esto.`, `Connect wallet ${short(terms.payout)}: it is the only one that can do this.`)));
      return;
    }
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] });
    } catch { /* MiniPay is already on Celo */ }
    const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to: pub.collector, data: data + TAG_SUFFIX }] });
    status.replaceChildren(h("div", { class: "note" }, okText, " ", h("a", { href: TX_URL(hash), rel: "noopener" }, S("Ver operación", "See transaction"))));
  } catch {
    status.replaceChildren(h("div", { class: "note warn" }, S("No se pudo enviar. Probá de nuevo.", "It could not be sent. Try again.")));
  }
}
function controls(pub, t) {
  if (!pub || !pub.deployed) return null;
  if (!window.ethereum) {
    return h("section", { class: "card" }, h("h3", {}, S("Tu cuenta, tus reglas", "Your account, your rules")),
      h("p", { class: "small muted" }, S(`Abrí este link desde la billetera ${short(t.payout)} para cambiar qué parte pasa a dólares, retirar lo que haya en la cuenta o sacar al agente.`, `Open this link in wallet ${short(t.payout)} to change the dollar share, withdraw what is in the account or remove the agent.`)));
  }
  const status = h("div", {});
  let bps = pub.sweepBps;
  const split = (b) => [h("span", {}, S(`${100 - b / 100} % pesos`, `${100 - b / 100}% pesos`)), h("span", {}, S(`${b / 100} % dólares`, `${b / 100}% dollars`))];
  const label = h("div", { class: "split" }, ...split(bps));
  const uint = (n) => BigInt(n).toString(16).padStart(64, "0");
  return h("section", { class: "card" }, h("h3", {}, S("Tu cuenta, tus reglas", "Your account, your rules")),
    h("p", { class: "small muted" }, S("Estas acciones las firmás vos con tu billetera. El agente no las puede hacer ni deshacer.", "You sign these with your wallet. The agent can neither do nor undo them.")),
    h("input", { type: "range", min: 0, max: 10000, step: 500, value: bps, "aria-label": S("Parte en dólares", "Dollar share"), oninput: (e) => {
      bps = +e.target.value;
      label.replaceChildren(...split(bps));
    } }),
    label,
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => landlordTx(pub, t, "0xd2d988d3" + uint(bps), status, S("Listo: vale desde el próximo cobro.", "Done: it applies from the next rent.")) }, S("Guardar cómo cobro", "Save how I get paid")),
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => landlordTx(pub, t, "0x51cff8d9" + WARS.slice(2).toLowerCase().padStart(64, "0"), status, S("Listo: los pesos de la cuenta van a tu billetera.", "Done: the pesos in the account go to your wallet.")) }, S("Retirar los pesos de la cuenta", "Withdraw the pesos from the account")),
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => {
      if (window.confirm(S("Si sacás al agente, deja de cobrar y repartir este alquiler para siempre. ¿Seguro?", "If you remove the agent, it stops collecting and splitting this rent for good. Are you sure?"))) landlordTx(pub, t, "0x683e2f4f", status, S("Listo: el agente ya no opera esta cuenta.", "Done: the agent no longer runs this account."));
    } }, S("Sacar al agente de esta cuenta", "Remove the agent from this account")),
    status);
}
async function viewPanel(id) {
  document.title = S("Tu contrato · Al Día", "Your lease · Al Día");
  const m = location.hash.match(/k=([0-9a-f]{32})/);
  let token = m && m[1];
  if (!token) {
    try {
      token = (JSON.parse(localStorage.getItem("aldia:mine") || "{}")[id] || {}).token;
    } catch { /* private mode */ }
  }
  if (!token) {
    shell(h("h1", {}, S("Necesitás tu link privado", "You need your private link")), h("p", { class: "muted" }, S("Abrí el link que guardaste cuando creaste el contrato.", "Open the link you saved when you created the lease.")));
    return;
  }
  loading(h("p", { class: "muted" }, S("Cargando…", "Loading…")));
  let d;
  try {
    d = await api(`/api/panel/${id}`, { headers: { "x-aldia-key": token } });
  } catch (e) {
    shell(h("h1", {}, S("No pudimos abrir el panel", "We could not open the panel")), h("p", { class: "muted" }, e.status === 403 ? S("Este link no es válido.", "This link is not valid.") : e.message));
    return;
  }
  try {
    rememberLease(id, token, d.terms.propertyLabel);
  } catch { /* fine */ }
  const t = d.terms;
  const pub = d.pub;
  const c = pub && pub.current;
  const idx = await indices().catch(() => null);
  const tenantUrl = `${location.origin}/pagar/${id}`;
  const privateUrl = `${location.origin}${U(`/panel/${id}`)}#k=${token}`;
  // The WhatsApp message is for the tenant in Argentina, so it stays in Spanish.
  const greet = t.tenantLabel ? `Hola ${t.tenantLabel}!` : "Hola!";
  const mes = c ? new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(new Date(c.month + "-15T00:00:00Z")) : "";
  const pesos = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
  const msg = c
    ? `${greet} El alquiler de ${mes} de ${t.propertyLabel} es ${pesos(c.amount)}. Acá ves el detalle y podés pagar por transferencia: ${tenantUrl}`
    : `${greet} Desde ahora el alquiler de ${t.propertyLabel} se paga por acá: ${tenantUrl}`;
  const copyText = S("Copiar link", "Copy link");
  const copy = (text, btn) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn();
      old.textContent = S("Copiado", "Copied");
      setTimeout(() => { old.textContent = copyText; }, 1500);
    } catch { /* clipboard blocked */ }
  };
  let copyBtn;
  copyBtn = h("button", { class: "btn ghost", type: "button", onclick: copy(tenantUrl, () => copyBtn) }, copyText);
  if (!pub) setTimeout(() => { if (location.pathname === `/panel/${id}`) route(); }, 15000);
  const sweep = pub ? pub.sweepBps : t.sweepBps;
  shell(pub && pub.builderTest ? h("div", { class: "note" }, S("Contrato de prueba de Swift Bot Labs.", "Swift Bot Labs test lease.")) : null,
    h("h1", {}, t.propertyLabel),
    !pub ? h("div", { class: "note" }, S("Estamos preparando la cuenta de este contrato. Tarda menos de dos minutos.", "We are setting up this lease's account. It takes less than two minutes.")) : null,
    pub && pub.closed ? h("div", { class: "note warn" }, S("Sacaste al agente de esta cuenta. Lo que entre queda ahí hasta que lo retires con tu billetera.", "You removed the agent from this account. Whatever comes in stays there until you withdraw it with your wallet.")) : null,
    h("div", { class: "note warn noprint" }, S("Guardá este link: es tu acceso privado. ", "Keep this link: it is your private access. "), h("span", { class: "mono" }, privateUrl)),
    c ? h("section", { class: "card" },
      h("div", { class: "muted small" }, S(`Alquiler de ${monthName(c.month)}`, `Rent for ${monthName(c.month)}`)),
      statusChip(c.status),
      h("div", { class: "amount" }, ars(c.amount)),
      c.received ? h("p", { class: "small" }, S(`Recibido: ${ars(c.received)}.`, `Received: ${ars(c.received)}.`)) : null,
      h("details", {}, h("summary", {}, S("Cómo se calculó", "How it was worked out")), explainRent(c.detail)),
      clauseNote(c),
      pub.nextAdjustment ? h("p", { class: "small muted", style: "margin:10px 0 0" }, `${S("Próximo aumento", "Next increase")}: ${monthName(pub.nextAdjustment)}.`, " ", nextEstimate(c, t, idx)) : null) : null,
    h("section", { class: "card" },
      h("h3", {}, S("Mandale el link a tu inquilino", "Send your tenant the link")),
      h("p", { class: "small muted" }, S("Es siempre el mismo. Cada mes muestra el monto que corresponde.", "It is always the same link. Each month it shows that month's amount.")),
      h("div", { class: "row" },
        h("a", { class: "btn wa", style: "flex:1", href: `https://wa.me/?text=${encodeURIComponent(msg)}`, rel: "noopener" }, S("Mandar por WhatsApp", "Send on WhatsApp")),
        copyBtn)),
    h("section", { class: "card" },
      h("h3", {}, S("Avisos", "Reminders")),
      h("p", { class: "small muted" }, S("Te escribimos cuando entra un pago, cuando cambia el monto o si algo se atrasa.", "We message you when a payment arrives, when the amount changes or if something is late.")),
      h("a", { class: "btn ghost block", href: `${BOT}?start=l_${id}_${(await sha256Hex(token)).slice(0, 20)}`, rel: "noopener" }, S("Recibir avisos por Telegram", "Get reminders on Telegram"))),
    h("section", { class: "card" },
      h("h3", {}, S("Cómo cobrás", "How you get paid")),
      h("dl", { class: "kv" },
        h("dt", {}, S("En pesos", "In pesos")), h("dd", {}, S(`${100 - sweep / 100} %`, `${100 - sweep / 100}%`)),
        h("dt", {}, S("En dólares (USD₮)", "In dollars (USD₮)")), h("dd", {}, S(`${sweep / 100} %`, `${sweep / 100}%`)),
        h("dt", {}, S("Billetera", "Wallet")), h("dd", { class: "mono" }, short(t.payout)),
        h("dt", {}, S("Índice", "Index")), h("dd", {}, INDEX_NAMES[t.index]),
        h("dt", {}, S("Vence", "Due")), h("dd", {}, S(`Día ${t.dueDay}`, `Day ${t.dueDay}`))),
      h("p", { class: "small muted", style: "margin-top:10px" }, S("¿Querés pasar pesos a tu banco? ", "Want to move pesos to your bank? "),
        h("a", { href: `https://ramp.ripio.com/off-ramp?country=AR&chain=42220&token=WARS&amount=${c ? c.amount : 10000}`, rel: "noopener" }, S("Hacelo con Ripio", "Do it with Ripio")), ".")),
    controls(pub, t),
    pub && pub.history && pub.history.length ? h("section", { class: "card" },
      h("h3", {}, S("Historial", "History")),
      h("table", {}, h("tr", {}, h("th", {}, S("Mes", "Month")), h("th", { class: "r" }, S("Monto", "Amount")), h("th", { class: "r" }, S("Estado", "Status"))),
        pub.history.map((x) => h("tr", {}, h("td", {}, x.status === "pagado" ? h("a", { href: U(`/recibo/${id}/${x.month}`) }, monthName(x.month)) : monthName(x.month)), h("td", { class: "r" }, ars(x.amount)), h("td", { class: "r" }, statusChip(x.status)))))) : null,
    d.panel && d.panel.market ? h("section", { class: "card" },
      h("h3", {}, S("¿Cómo está tu alquiler contra el mercado?", "How does your rent compare with the market?")),
      h("p", {}, d.panel.market.summary),
      h("p", { class: "tiny" }, d.panel.market.source)) : null,
    pub ? h("p", { class: "tiny" }, S("Cuenta del contrato: ", "Lease account: "), h("a", { href: LEASE_URL(pub.collector), rel: "noopener" }, short(pub.collector)), pub.deployed ? "" : S(" (se activa con el primer pago)", " (it goes live with the first payment)")) : null);
}

/* ---------- Open test (/probar): the server renders it; this only adds the wallet buttons and waits for the agent ---------- */
const PROBAR_MSG = {
  es: { connect: "Usar la billetera de este teléfono", pay: "Pagar 1.000 wARS desde esta billetera", other: (a, b) => `Ojo: estás pagando desde ${a}, pero la plata vuelve a ${b}. Si las dos son tuyas, tocá de nuevo.`, again: "Pagar igual", panel: "Tu panel de propietario, privado: guardá este link. Desde ahí podés retirar los wARS de la cuenta con tu billetera si algo falla.", panelLink: "Abrir mi panel" },
  en: { connect: "Use this phone's wallet", pay: "Pay 1,000 wARS from this wallet", other: (a, b) => `Careful: you are paying from ${a}, but the money goes back to ${b}. If both are yours, tap again.`, again: "Pay anyway", panel: "Your private landlord panel: keep this link. From there your wallet can withdraw the wARS from the lease account if anything goes wrong.", panelLink: "Open my panel" },
};
function probarEnhance(id) {
  const lang = EN ? "en" : "es";
  const t = PROBAR_MSG[lang];
  const eth = window.ethereum;
  const connect = document.getElementById("probar-connect");
  const input = document.getElementById("wallet");
  if (connect && input && eth) {
    connect.replaceChildren(h("button", { class: "btn ghost block", type: "button", onclick: async () => {
      try {
        const [a] = await eth.request({ method: "eth_requestAccounts" });
        if (isAddr(a)) input.value = a;
      } catch { /* the wallet said no */ }
    } }, t.connect));
  }
  if (!id) return;
  // The landlord key arrives only in the URL fragment after the form: keep it on this phone, then take it out of the URL.
  const k = location.hash.match(/k=([0-9a-f]{32})/);
  const panel = document.getElementById("probar-panel");
  if (k && panel) {
    rememberLease(id, k[1], "Prueba abierta de 1.000 wARS");
    panel.replaceChildren(t.panel, " ", h("a", { href: `${U(`/panel/${id}`)}#k=${k[1]}`, rel: "noopener" }, t.panelLink));
    panel.hidden = false;
    history.replaceState(null, "", location.pathname + location.search);
  }
  let paying = false;
  const box = document.getElementById("probar-pay");
  const d = box ? box.dataset : {};
  if (box && eth && isAddr(d.collector) && isAddr(d.landlord) && /^\d{1,7}$/.test(d.owed || "")) {
    const status = h("div", {});
    let warned = false;
    const btn = h("button", { class: "btn block", type: "button", style: "margin:6px 0 4px", onclick: async () => {
      if (paying) return;
      paying = true;
      try {
        const [from] = await eth.request({ method: "eth_requestAccounts" });
        if (!isAddr(from)) throw new Error("no account");
        if (from.toLowerCase() !== d.landlord.toLowerCase() && !warned) {
          warned = true;
          status.replaceChildren(h("div", { class: "note warn" }, t.other(short(from), short(d.landlord))));
          btn.textContent = t.again;
          return;
        }
        await payWithWallet({ collector: d.collector, current: { amount: Number(d.owed), received: 0 } }, status, PAY_MSG[lang], from);
      } catch {
        status.replaceChildren(h("div", { class: "note warn" }, PAY_MSG[lang].fail));
      } finally {
        paying = false;
      }
    } }, t.pay);
    box.replaceChildren(btn, status);
  }
  // Without a meta refresh while paying, the page reloads itself only when the agent moves the lease to another step.
  const st = document.getElementById("probar-state");
  if (st) {
    const poll = async () => {
      if (location.pathname !== `/probar/${id}`) return;
      try {
        const now = await api(`/api/probar/${id}`);
        if (!paying && (String(now.step) !== st.dataset.step || now.phase !== st.dataset.phase)) return location.reload();
      } catch { /* try again */ }
      setTimeout(poll, 15000);
    };
    setTimeout(poll, 15000);
  }
}

/* ---------- Router ---------- */
// Pages the Worker renders completely: this file only enhances them. Reached again through history, they load fresh.
let fromHistory = false;
function serverPage(enhance) {
  if (fromHistory) return location.reload();
  hydrating = false;
  if (enhance) enhance();
}
function route() {
  const p = location.pathname;
  let m;
  if (p === "/calculadora") return viewCalc();
  if (p === "/nuevo") return viewNew();
  if ((m = p.match(/^\/panel\/([0-9a-f]{12})$/))) return viewPanel(m[1]);
  if (p === "/probar" || /^\/probar\/[0-9a-f]{12}$/.test(p)) return serverPage(() => probarEnhance((p.match(/^\/probar\/([0-9a-f]{12})$/) || [])[1] || null));
  if ((m = p.match(/^\/pagar\/([0-9a-f]{12})$/))) return serverPage(() => enhancePay(m[1]));
  if (/^\/recibo\/[0-9a-f]{12}\/\d{4}-\d{2}$/.test(p)) return serverPage(enhanceReceipt);
  return serverPage(null);
}
window.addEventListener("popstate", () => {
  fromHistory = true;
  route();
});
route();
