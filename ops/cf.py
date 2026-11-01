"""Minimal Cloudflare API client. Reads the token from secrets at runtime; never prints it."""
import json, os, stat, sys, urllib.request, urllib.error
ACCOUNT = "14921b4b1158675445e98816b6a01992"
ENV = "/home/agent/agent/secrets/cloudflare.env"
def token():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent"))
    from envfile import read_env
    return read_env(ENV, "CLOUDFLARE_API_TOKEN")
def api(method, path, body=None, headers=None, raw=None, timeout=60):
    url = "https://api.cloudflare.com/client/v4" + path
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"authorization": "Bearer " + token(), "user-agent": "aldia-ops"}
    if body is not None:
        h["content-type"] = "application/json"
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {"success": False, "errors": [{"message": "non-json"}]}
if __name__ == "__main__":
    for p in [f"/accounts/{ACCOUNT}/workers/subdomain", f"/accounts/{ACCOUNT}/storage/kv/namespaces?per_page=50",
              f"/accounts/{ACCOUNT}/d1/database?per_page=50", f"/accounts/{ACCOUNT}/workers/scripts"]:
        c, d = api("GET", p)
        res = d.get("result")
        summary = None
        if isinstance(res, list):
            summary = [ (x.get("title") or x.get("name") or x.get("id")) for x in res][:40]
        elif isinstance(res, dict):
            summary = {k: res[k] for k in res if k in ("subdomain",)}
        print(c, p.split("/",3)[-1][:40], d.get("success"), summary, [e.get("message") for e in d.get("errors", [])][:2])
