// The open test at /probar: anyone with a Celo wallet pays a real 1,000 wARS rent through Al Día with their own address as
// the landlord, so the money comes back to them less the 0.3% fee. It reuses the normal lease path: the Worker stores the
// lease like /nuevo does, the agent opens and settles it with the code it already runs, and the tenant pays the way
// /pagar/<id> does. No contract change, no key here, no new transaction signed by us.
// Every page is server-rendered and readable without JavaScript; web/app.js only adds the wallet buttons.
import { html, layout, str, fin, isAddr, isTx, isMonth, txUrl, addrUrl, cleanOutside, REASONS, PAYER_LABEL, rampUrl } from "./pages.js";
import { outsideSummary, judgeContext, judgeMonth } from "./outside.js";
import { toChecksum } from "./eip55.js";

export const PROBAR_RENT = 1000;
export const LIMITS = { perAddress: 3, perIp: 3, perDay: 25 };
const WARS_TOKEN = "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const SWAP = `https://app.uniswap.org/swap?chain=celo&inputCurrency=${USDT}&outputCurrency=${WARS_TOKEN}&exactField=output&exactAmount=${PROBAR_RENT}`;
const tokenUrl = (a) => `https://celoscan.io/token/${a}`;

// The fixed terms of a test lease. Start = today in Argentina, the agent's own calendar, so this month's charge is the
// first one: no index needed, the rent is exactly the base rent. All pesos, no dollar share, so no swap runs.
export function probarTerms(payout, now = new Date()) {
  const startDate = new Date(now.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
  return { propertyLabel: "Prueba abierta de 1.000 wARS", tenantLabel: "", baseRent: PROBAR_RENT, startDate, dueDay: 28, index: "IPC", periodMonths: 12, lagMonths: 2, fixedPct: 0, sweepBps: 0, payout };
}

export const langOf = (url) => (url.searchParams.get("lang") === "en" ? "en" : "es");
const q = (lang) => (lang === "en" ? "?lang=en" : "");
const nf = (lang, n) => new Intl.NumberFormat(lang === "en" ? "en-US" : "es-AR").format(n);

const T = {
  es: {
    title: "Probá Al Día con un alquiler real · Al Día",
    h1: "Probalo con un alquiler real de 1.000 wARS",
    lead: "Vos sos el propietario y también quien paga. Mandás 1.000 wARS (unos US$ 0,60) desde tu billetera Celo y el agente te devuelve 997 a la misma billetera: la diferencia es la comisión de 0,3 %. Son unos 2 minutos, en la red principal de Celo.",
    other: "English", payersLabel: (n) => (n === 1 ? "pagador externo hasta ahora" : "pagadores externos hasta ahora"), seeList: "Ver la lista y la regla",
    s1: "Tu billetera", walletLabel: "Tu dirección en Celo", walletHint: "Empieza con 0x. Es la que paga y la que cobra: revisala bien.",
    create: "Crear mi alquiler de prueba",
    s2: "Creamos el contrato de prueba", s2t: "1.000 wARS, sin aumentos y todo en pesos, con tu dirección como propietario. Lo maneja el mismo agente que cobra los alquileres reales.",
    s3: "Pagás 1.000 wARS", s3t: "Con el botón, si abrís la página desde la billetera, mandándolos desde cualquier billetera a la cuenta del contrato o por transferencia bancaria con Ripio.",
    s4: "Te queda el recibo", s4t: "El agente concilia el pago, te devuelve 997 wARS y publica el recibo con las operaciones en Celo.",
    needH: "Qué necesitás",
    need: "Una de dos: 1.000 wARS en la red Celo y un poco de CELO para el gas (en MiniPay el gas se paga en dólares digitales), o una cuenta de Ripio en Argentina para pagar $ 1.000 por transferencia bancaria.",
    swap: "¿No tenés wARS? Cambiá unos US$ 0,65 de USD₮ en Uniswap",
    ruleH: "Quién cuenta como pagador externo",
    rule: `Lo revisa este sitio solo, en el explorador público de Celo (Blockscout), antes de sumar a nadie: la billetera no es nuestra, sus primeros fondos no vinieron de una billetera nuestra y su primera operación en Celo es anterior al 6 de octubre de 2026. Si algo no se puede comprobar, no cuenta. Como no sabemos quién está detrás de cada billetera, figuran como «${PAYER_LABEL.es}». Si pagás por transferencia con Ripio, los wARS llegan desde la billetera de Ripio: ese pago cuenta si lo firmó Ripio, coincide con el alquiler y tu billetera nunca recibió nada de una billetera nuestra. Nuestras propias pruebas siguen apareciendo aparte, como pruebas nuestras.`,
    limits: `Hasta ${LIMITS.perAddress} alquileres de prueba por billetera y por conexión por día. La plata nunca pasa por nosotros: va a una cuenta en la red que solo le puede pagar al propietario, o sea, a vos.`,
    err: {
      format: "Esa dirección no parece válida: tiene que empezar con 0x y tener 42 caracteres.",
      checksum: "Esa dirección tiene un error de tipeo: las mayúsculas no coinciden con su control (EIP-55). Copiala de nuevo desde tu billetera.",
      agent: "Esa es la dirección del agente de Al Día. Poné la de tu billetera.",
      limit: "Ya creaste varios alquileres de prueba hoy. Probá mañana.",
      cap: "Por hoy llegamos al cupo de alquileres de prueba. Probá mañana.",
      origin: "Este formulario solo se puede enviar desde este sitio.",
      form: "No pudimos leer el formulario. Probá de nuevo.",
    },
    // per-lease page
    leaseTitle: "Tu alquiler de prueba · Al Día",
    leaseH1: "Tu alquiler de prueba",
    done: "Listo", now: "Ahora", later: "Después",
    yourWallet: "Es la que paga y la que cobra. Revisá que sea la tuya: los 997 wARS vuelven acá.",
    preparing: "Lo estamos preparando: tarda menos de dos minutos. Esta página se actualiza sola.",
    created: "1.000 wARS, sin aumentos, todo en pesos. La cuenta del contrato en Celo es esta; el agente la crea en la red cuando entra tu pago:", createdDone: "1.000 wARS, sin aumentos, todo en pesos. La cuenta del contrato en Celo:",
    payHere: "Mandá exactamente 1.000 wARS a la cuenta del contrato, desde la misma billetera del paso 1:",
    token: "Token wARS", tenantPage: "Abrir la página de pago del inquilino", paidRefresh: "Ya pagué: actualizar",
    rampBtn: "Pagar $ 1.000 por transferencia (Ripio)", rampT: "Si tenés cuenta en Ripio en Argentina: pagás en pesos desde tu banco y Ripio manda los wARS a la cuenta del contrato. Es el mismo camino que usa un inquilino.", rampFirst: " Todavía nadie lo completó de punta a punta: si lo probás, sos el primero.",
    orWallet: "O desde una billetera:", rampCounted: "Tu pago por transferencia vía Ripio cuenta como pago externo. Gracias por probarlo.",
    partial: (got, rest) => `Recibimos ${got} wARS. Falta mandar ${rest} wARS.`,
    settling: "Recibimos tu pago. El agente lo concilia apenas el explorador lo muestra, en hasta 10 minutos. Esta página se actualiza sola.",
    waiting: "El agente todavía no emitió el cobro de este mes. Probá en unos minutos.",
    closed: "Este contrato ya no se cobra por Al Día.",
    receiptDone: (back, fee) => `Listo: te devolvimos ${back} wARS. Comisión de Al Día: ${fee} wARS.`,
    seeReceipt: "Ver el recibo", settleTx: "liquidación en Celo", payTx: "tu pago en Celo",
    counted: "Tu billetera cuenta como pagador externo. Gracias por probarlo.",
    notCounted: (why) => `No contamos esta billetera como pagador externo: ${why}. Tu pago igual quedó registrado y te devolvimos los wARS.`,
    ourTest: "Esta es una prueba nuestra: figura aparte y no cuenta como pagador externo.",
    unchecked: "Todavía estamos revisando tu billetera. Volvé a mirar en unos minutos.",
    later4: "Cuando el agente liquide el pago, acá aparece el recibo.",
    notFound: "No encontramos este alquiler de prueba", notFoundT: "Revisá el link o creá uno nuevo.",
    back: "Crear otro alquiler de prueba",
  },
  en: {
    title: "Try Al Día with a real rent · Al Día",
    h1: "Try it with a real 1,000 wARS rent",
    lead: "You are the landlord and also the payer. You send 1,000 wARS (about US$0.60) from your Celo wallet and the agent sends 997 back to the same wallet: the difference is the 0.3% fee. It takes about 2 minutes, on Celo mainnet.",
    other: "Español", payersLabel: (n) => (n === 1 ? "outside payer so far" : "outside payers so far"), seeList: "See the list and the rule",
    s1: "Your wallet", walletLabel: "Your Celo address", walletHint: "It starts with 0x. It pays and it gets paid: check it carefully.",
    create: "Create my test lease",
    s2: "We create the test lease", s2t: "1,000 wARS, no increases, all in pesos, with your address as the landlord. The same agent that collects real rents runs it.",
    s3: "You pay 1,000 wARS", s3t: "With the button if you open the page in your wallet's browser, by sending them from any wallet to the lease account, or by bank transfer with Ripio.",
    s4: "You get the receipt", s4t: "The agent reconciles the payment, sends 997 wARS back to you and publishes the receipt with its Celo transactions.",
    needH: "What you need",
    need: "One of two: 1,000 wARS on Celo and a little CELO for gas (in MiniPay gas is paid in digital dollars), or a Ripio account in Argentina to pay ARS 1,000 by bank transfer.",
    swap: "No wARS? Swap about US$0.65 of USD₮ on Uniswap",
    ruleH: "Who counts as an outside payer",
    rule: `This site checks it by itself, on Celo's public explorer (Blockscout), before counting anyone: the wallet is not ours, its first funds did not come from one of our wallets, and its first Celo activity is before 6 October 2026. If something cannot be proven, it does not count. We cannot tell who is behind a wallet, so each one is listed as a "${PAYER_LABEL.en}". If you pay by bank transfer with Ripio, the wARS arrive from Ripio's wallet: that payment counts if Ripio signed it, it matches the rent and your wallet never received anything from one of our wallets. Our own tests keep showing separately, as ours.`,
    limits: `Up to ${LIMITS.perAddress} test leases per wallet and per connection per day. The money never passes through us: it goes to an onchain account that can only pay the landlord, which is you.`,
    err: {
      format: "That address does not look valid: it must start with 0x and be 42 characters long.",
      checksum: "That address has a typo: its upper and lower case letters do not match its checksum (EIP-55). Copy it again from your wallet.",
      agent: "That is the Al Día agent's address. Enter your own wallet.",
      limit: "You have already created several test leases today. Try again tomorrow.",
      cap: "Today's quota of test leases is used up. Try again tomorrow.",
      origin: "This form can only be sent from this site.",
      form: "We could not read the form. Please try again.",
    },
    leaseTitle: "Your test rent · Al Día",
    leaseH1: "Your test rent",
    done: "Done", now: "Now", later: "Next",
    yourWallet: "It pays and it gets paid. Check that it is yours: the 997 wARS come back here.",
    preparing: "We are setting it up: it takes less than two minutes. This page refreshes by itself.",
    created: "1,000 wARS, no increases, all in pesos. This is the lease's account on Celo; the agent deploys it when your payment arrives:", createdDone: "1,000 wARS, no increases, all in pesos. The lease's account on Celo:",
    payHere: "Send exactly 1,000 wARS to the lease account, from the same wallet as in step 1:",
    token: "wARS token", tenantPage: "Open the tenant's payment page", paidRefresh: "I have paid: refresh",
    rampBtn: "Pay ARS 1,000 by bank transfer (Ripio)", rampT: "If you have a Ripio account in Argentina: you pay pesos from your bank and Ripio sends the wARS to the lease account. It is the same path a tenant uses.", rampFirst: " Nobody has completed it end to end yet: if you try it, you are the first.",
    orWallet: "Or from a wallet:", rampCounted: "Your bank-transfer payment through Ripio counts as an outside payment. Thank you for trying it.",
    partial: (got, rest) => `We received ${got} wARS. ${rest} wARS still to send.`,
    settling: "We received your payment. The agent settles it as soon as the explorer shows it, within 10 minutes. This page refreshes by itself.",
    waiting: "The agent has not issued this month's charge yet. Try again in a few minutes.",
    closed: "This lease is no longer collected through Al Día.",
    receiptDone: (back, fee) => `Done: we sent ${back} wARS back to you. Al Día fee: ${fee} wARS.`,
    seeReceipt: "See the receipt", settleTx: "settlement on Celo", payTx: "your payment on Celo",
    counted: "Your wallet counts as an outside payer. Thank you for trying it.",
    notCounted: (why) => `We do not count this wallet as an outside payer: ${why}. Your payment is still recorded and your wARS were sent back.`,
    ourTest: "This is one of our own tests: it is listed separately and never counted as an outside payer.",
    unchecked: "We are still checking your wallet. Look again in a few minutes.",
    later4: "When the agent settles the payment, the receipt shows up here.",
    notFound: "We could not find this test lease", notFoundT: "Check the link or create a new one.",
    back: "Create another test lease",
  },
};

/* ---------- state of one test lease, from the Worker's record and what the agent published ---------- */
async function fresh(env, key) {
  const raw = await env.KV.get(key);
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export async function probarState(env, id, { judge = true } = {}) {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const rec = await fresh(env, `probar:${id}`);
  if (!rec || rec.id !== id || !isAddr(rec.payout)) return null;
  const st = { id, landlord: rec.payout.toLowerCase(), collector: null, step: 2, phase: "preparing", amount: PROBAR_RENT, owed: PROBAR_RENT, received: 0, builderTest: false, receipt: null, verdicts: [] };
  const pub = await fresh(env, `pub:${id}`);
  if (!pub) return st;
  st.collector = isAddr(pub.collector) ? pub.collector : null;
  st.builderTest = pub.builderTest === true;
  const months = (Array.isArray(pub.history) ? pub.history : []).filter((x) => x && x.status === "pagado" && isMonth(x.month)).map((x) => x.month).sort();
  if (pub.current && pub.current.status === "pagado" && isMonth(pub.current.month)) months.push(pub.current.month);
  for (const m of [...new Set(months)].sort().reverse()) {
    const r = await fresh(env, `receipt:${id}:${m}`);
    if (!r) continue;
    st.step = 4;
    st.phase = "paid";
    st.receipt = {
      path: `/recibo/${id}/${m}`, month: m, fee: fin(r.fee) ? r.fee : null, back: fin(r.pesoToLandlord) ? r.pesoToLandlord : null,
      settleTx: isTx(r.settleTx) ? r.settleTx : null, paymentTxs: (Array.isArray(r.paymentTxs) ? r.paymentTxs : []).filter(isTx).slice(0, 5),
    };
    if (judge && st.collector) {
      // At most a few seconds of explorer calls per view; anything not done yet shows as "still checking" and the page
      // reloads itself. Finished parts are cached, so the next view goes further.
      const limit = new Promise((r) => setTimeout(() => r(null), env.JUDGE_MS === undefined ? 6000 : Number(env.JUDGE_MS)));
      try {
        st.verdicts = (await Promise.race([judgeContext(env, 8).then((ctx) => judgeMonth(env, ctx, id, m, st.collector)), limit])) || [];
      } catch {
        st.verdicts = [];
      }
    }
    return st;
  }
  const c = pub.current && typeof pub.current === "object" ? pub.current : null;
  if (pub.closed) st.phase = "closed";
  else if (!st.collector || !c || !fin(c.amount)) st.phase = "waiting";
  else {
    st.step = 3;
    st.amount = c.amount;
    st.received = fin(c.received) ? c.received : 0;
    st.owed = Math.max(0, c.amount - st.received);
    st.phase = c.status === "pagado" || st.received >= c.amount * 0.98 ? "settling" : st.received > 0 ? "partial" : "open";
  }
  return st;
}

/* ---------- pages ---------- */
const stepCard = (n, title, chip, body) => html`<section class="card"><div class="row" style="justify-content:space-between;align-items:center"><span class="num" style="margin:0">${n}</span>${chip}</div><h3 style="margin-top:8px">${title}</h3>${body}</section>`;
const chip = (t, kind) => html`<span class="chip ${kind}">${t}</span>`;
function countBox(lang, o) {
  const t = T[lang];
  return html`<section class="stat" style="margin:0 0 14px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px"><b style="display:inline;font-size:1.9rem;line-height:1">${o.count}</b><span>${t.payersLabel(o.count)}</span><a class="small" href="/transparencia${q(lang)}#externos" style="margin-left:auto">${t.seeList}</a></section>`;
}

export async function pageProbar(env, url, waitUntil, { error = null, value = "", status = 200 } = {}) {
  const lang = langOf(url);
  const t = T[lang];
  const o = cleanOutside(await outsideSummary(env, waitUntil));
  const body = html`<h1>${t.h1}</h1><p class="muted">${t.lead}</p>
<form class="card" id="probar-form" method="post" action="/probar${q(lang)}"><div class="row" style="justify-content:space-between;align-items:center"><span class="num" style="margin:0">1</span></div><h3 style="margin-top:8px">${t.s1}</h3><input type="hidden" name="lang" value="${lang}"><div id="probar-connect" data-lang="${lang}"></div><label for="wallet">${t.walletLabel}<span class="hint">${t.walletHint}</span></label><input id="wallet" name="wallet" class="mono" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="text" maxlength="42" placeholder="0x…" required pattern="0x[0-9a-fA-F]{40}" value="${str(value, 60)}">${
    error ? html`<div class="note err" style="margin:12px 0 0">${t.err[error] || t.err.form}</div>` : ""}<button class="btn block" type="submit" style="margin-top:14px">${t.create}</button></form>
<section class="steps" aria-label="${t.s1}">${[[2, t.s2, t.s2t], [3, t.s3, t.s3t], [4, t.s4, t.s4t]].map(([n, h, p]) => html`<div class="card"><span class="num">${n}</span><h3>${h}</h3><p class="muted small" style="margin:0">${p}</p></div>`)}</section>
<section class="card"><h3>${t.needH}</h3><p class="small">${t.need}</p><p class="small" style="margin:0"><a href="${SWAP}" rel="noopener">${t.swap}</a> (Celo).</p></section>
${countBox(lang, o)}<section class="card"><h3>${t.ruleH}</h3><p class="small">${t.rule}</p><p class="tiny" style="margin:0">${t.limits}</p></section>`;
  return {
    status, lang,
    title: t.title,
    description: `${t.lead} ${lang === "en" ? "Outside payers so far" : "Pagadores externos hasta ahora"}: ${o.count}.`,
    body,
  };
}

function verdictNote(lang, st) {
  const t = T[lang];
  if (st.builderTest) return html`<div class="note warn" style="margin:12px 0 0">${t.ourTest}</div>`;
  const mine = st.verdicts.filter((v) => v.address === st.landlord || v.via === "ripio");
  const v = mine.find((x) => x.counted) || mine[0] || st.verdicts[0];
  if (!v || v.reason === "unchecked") return html`<div class="note" style="margin:12px 0 0">${t.unchecked}</div>`;
  if (v.counted) return html`<div class="note" style="margin:12px 0 0">${chip(t.done, "ok")} ${v.via === "ripio" ? t.rampCounted : t.counted}</div>`;
  return html`<div class="note warn" style="margin:12px 0 0">${t.notCounted((REASONS[lang] || REASONS.es)[v.reason] || REASONS[lang].unchecked)}</div>`;
}

export async function pageProbarLease(env, url, id, waitUntil) {
  const lang = langOf(url);
  const t = T[lang];
  const st = await probarState(env, id);
  if (!st) {
    return { status: 404, lang, noindex: true, title: `${t.notFound} · Al Día`, description: t.notFoundT,
      body: html`<h1>${t.notFound}</h1><p class="muted">${t.notFoundT}</p><a class="btn" href="/probar${q(lang)}">${t.back}</a>` };
  }
  const o = cleanOutside(await outsideSummary(env, waitUntil));
  const sChip = (n) => (st.step > n ? chip(t.done, "ok") : st.step === n ? chip(t.now, "wait") : chip(t.later, "info"));
  const landlord = toChecksum(st.landlord);
  const self = `/probar/${id}${q(lang)}`;
  const s1 = stepCard(1, t.s1, chip(t.done, "ok"), html`<p class="mono" style="margin:0 0 6px">${landlord}</p><p class="small muted" style="margin:0">${t.yourWallet}</p>`);
  const s2 = stepCard(2, t.s2, sChip(2), st.collector
    ? html`<p class="small">${st.step === 4 ? t.createdDone : t.created}</p><p class="mono" style="margin:0"><a href="${addrUrl(st.collector)}" rel="noopener">${st.collector}</a></p>`
    : html`<p class="small" style="margin:0">${st.phase === "closed" ? t.closed : t.preparing}</p>`);
  let pay = html`<p class="small muted" style="margin:0">${t.s3t}</p>`;
  if (st.step === 2 && st.collector && st.phase === "waiting") pay = html`<p class="small" style="margin:0">${t.waiting}</p>`;
  if (st.step === 3) {
    const owed = st.owed;
    const instructions = html`<p class="small" style="margin:12px 0 6px">${t.payHere}</p><p class="mono" style="margin:0 0 6px">${st.collector}</p><p class="tiny" style="margin:0 0 12px">${t.token}: <a href="${tokenUrl(WARS_TOKEN)}" rel="noopener" class="mono">${WARS_TOKEN}</a></p>`;
    if (st.phase === "settling") pay = html`<p class="small" style="margin:0">${t.settling}</p>`;
    else {
      pay = html`<div class="amount">${nf(lang, owed)} wARS</div>${st.phase === "partial" ? html`<p class="small">${t.partial(nf(lang, st.received), nf(lang, owed))}</p>` : ""}<a class="btn ghost block" style="margin:6px 0 4px" href="${rampUrl(owed, st.collector)}" rel="noopener" id="probar-ramp">${t.rampBtn}</a><p class="tiny" style="margin:0 0 12px">${t.rampT}${o.rampPayments ? "" : t.rampFirst}</p><p class="small" style="margin:0 0 4px"><b>${t.orWallet}</b></p><div id="probar-pay" data-id="${id}" data-collector="${st.collector}" data-owed="${owed}" data-landlord="${st.landlord}" data-lang="${lang}"></div>${instructions}<a class="btn ghost block" style="text-align:center" href="/pagar/${id}${q(lang)}">${t.tenantPage}</a><p class="small" style="margin:12px 0 0"><a href="${SWAP}" rel="noopener">${t.swap}</a> · <a href="${self}">${t.paidRefresh}</a></p>`;
    }
  }
  const s3 = stepCard(3, t.s3, sChip(3), pay);
  const r = st.receipt;
  const s4 = stepCard(4, t.s4, st.step === 4 ? chip(t.done, "ok") : chip(t.later, "info"), r
    ? html`<p class="small">${t.receiptDone(r.back === null ? "—" : nf(lang, r.back), r.fee === null ? "—" : nf(lang, r.fee))}</p><a class="btn block" href="${r.path}${q(lang)}">${t.seeReceipt}</a><p class="small" style="margin:10px 0 0">${r.paymentTxs.map((x) => html`<a href="${txUrl(x)}" rel="noopener">${t.payTx}</a> · `)}${r.settleTx ? html`<a href="${txUrl(r.settleTx)}" rel="noopener">${t.settleTx}</a>` : ""}</p>${verdictNote(lang, st)}`
    : html`<p class="small muted" style="margin:0">${t.later4}</p>`);
  const unjudged = st.phase === "paid" && !st.builderTest && !st.verdicts.some((v) => v.reason !== "unchecked");
  const waiting = st.phase === "preparing" || st.phase === "settling" || st.phase === "waiting" || unjudged;
  const body = html`<h1>${t.leaseH1}</h1><div id="probar-state" data-id="${id}" data-step="${st.step}" data-phase="${st.phase}" hidden></div><p id="probar-panel" class="small" hidden></p>${st.builderTest ? html`<div class="note warn">${t.ourTest}</div>` : ""}${s1}${s2}${s3}${s4}${countBox(lang, o)}<p class="small"><a href="/probar${q(lang)}">${t.back}</a></p>`;
  return { status: 200, lang, noindex: true, refresh: waiting ? 20 : 0, title: t.leaseTitle, description: `${t.lead}`, body };
}

export async function renderProbar(url, env, waitUntil, opts) {
  const m = url.pathname.match(/^\/probar\/([0-9a-f]{12})$/);
  const page = m ? await pageProbarLease(env, url, m[1], waitUntil) : await pageProbar(env, url, waitUntil, opts);
  return { status: page.status || 200, html: layout({ origin: url.origin, path: url.pathname, search: url.search, ...page }) };
}

// What the browser polls while waiting: the step and phase only, never the verdict (that costs explorer calls).
export async function probarApi(env, id) {
  const st = await probarState(env, id, { judge: false });
  if (!st) return null;
  return { id: st.id, step: st.step, phase: st.phase, owed: st.owed, receipt: st.receipt ? st.receipt.path : null };
}
