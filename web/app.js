"use strict";
/* Al Día front end. No framework and no user text goes through innerHTML: h() builds nodes and text stays text. */
const WARS = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const TAG_SUFFIX = "63656c6f5f326565303237303461353664110080218021802180218021802180218021"; // ERC-8021: celo_2ee02704a56d
const LEASE_URL = (a) => `https://celoscan.io/address/${a}`;
const TX_URL = (t) => `https://celoscan.io/tx/${t}`;
const INDEC_PAGE = "https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31";
const BCRA_PAGE = "https://www.bcra.gob.ar/estadisticas-indicadores/";
const app = document.getElementById("app");

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

const { addMonths, monthsBetween, rentForMonth } = window.AlDiaRent;

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
  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "/", "data-link": 1 }, h("img", { src: "/logo.svg", alt: "" }), "Al Día"),
      h("nav", {}, h("a", { href: "/calculadora", "data-link": 1 }, "Calculadora"), h("a", { href: "/nuevo", "data-link": 1 }, "Cargar contrato"))),
    h("main", { class: "wrap" }, ...content),
    h("footer", {}, h("div", { class: "wrap" },
      h("p", {}, "Al Día es un producto de Swift Bot Labs. No somos una inmobiliaria ni un banco, y este sitio no reemplaza tu contrato ni un asesoramiento legal o impositivo."),
      h("p", {}, h("a", { href: "/transparencia", "data-link": 1 }, "Transparencia"), " · ",
        h("a", { href: "https://github.com/swiftbotlab/aldia", rel: "noopener" }, "Código abierto"), " · Índices: ",
        h("a", { href: INDEC_PAGE, rel: "noopener" }, "INDEC"), " y ", h("a", { href: BCRA_PAGE, rel: "noopener" }, "BCRA")))));
  window.scrollTo(0, 0);
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
  if (r.index === "ICL") rows.push(["ICL usado", `${String(r.levelFrom).replace(".", ",")} → ${String(r.levelTo).replace(".", ",")}`]);
  return h("div", {},
    h("dl", { class: "kv" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    r.index === "IPC" ? h("p", { class: "small muted", style: "margin-top:10px" }, "Fuente: ", h("a", { href: INDEC_PAGE, rel: "noopener" }, "INDEC, IPC nivel general nacional"), ".") : null,
    r.index === "ICL" ? h("p", { class: "small muted", style: "margin-top:10px" }, "Fuente: ", h("a", { href: BCRA_PAGE, rel: "noopener" }, "BCRA, Índice para Contratos de Locación"), ".") : null);
}

async function viewCalc() {
  document.title = "Calculadora de aumento de alquiler · Al Día";
  const s = { baseRent: "", startDate: "", index: "IPC", periodMonths: 3, lagMonths: 2, fixedPct: "" };
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
  shell(h("h1", {}, "Calculadora de aumento"),
    h("p", { class: "muted" }, "Gratis y con datos oficiales. No hace falta registrarse."),
    h("div", { class: "card", id: "calc" }, h("p", { class: "muted" }, "Cargando índices…")),
    result);
  let idx;
  try {
    idx = await indices();
  } catch {
    document.getElementById("calc").replaceChildren(h("div", { class: "note err" }, "No pudimos traer los índices. Probá en un rato."));
    return;
  }
  const run = () => compute(idx);
  const fixedRow = h("div", { style: s.index === "FIJO" ? "" : "display:none" }, field("Porcentaje de cada aumento", h("input", { inputmode: "decimal", placeholder: "10", oninput: (e) => { s.fixedPct = e.target.value; run(); } })));
  const lagRow = h("div", {}, field("Meses de IPC", selectEl(2, [[2, "El último publicado al inicio del mes (lo más común)"], [1, "Incluye el mes anterior al aumento"]], (v) => { s.lagMonths = +v; run(); })));
  document.getElementById("calc").replaceChildren(
    field("Alquiler inicial del contrato", h("input", { inputmode: "numeric", placeholder: "$ 500.000", autocomplete: "off", oninput: (e) => { s.baseRent = e.target.value; run(); } })),
    field("Fecha de inicio del contrato", h("input", { type: "date", oninput: (e) => { s.startDate = e.target.value; run(); } })),
    field("¿Con qué índice aumenta?", selectEl("IPC", Object.entries(INDEX_NAMES), (v) => { s.index = v; fixedRow.style.display = v === "FIJO" ? "" : "none"; lagRow.style.display = v === "IPC" ? "" : "none"; run(); })),
    field("¿Cada cuánto aumenta?", selectEl(3, PERIODS, (v) => { s.periodMonths = +v; run(); })),
    lagRow, fixedRow,
    h("p", { class: "tiny", style: "margin:12px 0 0" }, `IPC disponible hasta ${monthName(idx.ipcLast)}. Datos leídos de INDEC y BCRA el ${idx.retrievedAt.slice(0, 10)}.`));
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
  return pub.builderTest ? h("div", { class: "note warn" }, "Este es un contrato de prueba de Swift Bot Labs para mostrar el producto. No hay propietario ni inquilino reales.") : null;
}
const BOT = "https://t.me/AlDiaAvisosBot";
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const clauseNote = (c) => (c && c.clauseCheck ? h("p", { class: "small", style: "margin:10px 0 0" }, c.clauseCheck.ok ? "Revisamos este aumento contra la cláusula del contrato: coincide." : "Ojo: este aumento podría no coincidir con la cláusula del contrato. ", c.clauseCheck.ok ? null : c.clauseCheck.note) : null);
const rampUrl = (amount, address) => `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=${amount}&address=${address}`;

async function payWithWallet(pub, status) {
  const eth = window.ethereum;
  const [from] = await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] });
  } catch { /* MiniPay is already on Celo */ }
  const owed = BigInt(pub.current.amount - (pub.current.received || 0)) * 10n ** 18n;
  const data = "0xa9059cbb" + pub.collector.slice(2).toLowerCase().padStart(64, "0") + owed.toString(16).padStart(64, "0") + TAG_SUFFIX;
  const bal = await eth.request({ method: "eth_call", params: [{ to: WARS, data: "0x70a08231" + from.slice(2).toLowerCase().padStart(64, "0") }, "latest"] });
  if (BigInt(bal) < owed) {
    status.replaceChildren(h("div", { class: "note warn" }, "Tu billetera no tiene suficientes wARS. Usá el pago por transferencia."));
    return;
  }
  const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from, to: WARS, data }] });
  status.replaceChildren(h("div", { class: "note" }, "Pago enviado. En unos minutos el agente lo concilia y queda el recibo. ", h("a", { href: TX_URL(hash), rel: "noopener" }, "Ver operación")));
}

async function viewPay(id) {
  document.title = "Pagar alquiler · Al Día";
  shell(h("p", { class: "muted" }, "Cargando…"));
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
  const status = h("div", {});
  const open = c && c.status !== "pagado";
  const owed = c ? c.amount - (c.received || 0) : 0;
  shell(testBanner(pub),
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
  shell(h("p", { class: "muted" }, "Cargando…"));
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
    h("div", { class: "note warn noprint" }, "Guardá este link: es tu acceso privado. ", h("span", { class: "mono" }, privateUrl)),
    c ? h("section", { class: "card" },
      h("div", { class: "muted small" }, `Alquiler de ${monthName(c.month)}`),
      statusChip(c.status),
      h("div", { class: "amount" }, ars(c.amount)),
      c.received ? h("p", { class: "small" }, `Recibido: ${ars(c.received)}.`) : null,
      h("details", {}, h("summary", {}, "Cómo se calculó"), explainRent(c.detail, t)),
      clauseNote(c),
      pub.nextAdjustment ? h("p", { class: "small muted", style: "margin:10px 0 0" }, `Próximo aumento: ${monthName(pub.nextAdjustment)}.`) : null) : null,
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
  shell(h("p", { class: "muted" }, "Cargando…"));
  let r;
  try {
    r = await api(`/api/recibo/${id}/${month}`);
  } catch {
    shell(h("h1", {}, "No hay recibo para ese mes"));
    return;
  }
  shell(r.builderTest ? h("div", { class: "note warn" }, "Recibo de prueba de Swift Bot Labs. No hay propietario ni inquilino reales.") : null,
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
  shell(h("h1", {}, "Transparencia"), h("p", { class: "muted" }, "Cargando…"));
  let s = {};
  let idx = null;
  try {
    [s, idx] = await Promise.all([api("/api/stats"), indices().catch(() => null)]);
  } catch { /* show what we have */ }
  const n = (v) => (v === undefined ? "—" : v);
  shell(h("h1", {}, "Transparencia"),
    h("p", { class: "muted" }, "Lo que se puede comprobar, con su fuente. Separamos lo nuestro de lo real."),
    h("section", { class: "stats" },
      h("div", { class: "stat" }, h("b", {}, n(s.leasesThird)), h("span", { class: "small muted" }, "contratos de terceros")),
      h("div", { class: "stat" }, h("b", {}, n(s.paymentsThird)), h("span", { class: "small muted" }, "pagos de terceros")),
      h("div", { class: "stat" }, h("b", {}, n(s.leasesTest)), h("span", { class: "small muted" }, "contratos de prueba nuestros")),
      h("div", { class: "stat" }, h("b", {}, n(s.paymentsTest)), h("span", { class: "small muted" }, "pagos de prueba nuestros"))),
    h("section", { class: "card", style: "margin-top:14px" },
      h("h3", {}, "De dónde salen estos números"),
      h("p", { class: "small" }, s.note || "Un pago cuenta como de terceros solo si los wARS no salieron de una billetera nuestra. Hasta que eso pase, todo lo que ves son pruebas hechas por nosotros."),
      s.updatedAt ? h("p", { class: "tiny" }, `Actualizado: ${s.updatedAt}`) : null),
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
        h("dt", {}, "Fábrica de cuentas"), h("dd", {}, h("a", { href: LEASE_URL("0x4690e265fd2d542e1b44ac7ba41f796a474b11c1"), rel: "noopener", class: "mono" }, "0x4690…11c1"))),
      s.leases && s.leases.length ? h("table", { style: "margin-top:10px" }, s.leases.map((l) => h("tr", {}, h("td", {}, l.label), h("td", { class: "r" }, l.kind)))) : null),
    s.paidCalls ? h("section", { class: "card" },
      h("h3", {}, "Servicios que pagamos"),
      h("p", { class: "small muted" }, `${s.paidCalls.count} llamadas pagas por x402 en Celo, por ${usd3(s.paidCalls.usd)} en total, desde la billetera del agente.`),
      h("table", {}, s.paidCalls.recent.map((c) => h("tr", {}, h("td", {}, c.service), h("td", { class: "r" }, usd3(c.usd)), h("td", { class: "r" }, c.tx ? h("a", { href: TX_URL(c.tx), rel: "noopener" }, "tx") : "—"))))) : null);
}

/* ---------- Router ---------- */
function route() {
  const p = location.pathname;
  let m;
  if (p === "/" || p === "") return viewHome();
  if (p === "/calculadora") return viewCalc();
  if (p === "/nuevo") return viewNew();
  if (p === "/transparencia") return viewTransparency();
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
