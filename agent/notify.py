"""Telegram notices. The bot only understands /start with a link it issued, and /parar. Everything else gets a short help
line: what people type is data, and nothing they write reaches a model or a shell. Errors never carry the token."""
import json
import os
import re
import time
import urllib.parse
import urllib.request

import celo
from envfile import read_env

ENV = "/home/agent/agent/secrets/aldia_avisos.env"
BASE = "https://aldia.swiftbotlab.workers.dev"
SUBS = os.path.join(celo.STATE_DIR, "subs.json")
HELP = "Hola. Soy el bot de avisos de Al Día. Para recibir avisos, entrá desde el link de tu contrato o de tu pago: " + BASE


def _token():
    return read_env(ENV, "BOT_TOKEN")


def _call(method, body):
    try:
        req = urllib.request.Request(f"https://api.telegram.org/bot{_token()}/{method}", data=json.dumps(body).encode(),
                                     headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read(1_000_000))
    except Exception as e:      # never let a URL with the token reach a log
        return {"ok": False, "error": type(e).__name__}


class Notifier:
    def __init__(self):
        self.state = json.load(open(SUBS)) if os.path.exists(SUBS) else {"offset": 0, "leases": {}}

    def save(self):
        tmp = SUBS + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, SUBS)

    def send(self, chat, text):
        return _call("sendMessage", {"chat_id": chat, "text": text, "disable_web_page_preview": True}).get("ok")

    def subs(self, lease_id, role):
        return self.state["leases"].get(lease_id, {}).get(role, [])

    def has_subs(self, lease_id):
        return bool(self.subs(lease_id, "landlord") or self.subs(lease_id, "tenant"))

    def poll(self, store, status_text):
        r = _call("getUpdates", {"offset": self.state["offset"], "timeout": 0, "allowed_updates": ["message"]})
        changed = False
        for u in r.get("result", []) if r.get("ok") else []:
            self.state["offset"] = u["update_id"] + 1
            changed = True
            msg = u.get("message") or {}
            chat = (msg.get("chat") or {}).get("id")
            text = msg.get("text") or ""
            if not chat or (msg.get("chat") or {}).get("type") != "private":
                continue
            if text.strip() == "/parar":
                for roles in self.state["leases"].values():
                    for lst in roles.values():
                        if chat in lst:
                            lst.remove(chat)
                self.send(chat, "Listo, no te mando más avisos.")
                continue
            m = re.fullmatch(r"/start (l|t)_([0-9a-f]{12})(?:_([0-9a-f]{20}))?", text.strip())
            lease = store.get(m.group(2)) if m else None
            if not lease or (m.group(1) == "l" and m.group(3) != lease.get("keyPrefix")):
                self.send(chat, HELP)
                continue
            role = "landlord" if m.group(1) == "l" else "tenant"
            lst = self.state["leases"].setdefault(lease["id"], {}).setdefault(role, [])
            if chat not in lst:
                lst.append(chat)
            intro = ("Listo. Te aviso cuando entre un pago, cuando cambie el monto y si algo se atrasa."
                     if role == "landlord" else "Listo. Te aviso cuando salga el monto de cada mes y unos días antes del vencimiento.")
            self.send(chat, f"{intro}\n\n{status_text(lease)}\n\nPara dejar de recibir avisos, escribí /parar.")
        if changed:
            self.save()

    def tell(self, lease, roles, key, text):
        """Sends once per key. A notice with nobody subscribed is not marked as sent, so a later subscriber still hears it."""
        sent = lease.setdefault("sent", {})
        if key in sent:
            return False
        chats = [c for role in roles for c in self.subs(lease["id"], role)]
        if not chats:
            return False
        for c in chats:
            self.send(c, text)
        sent[key] = int(time.time())
        return True
