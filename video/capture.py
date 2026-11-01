"""Captures the product stills for the demo video in a phone-sized viewport, from the live site."""
import base64, json, sys, time, urllib.request
sys.path.insert(0, "/home/agent/agent/tools")
from cdp import Tab
OUT = "/home/agent/agent/products/celo-openrails/aldia/video/shots/"
BASE = "https://aldia.swiftbotlab.workers.dev"
t = json.loads(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9222/json/new?about:blank", method="PUT"), timeout=10).read())
tab = Tab(t)
def emu(w=430, h=900, m=True, s=2):
    tab.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=s, mobile=m)
def shot(name):
    d = tab.call("Page.captureScreenshot", format="png")["data"]
    open(OUT + name + ".png", "wb").write(base64.b64decode(d))
    print("shot", name)
def go(url, wait=4):
    tab.call("Page.navigate", url=url)
    time.sleep(wait)
def js(code):
    return tab.call("Runtime.evaluate", expression=code, awaitPromise=True, returnByValue=True)["result"].get("value")
SET = """const setv=(el,v)=>{const p=Object.getPrototypeOf(el);Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};"""
try:
    tab.call("Page.enable"); tab.call("DOM.enable"); emu()
    go(BASE + "/"); shot("01_home")
    go(BASE + "/calculadora")
    js(SET + """(async()=>{const i=[...document.querySelectorAll('main input')];setv(i.find(x=>x.placeholder==='$ 500.000'),'500000');setv(i.find(x=>x.type==='date'),'2026-02-01');await new Promise(r=>setTimeout(r,600));document.querySelector('.wrap .card:last-child')?.scrollIntoView();})()""")
    time.sleep(1); shot("02_calc")
    go(BASE + "/nuevo"); js("localStorage.removeItem('aldia:draft');location.reload()"); time.sleep(3)
    js("document.querySelector('details.card').open=true")
    shot("03_upload")
    root = tab.call("DOM.getDocument")["root"]["nodeId"]
    node = tab.call("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"]
    tab.call("DOM.setFileInputFiles", nodeId=node, files=["/home/agent/agent/tmp/celo0/sample_contract.pdf"])
    for i in range(60):
        time.sleep(2)
        if js("(document.querySelector('input[placeholder=\"$ 500.000\"]')||{}).value||''"):
            break
    time.sleep(2); js("window.scrollTo(0,0)"); shot("04_prefilled")
    js(SET + """(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const b=t=>[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===t);b('Seguir').click();await s(300);setv([...document.querySelectorAll('main input')].find(i=>i.placeholder.startsWith('Depto')),'Depto 2 ambientes, Almagro');setv([...document.querySelectorAll('main input')].find(i=>i.placeholder==='Martina'),'Martina');b('Seguir').click();await s(300);window.scrollTo(0,0);})()""")
    time.sleep(1); shot("05_payout")
    js("localStorage.removeItem('aldia:draft')")
    go(BASE + "/panel/c658d0b11729"); js("[...document.querySelectorAll('.note.warn')].filter(n=>/acceso privado/.test(n.innerText)).forEach(n=>n.remove())"); time.sleep(0.5); shot("06_panel")
    go(BASE + "/pagar/c658d0b11729"); shot("07_tenant")
    go(BASE + "/recibo/8650326827d3/2026-11"); shot("08_receipt")
    go(BASE + "/transparencia"); shot("09_transparency")
    emu(1600, 900, False, 1)
    go("https://celo.blockscout.com/tx/0x59a313d4c5e265d402189ea46cdd41e3ac362033da57fc00df88bfd62bded6e6", 8); shot("10_tx")
    go("https://github.com/swiftbotlab/stitch-client-tiers/blob/client-tiers/CLIENT_TIERS.md", 6); js("[...document.querySelectorAll('h2')].find(x=>/chain says/.test(x.innerText))?.scrollIntoView()"); time.sleep(1); shot("11_tiers")
finally:
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9222/json/close/%s" % t["id"], method="PUT"), timeout=10).read()
