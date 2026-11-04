"use strict";
/* Al Día front end. No framework and no user text goes through innerHTML: h() builds nodes and text stays text. */
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const TAG_SUFFIX = "63656c6f5f326565303237303461353664110080218021802180218021802180218021"; // ERC-8021: celo_2ee02704a56d
const LEASE_URL = (a) => `https://celoscan.io/address/${a}`;
const TX_URL = (t) => `https://celoscan.io/tx/${t}`;
const INDEC_PAGE = "https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31";
const BCRA_PAGE = "https://www.bcra.gob.ar/estadisticas-indicadores/";
const app = document.getElementById("app");
const SAMPLE_TENANT = "c658d0b11729"; // the builder-test lease the calculator's worked example recomputes
// The Worker sends each page already rendered. The first view replaces it in place, without a "Cargando…" flash.
let hydrating = app.dataset.ssr === location.pathname;

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
const ars = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const pctf = (n, d = 2) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n) + " %";
const usd = (n) => "US$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
const usd3 = (n) => "US$ " + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4, minimumFractionDigits: 2 }).format(n);
const monthName = (ym, year = true) =>
  new Intl.DateTimeFormat("es-AR", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(ym + "-15T00:00:00Z"));
const dayMonth = (d) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const nowMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);

const { addMonths, monthsBetween, rentForMonth, termsFromDetail } = window.AlDiaRent;

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.message || "Algo salió mal."), { status: r.status, body });
  return body;
}
let idxCache = null;
async function indices() {
  if (!idxCache) idxCache = await api("/api/indices");
  return idxCache;
}

function shell(...content) {
  const first = hydrating;
  hydrating = false;
  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "/", "data-link": 1 }, h("img", { src: "/logo.svg", alt: "" }), "Al Día"),
      h("nav", {}, h("a", { href: "/calculadora", "data-link": 1 }, "Calculadora"), h("a", { href: "/nuevo", "data-link": 1 }, "Cargar contrato"))),
    h("main", { class: "wrap" }, ...content),
    h("footer", {}, h("div", { class: "wrap" },
      h("p", {}, "Al Día es un producto de Swift Bot Labs. No somos una inmobiliaria ni un banco, y este sitio no reemplaza tu contrato ni un asesoramiento legal o impositivo."),
      h("p", {}, h("a", { href: "/transparencia", "data-link": 1 }, "Transparencia"), " · ",
        h("a", { href: "/probar" }, "Probalo con 1.000 wARS"), " · ",
        h("a", { href: "https://github.com/swiftbotlabs/aldia", rel: "noopener" }, "Código abierto"), " · Índices: ",
        h("a", { href: INDEC_PAGE, rel: "noopener" }, "INDEC"), " y ", h("a", { href: BCRA_PAGE, rel: "noopener" }, "BCRA")))));
  if (!first) window.scrollTo(0, 0);
}
// A loading placeholder, skipped while the server-rendered page is still on screen.
function loading(...content) {
  if (!hydrating) shell(...content);
}

/* ---------- Home ---------- */
function viewHome() {
  document.title = "Al Día · El alquiler que se actualiza y se cobra solo";
  shell(
    h("section", { class: "hero" },
      h("h1", {}, "El alquiler que se actualiza y se cobra solo."),
      h("p", {}, "Cargás el contrato una vez. Cada mes calculamos el monto con el índice oficial, tu inquilino paga por transferencia y vos cobrás en pesos, en dólares o en las dos cosas."),
      h("div", { class: "row" },
        h("a", { class: "btn", href: "/nuevo", "data-link": 1 }, "Cargar mi contrato"),
        h("a", { class: "btn ghost", href: "/calculadora", "data-link": 1 }, "Calcular un aumento"))),
    h("section", { class: "steps", "aria-label": "Cómo funciona" },
      h("div", { class: "card" }, h("span", { class: "num" }, "1"), h("h3", {}, "Cargás el contrato"),
        h("p", { class: "muted small" }, "Monto, fecha de inicio, índice (IPC, ICL o un porcentaje fijo) y cada cuánto aumenta. Si lo tenés en PDF, lo leemos por vos.")),
      h("div", { class: "card" }, h("span", { class: "num" }, "2"), h("h3", {}, "Mandás un solo link"),
        h("p", { class: "muted small" }, "Tu inquilino ve cuánto paga este mes, por qué y de dónde sale el número. Paga por transferencia desde su banco, como siempre.")),
      h("div", { class: "card" }, h("span", { class: "num" }, "3"), h("h3", {}, "Cobrás como quieras"),
        h("p", { class: "muted small" }, "Apenas entra el pago, el agente lo concilia, te manda la parte en pesos, pasa a dólares lo que elegiste y deja el recibo listo."))),
    h("section", { class: "card" },
      h("h2", {}, "Lo que deja de ser tu problema"),
      h("p", {}, "Buscar el IPC del trimestre, hacer la cuenta, mandar el mensaje, mirar el banco para ver si pagó, armar el recibo y correr a comprar dólares antes de que se devalúe. Todo eso lo hace el agente, todos los meses, y lo deja a la vista de las dos partes."),
      h("p", { class: "muted small" }, "El cálculo usa solo fuentes oficiales: INDEC para el IPC y el BCRA para el ICL. Si esas fuentes no coinciden entre sí, el agente no emite el aumento hasta que se aclare.")),
    h("section", { class: "faq" },
      h("h2", {}, "Preguntas"),
      h("h3", {}, "¿Mi inquilino necesita saber de cripto?"),
      h("p", { class: "muted" }, "No. Paga por transferencia a través de Ripio, que convierte los pesos en wARS, un peso digital 1 a 1. La primera vez Ripio le pide validar su identidad."),
      h("h3", {}, "¿Quién tiene la plata?"),
      h("p", { class: "muted" }, "Cada contrato tiene su propia cuenta en la red Celo, un contrato inteligente que solo te puede pagar a vos. El agente puede repartir lo cobrado, pero no puede mandarlo a otro lado, y vos podés retirar todo o sacarlo del medio cuando quieras."),
      h("h3", {}, "¿Qué necesito para cobrar?"),
      h("p", { class: "muted" }, "Una billetera compatible con Celo, como MiniPay, Valora o MetaMask. Después podés pasar los pesos a tu banco con Ripio."),
      h("h3", {}, "¿Cuánto cuesta?"),
      h("p", { class: "muted" }, "0,3 % de cada alquiler cobrado. Se descuenta solo y lo ves en cada recibo. Calcular aumentos con la calculadora es gratis."),
      h("h3", {}, "¿Puedo usarlo con mi contrato actual?"),
      h("p", { class: "muted" }, "Sí, si las dos partes están de acuerdo. Al Día no cambia el contrato: aplica lo que dice. Revisá que el índice y los meses que usamos coincidan con tu cláusula."),
      h("h3", {}, "¿Qué pasa si el dólar se mueve fuerte?"),
      h("p", { class: "muted" }, "Cada conversión tiene un piso de precio que calcula el propio contrato. Si el mercado está por debajo, el agente no convierte y ese mes cobrás todo en pesos."),
      h("h3", {}, "¿Y si el pago entra incompleto?"),
      h("p", { class: "muted" }, "Queda en la cuenta del contrato y lo ves como pago parcial. El agente reparte cuando entra el resto, y vos podés retirarlo antes con tu billetera."),
      h("h3", {}, "¿Reemplaza la factura?"),
      h("p", { class: "muted" }, "No. El recibo de Al Día es un comprobante informativo. Lo que tengas que facturar o declarar lo seguís haciendo como siempre."),
      h("h3", {}, "¿Ya lo usa gente?"),
      h("p", { class: "muted" }, "Estamos arrancando. En ", h("a", { href: "/transparencia", "data-link": 1 }, "Transparencia"), " publicamos cuántos contratos y pagos son reales y cuáles son pruebas nuestras."))
  );
}

/* ---------- Calculator ---------- */
function field(labelText, control, hint, errKey, errors) {
  return h("div", {},
    h("label", {}, labelText, hint ? h("span", { class: "hint" }, hint) : null, control),
    errors && errors[errKey] ? h("div", { class: "err" }, errors[errKey]) : null);
}
function selectEl(value, options, onchange) {
  return h("select", { onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t)));
}
const PERIODS = [[1, "Todos los meses"], [2, "Cada 2 meses"], [3, "Cada 3 meses"], [4, "Cada 4 meses"], [6, "Cada 6 meses"], [12, "Cada 12 meses"]];
const INDEX_NAMES = { IPC: "IPC (INDEC)", ICL: "ICL (BCRA)", FIJO: "Porcentaje fijo" };

function explainRent(r, lease) {
  if (!r) return null;
  if (r.missing) return h("div", { class: "note warn" }, `Todavía no se publicó el ${r.missing}. El aumento se calcula apenas salga.`);
  if (r.adjustments === 0) return h("p", { class: "muted" }, "Sin aumentos todavía: este es el monto inicial del contrato.");
  const rows = [["Monto inicial", ars(r.baseRent)], ["Aumento acumulado", "+" + pctf(r.pct)]];
  if (r.stepPct !== undefined) rows.push(["Último aumento", "+" + pctf(r.stepPct)]);
  if (r.monthsUsed) rows.push(["Meses de IPC usados", r.monthsUsed.map((m) => monthName(m, false)).join(", ") + " " + r.monthsUsed.at(-1).slice(0, 4)]);
  const lv = (v) => (Number.isFinite(v) ? String(v).replace(".", ",") : "—");
  if (r.index === "ICL") rows.push(["ICL usado", `${lv(r.levelFrom)} → ${lv(r.levelTo)}`]);
  return h("div", {},
    h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    r.index === "IPC" ? h("p", { class: "small muted", style: "margin-top:10px" }, "Fuente: ", h("a", { href: INDEC_PAGE, rel: "noopener" }, "INDEC, IPC nivel general nacional"), ".") : null,
    r.index === "ICL" ? h("p", { class: "small muted", style: "margin-top:10px" }, "Fuente: ", h("a", { href: BCRA_PAGE, rel: "noopener" }, "BCRA, Índice para Contratos de Locación"), ".") : null);
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
const level = (n) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(n);
const factor6 = (n) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(n);
function exampleCard(ex) {
  if (!ex) return null;
  const { terms, r, from, to, factor, agent, label } = ex;
  const period = (PERIODS.find(([n]) => n === terms.periodMonths) || [0, ""])[1].toLowerCase();
  return h("section", { class: "card", id: "ejemplo" },
    h("h2", {}, "Ejemplo resuelto"),
    h("p", { class: "small muted" }, "El ", h("a", { href: `/pagar/${SAMPLE_TENANT}`, "data-link": 1 }, "contrato de prueba"), ` «${label}», con los datos que publica el agente, recalculado acá con los índices oficiales.`),
    h("dl", { class: "kv" },
      h("dt", {}, "Alquiler inicial"), h("dd", {}, ars(terms.baseRent)),
      h("dt", {}, "Inicio del contrato"), h("dd", {}, monthName(terms.startDate.slice(0, 7))),
      h("dt", {}, "Índice"), h("dd", {}, `${INDEX_NAMES.IPC}, ${period}`),
      h("dt", {}, "Alquiler de"), h("dd", {}, monthName(r.month))),
    h("p", { class: "small", style: "margin:12px 0 4px" }, `IPC de ${monthName(r.refTo)}: ${level(to)}`, h("br"), `IPC de ${monthName(r.refFrom)}: ${level(from)}`),
    h("p", { class: "small", style: "margin:0 0 4px" }, `${level(to)} ÷ ${level(from)} = ${factor6(factor)}`),
    h("p", { class: "small", style: "margin:0" }, `${ars(terms.baseRent)} × ${factor6(factor)} = `, h("b", {}, ars(r.amount)), ", redondeado al peso."),
    explainRent(r),
    agent === null ? null : h("p", { class: "small", style: "margin:12px 0 0" },
      agent === r.amount ? `El agente cobró ${ars(agent)} en ese contrato: coincide.` : `El agente publicó ${ars(agent)} para ese mes.`));
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

async function viewCalc() {
  document.title = "Calculadora de aumento de alquiler · Al Día";
  const s = calcStart();
  const result = h("div", {});
  function compute(idx) {
    const base = parseInt(String(s.baseRent).replace(/\D/g, ""), 10);
    if (!base || !s.startDate) {
      result.replaceChildren();
      return;
    }
    const lease = { ...s, baseRent: base, fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
    const m = nowMonth();
    const r = rentForMonth(lease, m, idx);
    if (!r) {
      result.replaceChildren(h("div", { class: "note" }, "El contrato todavía no empezó."));
      return;
    }
    const next = addMonths(r.adjustmentMonth, lease.periodMonths);
    result.replaceChildren(h("div", { class: "card" },
      h("div", { class: "muted small" }, `Alquiler de ${monthName(m)}`),
      r.missing ? null : h("div", { class: "amount" }, ars(r.amount)),
      explainRent(r, lease),
      h("p", { class: "muted small", style: "margin-top:12px" }, `Próximo aumento: ${monthName(next)}.`),
      h("a", { class: "btn block", href: "/nuevo", "data-link": 1 }, "Que se haga solo todos los meses")));
  }
  const head = [h("h1", {}, "Calculadora de aumento"), h("p", { class: "muted" }, "Gratis y con datos oficiales. No hace falta registrarse.")];
  loading(...head, h("div", { class: "card", id: "calc" }, h("p", { class: "muted" }, "Cargando índices…")));
  const pubP = api(`/api/lease/${SAMPLE_TENANT}`).catch(() => null);
  let idx;
  try {
    idx = await indices();
  } catch {
    shell(...head, h("div", { class: "card", id: "calc" }, h("div", { class: "note err" }, "No pudimos traer los índices. Probá en un rato.")));
    return;
  }
  const run = () => compute(idx);
  const fixedRow = h("div", { style: s.index === "FIJO" ? "" : "display:none" }, field("Porcentaje de cada aumento", h("input", { inputmode: "decimal", placeholder: "10", value: s.fixedPct, oninput: (e) => { s.fixedPct = e.target.value; run(); } })));
  const lagRow = h("div", { style: s.index === "IPC" ? "" : "display:none" }, field("Meses de IPC", selectEl(s.lagMonths, [[2, "El último publicado al inicio del mes (lo más común)"], [1, "Incluye el mes anterior al aumento"]], (v) => { s.lagMonths = +v; run(); })));
  const example = h("div", {});
  shell(...head,
    h("div", { class: "card", id: "calc" },
      field("Alquiler inicial del contrato", h("input", { inputmode: "numeric", placeholder: "$ 500.000", autocomplete: "off", value: s.baseRent, oninput: (e) => { s.baseRent = e.target.value; run(); } })),
      field("Fecha de inicio del contrato", h("input", { type: "date", value: s.startDate, oninput: (e) => { s.startDate = e.target.value; run(); } })),
      field("¿Con qué índice aumenta?", selectEl(s.index, Object.entries(INDEX_NAMES), (v) => { s.index = v; fixedRow.style.display = v === "FIJO" ? "" : "none"; lagRow.style.display = v === "IPC" ? "" : "none"; run(); })),
      field("¿Cada cuánto aumenta?", selectEl(s.periodMonths, PERIODS, (v) => { s.periodMonths = +v; run(); })),
      lagRow, fixedRow,
      h("p", { class: "tiny", style: "margin:12px 0 0" }, `IPC disponible hasta ${monthName(idx.ipcLast)}. Datos leídos de INDEC y BCRA el ${idx.retrievedAt.slice(0, 10)}.`)),
    result, example);
  run();
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
  if (file.size > 8e6) throw new Error("El archivo pesa más de 8 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") throw new Error("Ese archivo no es un PDF.");
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((x) => x.str).join(" ") + "\n";
  }
  return out;
}

function viewNew() {
  document.title = "Cargar contrato · Al Día";
  const s = Object.assign({ step: 1, baseRent: "", startDate: "", dueDay: 10, index: "IPC", periodMonths: 3, lagMonths: 2, fixedPct: "", propertyLabel: "", tenantLabel: "", sweepBps: 5000, payout: "" }, loadDraft());
  let errors = {};
  let busy = false;
  const root = h("div", {});
  shell(h("h1", {}, "Cargá tu contrato"), root);

  function choice(name, val, title, sub) {
    return h("label", { class: "choice" + (String(s[name]) === String(val) ? " on" : "") },
      h("input", { type: "radio", name, checked: String(s[name]) === String(val), onchange: () => { s[name] = typeof s[name] === "number" ? +val : val; draw(); } }), title, sub ? h("small", {}, sub) : null);
  }
  async function preview() {
    const box = h("div", { class: "note" }, "Calculando…");
    const base = parseInt(String(s.baseRent).replace(/\D/g, ""), 10);
    if (!base || !s.startDate) return h("div", {});
    indices().then((idx) => {
      const lease = { ...s, baseRent: base, fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
      const m = nowMonth();
      const r = rentForMonth(lease, m < s.startDate.slice(0, 7) ? s.startDate.slice(0, 7) : m, idx);
      if (!r || r.missing) return box.replaceChildren(r ? `Falta el ${r.missing}.` : "");
      box.replaceChildren(`Con estos datos, el alquiler de ${monthName(r.month, false)} es `, h("b", {}, ars(r.amount)),
        r.adjustments ? ` (+${pctf(r.pct)} desde el inicio).` : " (sin aumentos todavía).");
    }).catch(() => box.remove());
    return box;
  }
  function readBox() {
    const status = h("div", {});
    const onFile = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      status.replaceChildren(h("div", { class: "note" }, "Leyendo el PDF en tu celular…"));
      try {
        const raw = await pdfText(f);
        if (raw.replace(/\s/g, "").length < 200) {
          status.replaceChildren(h("div", { class: "note warn" }, "Este PDF parece una foto y no tiene texto. Cargá los datos a mano."));
          return;
        }
        await sendForReading(redact(raw), status);
      } catch (err) {
        status.replaceChildren(h("div", { class: "note warn" }, err.message && err.message.length > 5 ? err.message : "No pudimos leer ese archivo. Cargá los datos a mano."));
      }
    };
    return h("details", { class: "card" },
      h("summary", {}, "¿Tenés el contrato en PDF? Lo leemos por vos"),
      h("p", { class: "small muted" }, "El PDF no sale de tu teléfono: sacamos el texto acá mismo, borramos DNI, CUIT, CBU, mails y teléfonos, y le pasamos solo eso a un modelo de lenguaje para encontrar el monto, las fechas y el índice. Después revisás vos."),
      h("input", { type: "file", accept: "application/pdf", onchange: onFile }), status);
  }
  async function sendForReading(text, status) {
    status.replaceChildren(h("div", { class: "note" }, "Mandamos el texto sin datos personales. Esto puede tardar un minuto."));
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
        root.prepend(h("div", { class: "note" }, "Listo. Completamos lo que encontramos: revisá cada dato contra tu contrato antes de seguir."));
        return;
      }
      if (res.status === "failed") break;
    }
    status.replaceChildren(h("div", { class: "note warn" }, "No pudimos leerlo esta vez. Cargá los datos a mano."));
  }

  async function step1() {
    return [
      readBox(),
      h("div", { class: "card" },
        field("Alquiler inicial del contrato", h("input", { inputmode: "numeric", placeholder: "$ 500.000", value: s.baseRent, oninput: (e) => { s.baseRent = e.target.value; } }), "El monto que figura en el contrato, en pesos.", "baseRent", errors),
        field("Fecha de inicio del contrato", h("input", { type: "date", value: s.startDate, onchange: (e) => { s.startDate = e.target.value; draw(); } }), null, "startDate", errors),
        h("label", {}, "¿Con qué índice aumenta?"),
        h("div", { class: "choices" }, choice("index", "IPC", "IPC", "INDEC"), choice("index", "ICL", "ICL", "BCRA"), choice("index", "FIJO", "Fijo", "Un porcentaje")),
        s.index === "FIJO" ? field("Porcentaje de cada aumento", h("input", { inputmode: "decimal", placeholder: "10", value: s.fixedPct, oninput: (e) => { s.fixedPct = e.target.value; } }), null, "fixedPct", errors) : null,
        field("¿Cada cuánto aumenta?", selectEl(s.periodMonths, PERIODS, (v) => { s.periodMonths = +v; draw(); }), null, "periodMonths", errors),
        s.index === "IPC" ? field("¿Qué meses de IPC usa tu contrato?", selectEl(s.lagMonths, [[2, "Los últimos publicados al inicio del mes (lo más común)"], [1, "Incluye el mes anterior al aumento"]], (v) => { s.lagMonths = +v; draw(); }), "INDEC publica cada IPC a mitad del mes siguiente.") : null,
        field("Día de vencimiento", h("input", { inputmode: "numeric", value: s.dueDay, oninput: (e) => { s.dueDay = parseInt(e.target.value, 10) || ""; } }), "Entre 1 y 28.", "dueDay", errors),
        await preview()),
    ];
  }
  function step2() {
    return [h("div", { class: "card" },
      field("¿Cómo llamamos a la propiedad?", h("input", { value: s.propertyLabel, maxlength: 60, placeholder: "Depto 2 ambientes, Almagro", oninput: (e) => { s.propertyLabel = e.target.value; } }), "Lo ve tu inquilino. No hace falta la dirección exacta.", "propertyLabel", errors),
      field("Nombre de tu inquilino (opcional)", h("input", { value: s.tenantLabel, maxlength: 40, placeholder: "Martina", oninput: (e) => { s.tenantLabel = e.target.value; } }), "Con un nombre de pila alcanza. Se usa para el mensaje de WhatsApp.", "tenantLabel", errors))];
  }
  function step3() {
    const pesos = 100 - s.sweepBps / 100;
    const label = h("div", { class: "split" }, h("span", {}, `${pesos} % pesos`), h("span", {}, `${s.sweepBps / 100} % dólares`));
    const connect = window.ethereum ? h("button", { class: "btn ghost block", type: "button", onclick: async () => {
      try {
        const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
        s.payout = a;
        draw();
      } catch { /* user said no */ }
    } }, "Usar la billetera de este teléfono") : null;
    return [h("div", { class: "card" },
      h("h3", {}, "¿Cómo querés cobrar?"),
      h("p", { class: "small muted" }, "Cada vez que entra un alquiler, la parte en dólares se convierte sola a USD₮ al mejor precio disponible, con un piso de seguridad. Lo podés cambiar después."),
      h("input", { type: "range", min: 0, max: 10000, step: 500, value: s.sweepBps, "aria-label": "Parte en dólares", oninput: (e) => {
        s.sweepBps = +e.target.value;
        label.replaceChildren(h("span", {}, `${100 - s.sweepBps / 100} % pesos`), h("span", {}, `${s.sweepBps / 100} % dólares`));
      } }),
      label),
      h("div", { class: "card" },
        h("h3", {}, "¿Dónde recibís?"),
        h("p", { class: "small muted" }, "Tu dirección en la red Celo. Empieza con 0x. La sacás de MiniPay, Valora o MetaMask, y solo vos tenés acceso."),
        h("details", {}, h("summary", {}, "No tengo billetera"),
          h("ol", { class: "small muted" },
            h("li", {}, "Instalá Valora o MetaMask en tu teléfono. Si ya usás Opera Mini, MiniPay viene incluida."),
            h("li", {}, "Creá tu billetera y guardá la frase de recuperación en papel. Nadie más la tiene que ver."),
            h("li", {}, "Copiá tu dirección, la que empieza con 0x, y pegala acá abajo. Sirve para la red Celo."))),
        connect,
        field("Dirección de tu billetera", h("input", { value: s.payout, autocomplete: "off", spellcheck: "false", placeholder: "0x…", class: "mono", oninput: (e) => { s.payout = e.target.value.trim(); } }), null, "payout", errors),
        h("p", { class: "tiny", style: "margin:10px 0 0" }, "Revisala dos veces. Esta dirección queda escrita en la cuenta del contrato y el agente no la puede cambiar.")),
      h("div", { class: "note" }, "Costo: 0,3 % de cada alquiler cobrado. Sin abono ni permanencia.")];
  }
  async function submit() {
    if (busy) return;
    busy = true;
    errors = {};
    const body = { ...s, baseRent: parseInt(String(s.baseRent).replace(/\D/g, ""), 10), fixedPct: parseFloat(String(s.fixedPct).replace(",", ".")) || 0 };
    try {
      const { id, token } = await api("/api/leases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      rememberLease(id, token, s.propertyLabel);
      history.pushState({}, "", `/panel/${id}#k=${token}`);
      route();
    } catch (e) {
      busy = false;
      if (e.body && e.body.fields) {
        errors = e.body.fields;
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
      if (!parseInt(String(s.baseRent).replace(/\D/g, ""), 10)) errors.baseRent = "Poné el monto del contrato.";
      if (!s.startDate) errors.startDate = "Poné la fecha de inicio.";
      if (!(s.dueDay >= 1 && s.dueDay <= 28)) errors.dueDay = "Elegí un día entre 1 y 28.";
      if (s.index === "FIJO" && !(parseFloat(String(s.fixedPct).replace(",", ".")) > 0)) errors.fixedPct = "Poné el porcentaje.";
    }
    if (s.step === 2 && !s.propertyLabel.trim()) errors.propertyLabel = "Poné un nombre corto para la propiedad.";
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
        s.step > 1 ? h("button", { class: "btn ghost", type: "button", onclick: () => { s.step--; draw(); } }, "Volver") : null,
        h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
          if (!validStep()) return draw();
          if (s.step < 3) {
            s.step++;
            draw();
            window.scrollTo(0, 0);
          } else submit();
        } }, s.step < 3 ? "Seguir" : "Crear la cuenta del contrato")),
    ].filter(Boolean));
  }
  draw();
}

/* ---------- Tenant ---------- */
function statusChip(st) {
  const map = { pagado: ["ok", "Pagado"], parcial: ["wait", "Pago parcial"], pendiente: ["wait", "Pendiente"], vencido: ["late", "Vencido"], "sin-indice": ["info", "Esperando índice"] };
  const [c, t] = map[st] || ["info", st];
  return h("span", { class: "chip " + c }, t);
}
function testBanner(pub) {
  if (pub.builderTest) return h("div", { class: "note warn" }, "Este es un contrato de prueba de Swift Bot Labs para mostrar el producto. No hay propietario ni inquilino reales.");
  return pub.probar === true && /^[0-9a-f]{12}$/.test(pub.id || "") ? h("div", { class: "note" }, "Prueba abierta de Al Día: quien paga es también el propietario, así que los wARS vuelven a su billetera, menos el 0,3 %. ", h("a", { href: `/probar/${pub.id}` }, "Ver los pasos"), ".") : null;
}
const BOT = "https://t.me/AlDiaAvisosBot";
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const isTx = (t) => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t);
const clauseNote = (c) => (c && c.clauseCheck ? h("p", { class: "small", style: "margin:10px 0 0" }, c.clauseCheck.ok ? "Revisamos este aumento contra la cláusula del contrato: coincide." : "Ojo: este aumento podría no coincidir con la cláusula del contrato. ", c.clauseCheck.ok ? null : c.clauseCheck.note,
  isTx(c.clauseCheck.tx) ? [" ", h("a", { href: TX_URL(c.clauseCheck.tx), rel: "noopener" }, "Ver la revisión paga en Celo"), "."] : null) : null);
const rampUrl = (amount, address) => `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=${amount}&address=${address}`;

const PAY_MSG = {
  es: { low: "Tu billetera no tiene suficientes wARS. Usá el pago por transferencia.", sent: "Pago enviado. En unos minutos el agente lo concilia y queda el recibo. ", see: "Ver operación", fail: "No se pudo enviar el pago." },
  en: { low: "Your wallet does not hold enough wARS.", sent: "Payment sent. The agent settles it within minutes and the receipt appears here. ", see: "See transaction", fail: "The payment could not be sent." },
};
async function payWithWallet(pub, status, msg = PAY_MSG.es, account = null) {
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

async function viewPay(id) {
  document.title = "Pagar alquiler · Al Día";
  loading(h("p", { class: "muted" }, "Cargando…"));
  let pub;
  try {
    pub = await api(`/api/lease/${id}`);
  } catch {
    shell(h("h1", {}, "No encontramos este alquiler"), h("p", { class: "muted" }, "Revisá el link que te pasaron."));
    return;
  }
  if (pub.preparing) {
    shell(h("h1", {}, "Estamos preparando este alquiler"), h("p", { class: "muted" }, "Tarda menos de dos minutos. Esta página se actualiza sola."));
    setTimeout(() => route(), 15000);
    return;
  }
  const c = pub.current;
  document.title = `${c ? `Alquiler de ${monthName(c.month, false)} · ` : ""}${pub.propertyLabel} · Al Día`;
  const status = h("div", {});
  const open = c && c.status !== "pagado" && c.amount && !pub.closed;
  const owed = c ? c.amount - (c.received || 0) : 0;
  shell(testBanner(pub),
    pub.closed ? h("div", { class: "note warn" }, "Este alquiler ya no se cobra por Al Día. Consultá con tu propietario antes de pagar.") : null,
    h("h1", {}, c ? `Alquiler de ${monthName(c.month, false)}` : "Alquiler"),
    h("p", { class: "muted" }, pub.propertyLabel),
    c ? h("section", { class: "card" },
      statusChip(c.status),
      h("div", { class: "amount" }, ars(open ? owed : c.amount)),
      open ? h("p", { class: "muted" }, `Vence el ${dayMonth(c.dueDate)}.`) : null,
      c.received && open ? h("p", { class: "small" }, `Ya recibimos ${ars(c.received)} de ${ars(c.amount)}.`) : null,
      h("details", { open: c.detail && c.detail.adjustments > 0 && c.detail.adjustmentMonth === c.month }, h("summary", {}, "¿Por qué este monto?"), explainRent(c.detail, pub)),
      clauseNote(c),
      pub.nextAdjustment ? h("p", { class: "small muted", style: "margin:10px 0 0" }, `Próximo aumento: ${monthName(pub.nextAdjustment)}.`) : null) : null,
    open ? h("section", {},
      h("a", { class: "btn block", href: rampUrl(owed, pub.collector), rel: "noopener" }, "Pagar por transferencia"),
      h("p", { class: "small muted", style: "margin-top:8px" }, "Te lleva a Ripio. Pagás en pesos desde tu banco o billetera y el pago llega directo a la cuenta de este alquiler. La primera vez Ripio te pide validar tu identidad."),
      window.ethereum ? h("button", { class: "btn ghost block", type: "button", onclick: () => payWithWallet(pub, status).catch(() => status.replaceChildren(h("div", { class: "note warn" }, "No se pudo enviar el pago."))) }, "Pagar con wARS desde esta billetera") : null,
      status,
      h("a", { class: "btn ghost block", style: "margin-top:10px", href: `${BOT}?start=t_${id}`, rel: "noopener" }, "Avisame por Telegram cuando venza")) : null,
    pub.history && pub.history.some((x) => x.status === "pagado") ? h("section", { class: "card" },
      h("h3", {}, "Recibos"),
      h("table", {}, pub.history.filter((x) => x.status === "pagado").map((x) => h("tr", {},
        h("td", {}, monthName(x.month)), h("td", { class: "r" }, ars(x.amount)),
        h("td", { class: "r" }, h("a", { href: `/recibo/${id}/${x.month}`, "data-link": 1 }, "Ver")))))) : null,
    h("p", { class: "tiny" }, "Esta cuenta solo le puede pagar al propietario. ", h("a", { href: LEASE_URL(pub.collector), rel: "noopener" }, "Ver la cuenta en Celo"), "."));
  if (open) setTimeout(() => { if (location.pathname === `/pagar/${id}`) route(); }, 30000);
}

/* ---------- Landlord ---------- */
// Actions only the landlord's own wallet can take on the lease contract. Nothing here passes through our servers.
// A plain projection for planning: the last three IPC prints repeated. Clearly labelled as an estimate.
function nextEstimate(c, t, idx) {
  if (!c || !c.amount) return "";
  if (t.index === "FIJO") return `Va a ser de ${ars(Math.floor(c.amount * (1 + t.fixedPct / 100) + 0.5))}.`;
  if (t.index !== "IPC" || !idx) return "";
  const months = Object.keys(idx.ipcMonthlyPct).sort().slice(-3);
  const avg = months.reduce((a, m) => a + idx.ipcMonthlyPct[m], 0) / months.length;
  const projected = c.amount * Math.pow(1 + avg / 100, t.periodMonths);
  return `Si la inflación sigue como en los últimos tres meses, sería de unos ${ars(Math.round(projected / 1000) * 1000)}.`;
}
async function landlordTx(pub, terms, data, status, okText) {
  const eth = window.ethereum;
  try {
    const [from] = await eth.request({ method: "eth_requestAccounts" });
    if (from.toLowerCase() !== terms.payout.toLowerCase()) {
      status.replaceChildren(h("div", { class: "note warn" }, `Conectá la billetera ${short(terms.payout)}: es la única que puede hacer esto.`));
      return;
    }
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] });
    } catch { /* MiniPay is already on Celo */ }
    const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to: pub.collector, data: data + TAG_SUFFIX }] });
    status.replaceChildren(h("div", { class: "note" }, okText, " ", h("a", { href: TX_URL(hash), rel: "noopener" }, "Ver operación")));
  } catch {
    status.replaceChildren(h("div", { class: "note warn" }, "No se pudo enviar. Probá de nuevo."));
  }
}
function controls(pub, t) {
  if (!pub || !pub.deployed) return null;
  if (!window.ethereum) {
    return h("section", { class: "card" }, h("h3", {}, "Tu cuenta, tus reglas"),
      h("p", { class: "small muted" }, `Abrí este link desde la billetera ${short(t.payout)} para cambiar qué parte pasa a dólares, retirar lo que haya en la cuenta o sacar al agente.`));
  }
  const status = h("div", {});
  let bps = pub.sweepBps;
  const label = h("div", { class: "split" }, h("span", {}, `${100 - bps / 100} % pesos`), h("span", {}, `${bps / 100} % dólares`));
  const uint = (n) => BigInt(n).toString(16).padStart(64, "0");
  return h("section", { class: "card" }, h("h3", {}, "Tu cuenta, tus reglas"),
    h("p", { class: "small muted" }, "Estas acciones las firmás vos con tu billetera. El agente no las puede hacer ni deshacer."),
    h("input", { type: "range", min: 0, max: 10000, step: 500, value: bps, "aria-label": "Parte en dólares", oninput: (e) => {
      bps = +e.target.value;
      label.replaceChildren(h("span", {}, `${100 - bps / 100} % pesos`), h("span", {}, `${bps / 100} % dólares`));
    } }),
    label,
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => landlordTx(pub, t, "0xd2d988d3" + uint(bps), status, "Listo: vale desde el próximo cobro.") }, "Guardar cómo cobro"),
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => landlordTx(pub, t, "0x51cff8d9" + WARS.slice(2).toLowerCase().padStart(64, "0"), status, "Listo: los pesos de la cuenta van a tu billetera.") }, "Retirar los pesos de la cuenta"),
    h("button", { class: "btn ghost block", type: "button", style: "margin-top:8px", onclick: () => {
      if (window.confirm("Si sacás al agente, deja de cobrar y repartir este alquiler para siempre. ¿Seguro?")) landlordTx(pub, t, "0x683e2f4f", status, "Listo: el agente ya no opera esta cuenta.");
    } }, "Sacar al agente de esta cuenta"),
    status);
}
async function viewPanel(id) {
  document.title = "Tu contrato · Al Día";
  const m = location.hash.match(/k=([0-9a-f]{32})/);
  let token = m && m[1];
  if (!token) {
    try {
      token = (JSON.parse(localStorage.getItem("aldia:mine") || "{}")[id] || {}).token;
    } catch { /* private mode */ }
  }
  if (!token) {
    shell(h("h1", {}, "Necesitás tu link privado"), h("p", { class: "muted" }, "Abrí el link que guardaste cuando creaste el contrato."));
    return;
  }
  loading(h("p", { class: "muted" }, "Cargando…"));
  let d;
  try {
    d = await api(`/api/panel/${id}`, { headers: { "x-aldia-key": token } });
  } catch (e) {
    shell(h("h1", {}, "No pudimos abrir el panel"), h("p", { class: "muted" }, e.message));
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
  const privateUrl = `${location.origin}/panel/${id}#k=${token}`;
  const greet = t.tenantLabel ? `Hola ${t.tenantLabel}!` : "Hola!";
  const msg = c
    ? `${greet} El alquiler de ${monthName(c.month, false)} de ${t.propertyLabel} es ${ars(c.amount)}. Acá ves el detalle y podés pagar por transferencia: ${tenantUrl}`
    : `${greet} Desde ahora el alquiler de ${t.propertyLabel} se paga por acá: ${tenantUrl}`;
  const copy = (text, btn) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn();
      old.textContent = "Copiado";
      setTimeout(() => { old.textContent = "Copiar link"; }, 1500);
    } catch { /* clipboard blocked */ }
  };
  let copyBtn;
  copyBtn = h("button", { class: "btn ghost", type: "button", onclick: copy(tenantUrl, () => copyBtn) }, "Copiar link");
  if (!pub) setTimeout(() => { if (location.pathname === `/panel/${id}`) route(); }, 15000);
  shell(pub ? testBanner(pub) : null,
    h("h1", {}, t.propertyLabel),
    !pub ? h("div", { class: "note" }, "Estamos preparando la cuenta de este contrato. Tarda menos de dos minutos.") : null,
    pub && pub.closed ? h("div", { class: "note warn" }, "Sacaste al agente de esta cuenta. Lo que entre queda ahí hasta que lo retires con tu billetera.") : null,
    h("div", { class: "note warn noprint" }, "Guardá este link: es tu acceso privado. ", h("span", { class: "mono" }, privateUrl)),
    c ? h("section", { class: "card" },
      h("div", { class: "muted small" }, `Alquiler de ${monthName(c.month)}`),
      statusChip(c.status),
      h("div", { class: "amount" }, ars(c.amount)),
      c.received ? h("p", { class: "small" }, `Recibido: ${ars(c.received)}.`) : null,
      h("details", {}, h("summary", {}, "Cómo se calculó"), explainRent(c.detail, t)),
      clauseNote(c),
      pub.nextAdjustment ? h("p", { class: "small muted", style: "margin:10px 0 0" }, `Próximo aumento: ${monthName(pub.nextAdjustment)}.`, " ", nextEstimate(c, t, idx)) : null) : null,
    h("section", { class: "card" },
      h("h3", {}, "Mandale el link a tu inquilino"),
      h("p", { class: "small muted" }, "Es siempre el mismo. Cada mes muestra el monto que corresponde."),
      h("div", { class: "row" },
        h("a", { class: "btn wa", style: "flex:1", href: `https://wa.me/?text=${encodeURIComponent(msg)}`, rel: "noopener" }, "Mandar por WhatsApp"),
        copyBtn)),
    h("section", { class: "card" },
      h("h3", {}, "Avisos"),
      h("p", { class: "small muted" }, "Te escribimos cuando entra un pago, cuando cambia el monto o si algo se atrasa."),
      h("a", { class: "btn ghost block", href: `${BOT}?start=l_${id}_${(await sha256Hex(token)).slice(0, 20)}`, rel: "noopener" }, "Recibir avisos por Telegram")),
    h("section", { class: "card" },
      h("h3", {}, "Cómo cobrás"),
      h("dl", { class: "kv" },
        h("dt", {}, "En pesos"), h("dd", {}, `${100 - (pub ? pub.sweepBps : t.sweepBps) / 100} %`),
        h("dt", {}, "En dólares (USD₮)"), h("dd", {}, `${(pub ? pub.sweepBps : t.sweepBps) / 100} %`),
        h("dt", {}, "Billetera"), h("dd", { class: "mono" }, short(t.payout)),
        h("dt", {}, "Índice"), h("dd", {}, INDEX_NAMES[t.index]),
        h("dt", {}, "Vence"), h("dd", {}, `Día ${t.dueDay}`)),
      h("p", { class: "small muted", style: "margin-top:10px" }, "¿Querés pasar pesos a tu banco? ",
        h("a", { href: `https://ramp.ripio.com/off-ramp?country=AR&chain=42220&token=WARS&amount=${c ? c.amount : 10000}`, rel: "noopener" }, "Hacelo con Ripio"), ".")),
    controls(pub, t),
    pub && pub.history && pub.history.length ? h("section", { class: "card" },
      h("h3", {}, "Historial"),
      h("table", {}, h("tr", {}, h("th", {}, "Mes"), h("th", { class: "r" }, "Monto"), h("th", { class: "r" }, "Estado")),
        pub.history.map((x) => h("tr", {}, h("td", {}, x.status === "pagado" ? h("a", { href: `/recibo/${id}/${x.month}`, "data-link": 1 }, monthName(x.month)) : monthName(x.month)), h("td", { class: "r" }, ars(x.amount)), h("td", { class: "r" }, statusChip(x.status)))))) : null,
    d.panel && d.panel.market ? h("section", { class: "card" },
      h("h3", {}, "¿Cómo está tu alquiler contra el mercado?"),
      h("p", {}, d.panel.market.summary),
      h("p", { class: "tiny" }, d.panel.market.source)) : null,
    pub ? h("p", { class: "tiny" }, "Cuenta del contrato: ", h("a", { href: LEASE_URL(pub.collector), rel: "noopener" }, short(pub.collector)), pub.deployed ? "" : " (se activa con el primer pago)") : null);
}

/* ---------- Receipt ---------- */
async function viewReceipt(id, month) {
  document.title = "Recibo · Al Día";
  loading(h("p", { class: "muted" }, "Cargando…"));
  let r;
  try {
    r = await api(`/api/recibo/${id}/${month}`);
  } catch {
    shell(h("h1", {}, "No hay recibo para ese mes"));
    return;
  }
  document.title = `Recibo de ${monthName(month)} · ${r.propertyLabel} · Al Día`;
  shell(r.builderTest ? h("div", { class: "note warn" }, "Recibo de prueba de Swift Bot Labs. No hay propietario ni inquilino reales.")
    : r.probar === true ? h("div", { class: "note" }, "Recibo de una prueba abierta de Al Día: quien pagó es también el propietario. ", h("a", { href: `/probar/${id}` }, "Ver los pasos"), ".") : null,
    h("section", { class: "card" },
      h("h1", {}, `Recibo de ${monthName(month)}`),
      h("p", { class: "muted" }, r.propertyLabel),
      h("div", { class: "amount" }, ars(r.received)),
      h("dl", { class: "kv" },
        h("dt", {}, "Alquiler del mes"), h("dd", {}, ars(r.amount)),
        h("dt", {}, "Cobrado el"), h("dd", {}, dayMonth(r.paidAt.slice(0, 10))),
        h("dt", {}, "Comisión Al Día"), h("dd", {}, ars(r.fee)),
        h("dt", {}, "Al propietario en pesos"), h("dd", {}, ars(r.pesoToLandlord)),
        h("dt", {}, "Al propietario en dólares"), h("dd", {}, r.dollarToLandlord ? usd(r.dollarToLandlord) : "—"),
        r.rate ? h("dt", {}, "Tipo de cambio") : null, r.rate ? h("dd", {}, `${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(r.rate)} por USD₮`) : null,
        r.rate ? h("dt", {}, "Convertido en") : null, r.rate ? h("dd", {}, r.route) : null),
      h("details", { open: true }, h("summary", {}, "Cómo se calculó el monto"), explainRent(r.detail, r)),
      h("p", { class: "small muted", style: "margin-top:14px" }, "Comprobantes en la red Celo: ",
        [...r.paymentTxs, ...(r.paymentTxsLate || [])].map((t, i) => [h("a", { href: TX_URL(t), rel: "noopener" }, "pago " + (i + 1)), ", "]),
        h("a", { href: TX_URL(r.settleTx), rel: "noopener" }, "liquidación")),
      h("p", { class: "tiny" }, "Huella del recibo: ", h("span", { class: "mono" }, r.receiptHash)),
      h("p", { class: "tiny" }, "Comprobante informativo. No reemplaza la factura ni el recibo que corresponda según tu situación impositiva."),
      h("button", { class: "btn ghost noprint", type: "button", onclick: () => window.print() }, "Imprimir o guardar en PDF")));
}

/* ---------- Transparency ---------- */
async function viewTransparency() {
  document.title = "Transparencia · Al Día";
  loading(h("h1", {}, "Transparencia"), h("p", { class: "muted" }, "Cargando…"));
  let s = {};
  let idx = null;
  let rents = [];
  let o = { count: 0, payments: 0, payers: [], notCounted: [], checkedAt: null };
  try {
    [s, idx, rents, o] = await Promise.all([api("/api/stats"), indices().catch(() => null), api("/api/pruebas").catch(() => []), api("/api/externos").catch(() => o)]);
  } catch { /* show what we have */ }
  const n = (v) => (v === undefined ? "—" : v);
  shell(h("h1", {}, "Transparencia"),
    h("p", { class: "muted" }, "Lo que se puede comprobar, con su fuente. Separamos lo nuestro de lo real."),
    h("section", { class: "stats" },
      h("div", { class: "stat" }, h("b", {}, n(o.count)), h("span", { class: "small muted" }, "pagadores externos verificados")),
      h("div", { class: "stat" }, h("b", {}, n(o.payments)), h("span", { class: "small muted" }, "pagos externos verificados")),
      h("div", { class: "stat" }, h("b", {}, n(s.leasesTest)), h("span", { class: "small muted" }, "contratos de prueba nuestros")),
      h("div", { class: "stat" }, h("b", {}, n(s.paymentsTest)), h("span", { class: "small muted" }, "pagos de prueba nuestros"))),
    h("section", { class: "card", style: "margin-top:14px" },
      h("h3", {}, "De dónde salen estos números"),
      h("p", { class: "small" }, s.note || "Un pago cuenta como externo solo si pasa el control de abajo, que se hace solo con datos públicos de la red. Nuestras pruebas se cuentan aparte, como pruebas nuestras."),
      s.updatedAt ? h("p", { class: "tiny" }, `Actualizado: ${s.updatedAt}`) : null),
    outsideCard(o),
    idx ? h("section", { class: "card" },
      h("h3", {}, "Índices oficiales"),
      h("dl", { class: "kv" },
        h("dt", {}, "Último IPC"), h("dd", {}, `${monthName(idx.ipcLast)}: ${pctf(idx.ipcMonthlyPct[idx.ipcLast], 1)}`),
        h("dt", {}, "Nivel"), h("dd", {}, new Intl.NumberFormat("es-AR").format(idx.ipc[idx.ipcLast])),
        h("dt", {}, "Controles"), h("dd", {}, idx.ok ? "Las fuentes coinciden" : "Hay una diferencia: el agente no emite aumentos"),
        h("dt", {}, "Leído el"), h("dd", {}, idx.retrievedAt.slice(0, 16).replace("T", " ") + " UTC")),
      h("p", { class: "small muted", style: "margin-top:10px" }, "IPC: archivo de INDEC, comparado contra la API de series del Ministerio de Economía y la variable 27 del BCRA. ICL: variable 40 del BCRA.")) : null,
    h("section", { class: "card" },
      h("h3", {}, "En la red"),
      h("dl", { class: "kv" },
        h("dt", {}, "Agente"), h("dd", {}, h("a", { href: "https://8004scan.io/agents/celo/10014", rel: "noopener" }, "ERC-8004 n.º 10014")),
        h("dt", {}, "Billetera del agente"), h("dd", {}, h("a", { href: LEASE_URL("0xED120aeC2240A25125B3f32Eb8Bff9C5F688121b"), rel: "noopener", class: "mono" }, "0xED12…121b")),
        h("dt", {}, "Fábrica de cuentas"), h("dd", {}, h("a", { href: LEASE_URL("0x1e7cbf5d31c85b168048115d0ae762463a475882"), rel: "noopener", class: "mono" }, "0x1e7c…5882"))),
      s.leases && s.leases.length ? h("table", { style: "margin-top:10px" }, s.leases.map((l) => h("tr", {}, h("td", {}, l.label), h("td", { class: "r" }, l.kind)))) : null),
    rents && rents.length ? h("section", { class: "card", id: "pruebas" },
      h("h3", {}, "Alquileres de prueba cobrados"),
      h("p", { class: "small muted" }, "Los pagamos nosotros con wARS propios para probar el ciclo completo. Cada uno tiene su recibo y sus operaciones en la red Celo."),
      h("table", {}, h("tr", {}, h("th", {}, "Contrato"), h("th", { class: "r" }, "Monto"), h("th", { class: "r" }, "En Celo")),
        rents.map((x) => h("tr", {},
          h("td", {}, h("a", { href: x.receipt, "data-link": 1 }, x.label), h("br"), h("span", { class: "tiny" }, monthName(x.month), x.route ? ` · ${x.route}` : "")),
          h("td", { class: "r" }, ars(x.amount)),
          h("td", { class: "r" },
            x.paymentTxs.map((t, i) => [h("a", { href: TX_URL(t), rel: "noopener" }, "pago" + (x.paymentTxs.length > 1 ? " " + (i + 1) : "")), h("br")]),
            x.settleTx ? [h("a", { href: TX_URL(x.settleTx), rel: "noopener" }, "liquidación"), h("br")] : null,
            x.lease ? h("a", { href: LEASE_URL(x.lease), rel: "noopener" }, "cuenta") : null))))) : null,
    s.paidCalls ? h("section", { class: "card" },
      h("h3", {}, "Servicios que pagamos"),
      h("p", { class: "small muted" }, `${s.paidCalls.count} llamadas pagas por x402 en Celo, por ${usd3(s.paidCalls.usd)} en total, desde la billetera del agente.`),
      h("table", {}, s.paidCalls.recent.map((c) => h("tr", {}, h("td", {}, c.service), h("td", { class: "r" }, usd3(c.usd)), h("td", { class: "r" }, c.tx ? h("a", { href: TX_URL(c.tx), rel: "noopener" }, "tx") : "—"))))) : null);
}

/* ---------- Outside payers (the Worker checks them; /api/externos returns only rows that passed its own validation) ---------- */
const REASON_ES = { ours: "billetera nuestra", "funded-by-us": "sus primeros fondos vinieron de una billetera nuestra", "new-wallet": "su primera operación en Celo es posterior al 6 de octubre de 2026",
  unclear: "no se ve de dónde salieron sus primeros fondos", "no-history": "el explorador todavía no muestra su historial", indirect: "los wARS no salieron directo de la billetera que firmó",
  partial: "pagó menos de la mitad del alquiler del mes", unchecked: "todavía no la pudimos revisar", invalid: "dirección inválida" };
const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const isDayStr = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
const dayFull = (d) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d.slice(0, 10) + "T12:00:00Z"));
function outsideCard(o) {
  const payers = (Array.isArray(o.payers) ? o.payers : []).filter((p) => p && isAddr(p.address) && isTx(p.tx));
  const skipped = (Array.isArray(o.notCounted) ? o.notCounted : []).filter((r) => r && Object.hasOwn(REASON_ES, r.reason));
  return h("section", { class: "card", id: "externos" },
    h("h3", {}, "Pagadores externos"),
    h("p", { class: "small" }, "Cuenta un alquiler ya liquidado que pagó, directo desde su billetera, alguien que no somos nosotros: la billetera no es nuestra, sus primeros fondos no vinieron de una billetera nuestra y tiene actividad en Celo desde antes del 6 de octubre de 2026. Este sitio lo revisa solo en el explorador público de Celo (Blockscout). Si algo no se puede comprobar, no cuenta. Como no sabemos quién está detrás de cada billetera, figuran como «otro equipo de la hackatón»."),
    payers.length ? h("table", {}, h("tr", {}, h("th", {}, "Billetera"), h("th", {}, "Pagó el"), h("th", { class: "r" }, "En Celo")),
      payers.map((p) => h("tr", {},
        h("td", {}, h("a", { href: LEASE_URL(p.address), rel: "noopener", class: "mono" }, short(p.address)), h("br"),
          h("span", { class: "tiny" }, "otro equipo de la hackatón", isDayStr(p.firstSeen) ? ` · en Celo desde ${monthName(p.firstSeen.slice(0, 7))}` : "")),
        h("td", {}, isDayStr(p.date) ? dayFull(p.date) : "—"),
        h("td", { class: "r" }, h("a", { href: TX_URL(p.tx), rel: "noopener" }, "pago"),
          typeof p.receipt === "string" && /^\/recibo\/[0-9a-f]{12}\/\d{4}-\d{2}$/.test(p.receipt) ? [h("br"), h("a", { href: p.receipt, "data-link": 1 }, "recibo")] : null))))
      : h("p", { class: "small muted", style: "margin:0" }, "Todavía ninguno. ", h("a", { href: "/probar" }, "Probalo con un alquiler real de 1.000 wARS"), ": vos sos el propietario, así que la plata te vuelve, menos el 0,3 %."),
    skipped.length ? [h("h3", { style: "margin-top:16px" }, "Pagos que no contamos"),
      h("table", {}, skipped.map((r) => h("tr", {},
        h("td", {}, isAddr(r.address) ? h("span", { class: "mono" }, short(r.address)) : "Billetera nuestra", h("br"), h("span", { class: "tiny" }, REASON_ES[r.reason])),
        h("td", { class: "r" }, isTx(r.tx) ? h("a", { href: TX_URL(r.tx), rel: "noopener" }, "pago") : "—"))))] : null,
    h("p", { class: "tiny", style: "margin:10px 0 0" }, isDayStr(o.checkedAt) ? `Revisado: ${o.checkedAt.slice(0, 16).replace("T", " ")} UTC${o.complete ? "" : ", la revisión sigue en curso"}.` : "La revisión todavía no corrió: hasta entonces no contamos a nadie."));
}

/* ---------- Open test (/probar): the server renders it; this only adds the wallet buttons and waits for the agent ---------- */
const PROBAR_MSG = {
  es: { connect: "Usar la billetera de este teléfono", pay: "Pagar 1.000 wARS desde esta billetera", other: (a, b) => `Ojo: estás pagando desde ${a}, pero la plata vuelve a ${b}. Si las dos son tuyas, tocá de nuevo.`, again: "Pagar igual", panel: "Tu panel de propietario, privado: guardá este link. Desde ahí podés retirar los wARS de la cuenta con tu billetera si algo falla.", panelLink: "Abrir mi panel" },
  en: { connect: "Use this phone's wallet", pay: "Pay 1,000 wARS from this wallet", other: (a, b) => `Careful: you are paying from ${a}, but the money goes back to ${b}. If both are yours, tap again.`, again: "Pay anyway", panel: "Your private landlord panel: keep this link. From there your wallet can withdraw the wARS from the lease account if anything goes wrong.", panelLink: "Open my panel" },
};
function probarEnhance(id) {
  const lang = document.documentElement.lang === "en" ? "en" : "es";
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
    panel.replaceChildren(t.panel, " ", h("a", { href: `/panel/${id}#k=${k[1]}`, rel: "noopener" }, t.panelLink));
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
function viewProbar(p) {
  // Server-rendered only: a page reached from inside the app is loaded fresh from the server.
  if (!hydrating) return location.reload();
  hydrating = false;
  const m = p.match(/^\/probar\/([0-9a-f]{12})$/);
  probarEnhance(m ? m[1] : null);
}

/* ---------- Router ---------- */
function route() {
  const p = location.pathname;
  let m;
  if (p === "/" || p === "") return viewHome();
  if (p === "/calculadora") return viewCalc();
  if (p === "/nuevo") return viewNew();
  if (p === "/transparencia") return viewTransparency();
  if (p === "/probar" || /^\/probar\/[0-9a-f]{12}$/.test(p)) return viewProbar(p);
  if ((m = p.match(/^\/pagar\/([0-9a-f]{12})$/))) return viewPay(m[1]);
  if ((m = p.match(/^\/panel\/([0-9a-f]{12})$/))) return viewPanel(m[1]);
  if ((m = p.match(/^\/recibo\/([0-9a-f]{12})\/(\d{4}-\d{2})$/))) return viewReceipt(m[1], m[2]);
  shell(h("h1", {}, "Esta página no existe"), h("p", {}, h("a", { href: "/", "data-link": 1 }, "Volver al inicio")));
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  history.pushState({}, "", a.getAttribute("href"));
  route();
});
window.addEventListener("popstate", route);
route();
