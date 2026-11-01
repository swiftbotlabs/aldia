"""What similar flats are asking. At each adjustment the agent rents a disposable browser over x402 through buy, reads a
public listings page for the lease's neighbourhood and rooms, and tells the landlord how the rent compares.
The page is untrusted data: only price numbers are pulled from it, and they are shown as a reference, never acted on."""
import json
import re
import statistics
import urllib.request

import buy
import celo

SESSIONS = "https://gateway.usebuy.ai/v1/browser/sessions"


def command(browser, cmd):
    req = urllib.request.Request(browser["commandUrl"], data=json.dumps(cmd).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + browser["accessToken"], "user-agent": "aldia/1"})
    with urllib.request.urlopen(req, timeout=80) as r:
        return json.loads(r.read(2_000_000))
