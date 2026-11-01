"""Outbound client for the public Worker. The agent only ever calls out; the Worker cannot reach this machine."""
import json
import urllib.request

from envfile import read_env

BASE = "https://aldia.swiftbotlab.workers.dev"
ENV = "/home/agent/agent/secrets/aldia_worker.env"


def _token():
    return read_env(ENV, "AGENT_TOKEN")


def call(method, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"authorization": "Bearer " + _token(), "content-type": "application/json",
                                          "user-agent": "aldia-agent/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(4_000_000))


def queue():
    return call("GET", "/agent/queue")


def ack(leases=(), reads=()):
    return call("POST", "/agent/ack", {"leases": list(leases), "reads": list(reads)})


def publish(items):
    if items:
        return call("POST", "/agent/publish", {"items": items})
