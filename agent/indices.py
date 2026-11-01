"""Official Argentine indices, read from the publishers and checked against each other.

IPC (national, general level, base Dec 2016 = 100)
  primary  INDEC   https://www.indec.gob.ar/ftp/cuadros/economia/serie_ipc_divisiones.csv
  check 1  Ministry of Economy series API (series 148.3_INIVELNAL_DICI_M_26): same levels, usually a month behind
  check 2  BCRA API, variable 27 (monthly inflation, one decimal)
ICL (Índice para Contratos de Locación, base 30.6.2020 = 1)
  primary  BCRA API, variable 40 (daily)

If the sources disagree the snapshot is marked not ok and the agent issues no new adjustment until they agree again.
"""
import csv
import hashlib
import io
import json
import ssl
import time
import urllib.request

INDEC_URL = "https://www.indec.gob.ar/ftp/cuadros/economia/serie_ipc_divisiones.csv"
DATOS_URL = "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=36&sort=desc&format=json"
BCRA_URL = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/{var}?limit={limit}"
UA = {"user-agent": "Mozilla/5.0 (compatible; aldia-index/1.0)"}
MAX_BYTES = 6_000_000


def _get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        raw = r.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("source response too large")
    return raw


def parse_indec(raw):
    """{'YYYY-MM': level} for the national general level."""
    text = raw.decode("latin-1")
    out = {}
    rows = csv.reader(io.StringIO(text), delimiter=";")
    head = next(rows)
    if head[:5] != ["Codigo", "Descripcion", "Clasificador", "Periodo", "Indice_IPC"] or head[7].strip() != "Region":
        raise ValueError("INDEC file layout changed")
    for r in rows:
        if len(r) >= 8 and r[0].strip() == "0" and r[7].strip() == "Nacional":
            p = r[3].strip()
            out[f"{p[:4]}-{p[4:6]}"] = float(r[4].replace(",", "."))
    if len(out) < 60:
        raise ValueError("INDEC file has too few months")
    return out


def parse_datos(raw):
    d = json.loads(raw)
    return {row[0][:7]: float(row[1]) for row in d["data"]}


def parse_bcra(raw):
    d = json.loads(raw)
    return {x["fecha"]: float(x["valor"]) for x in d["results"][0]["detalle"]}


def check(ipc, datos, monthly):
    """Returns a list of disagreements. Empty means the sources agree."""
    problems = []
    for m, level in datos.items():
        if m in ipc and abs(ipc[m] - level) > 0.05:      # the series API rounds some old months to one decimal
            problems.append(f"IPC {m}: INDEC {ipc[m]} vs series API {level}")
    months = sorted(ipc)
    for date, pct in monthly.items():
        m = date[:7]
        if m in ipc:
            i = months.index(m)
            if i == 0:
                continue
            ours = (ipc[m] / ipc[months[i - 1]] - 1) * 100
            if abs(ours - pct) > 0.051:
                problems.append(f"IPC {m}: {ours:.2f}% from levels vs BCRA {pct}%")
    return problems


def snapshot():
    raw = _get(INDEC_URL)
    ipc = parse_indec(raw)
    datos = parse_datos(_get(DATOS_URL))
    monthly = parse_bcra(_get(BCRA_URL.format(var=27, limit=24)))
    icl_daily = parse_bcra(_get(BCRA_URL.format(var=40, limit=2000)))
    problems = check(ipc, datos, monthly)
    if len(icl_daily) < 365:
        problems.append("ICL series too short")
    months = sorted(ipc)
    return {
        "ok": not problems,
        "problems": problems,
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ipc": {m: ipc[m] for m in months[-72:]},
        "ipcLast": months[-1],
        "ipcMonthlyPct": {m: round((ipc[m] / ipc[months[months.index(m) - 1]] - 1) * 100, 1) for m in months[-24:]},
        "icl": {d: icl_daily[d] for d in sorted(icl_daily)},
        "sources": {
            "ipc": INDEC_URL,
            "ipcCheck": ["apis.datos.gob.ar series 148.3_INIVELNAL_DICI_M_26", "api.bcra.gob.ar variable 27"],
            "icl": "api.bcra.gob.ar variable 40",
        },
        "indecFileSha256": hashlib.sha256(raw).hexdigest(),
    }


if __name__ == "__main__":
    s = snapshot()
    print(json.dumps({k: s[k] for k in ("ok", "problems", "retrievedAt", "ipcLast", "indecFileSha256")}, indent=1))
    print("IPC last 4:", [(m, s["ipc"][m], s["ipcMonthlyPct"].get(m)) for m in sorted(s["ipc"])[-4:]])
    k = sorted(s["icl"])
    print("ICL days", len(k), k[0], s["icl"][k[0]], k[-1], s["icl"][k[-1]])
