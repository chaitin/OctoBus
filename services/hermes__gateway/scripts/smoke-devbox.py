#!/usr/bin/env python3
"""DevBox smoke test for the Hermes OctoBus package.

Run on the OctoBus DevBox:

  OCTOBUS_URL=http://127.0.0.1:9000 \
  python3 scripts/smoke-devbox.py

The OctoBus instance must have a secret.webhookHmacSecrets entry matching
WEBHOOK_SECRET_NAME, defaulting to "smoke".
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request


OCTOBUS_URL = os.environ.get("OCTOBUS_URL", "http://127.0.0.1:9000").rstrip("/")
INSTANCE = os.environ.get("HERMES_INSTANCE", "hermes-internal")
WEBHOOK_SECRET_NAME = os.environ.get("WEBHOOK_SECRET_NAME", "smoke")
CRON_SCRIPT = os.environ.get("HERMES_CRON_SCRIPT", "octobus_smoke.sh")


def call(capset: str, method: str, payload: dict, timeout: int = 120) -> dict:
    url = f"{OCTOBUS_URL}/capsets/{capset}/connect/{INSTANCE}/hermes.v1.HermesGateway/{method}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"{capset}/{method} failed: HTTP {error.code}: {body}") from error
    result = json.loads(body)
    if result.get("ok") is False:
        raise RuntimeError(f"{capset}/{method} returned ok=false: {body}")
    print(f"ok {capset}/{method}")
    return result


def parse_cron_id(stdout: str) -> str:
    match = re.search(r"Created job:\s*([A-Za-z0-9_.:-]+)", stdout)
    if not match:
        raise RuntimeError(f"could not parse cron id from stdout: {stdout}")
    return match.group(1)


def main() -> int:
    stamp = time.strftime("%Y%m%d%H%M%S")
    webhook_name = f"octobus-smoke-{stamp}"
    cron_id = ""

    call("hermes-diagnostics-tools", "GetGatewayStatus", {})
    call("hermes-diagnostics-tools", "ConfigCheck", {})
    call("hermes-admin-tools", "Doctor", {"fix": False, "timeoutMs": 120000}, timeout=180)

    try:
        call(
            "hermes-webhook-tools",
            "CreateWebhookSubscription",
            {
                "name": webhook_name,
                "prompt": "OctoBus smoke webhook: {event_id}",
                "events": "octobus.smoke",
                "description": "Temporary OctoBus smoke webhook",
                "deliver": "log",
                "secretName": WEBHOOK_SECRET_NAME,
            },
        )
        call(
            "hermes-webhook-tools",
            "SendWebhook",
            {
                "path": f"/webhooks/{webhook_name}",
                "payloadJson": json.dumps({"type": "octobus.smoke", "event_id": f"evt-{stamp}"}),
                "hmacSecretName": WEBHOOK_SECRET_NAME,
                "idempotencyKey": f"idem-{stamp}",
                "correlationId": f"corr-{stamp}",
                "timeoutMs": 30000,
            },
        )
    finally:
        try:
            call("hermes-webhook-tools", "RemoveWebhookSubscription", {"name": webhook_name})
        except Exception as error:
            print(f"warn cleanup webhook: {error}", file=sys.stderr)

    try:
        created = call(
            "hermes-cron-tools",
            "CreateCronJob",
            {
                "schedule": "every 1h",
                "name": f"OctoBus Smoke {stamp}",
                "script": CRON_SCRIPT,
                "noAgent": True,
                "deliver": "local",
                "repeat": 1,
                "timeoutMs": 30000,
            },
        )
        cron_id = parse_cron_id(created.get("stdout", ""))
        call("hermes-cron-tools", "PauseCronJob", {"name": cron_id})
        call("hermes-cron-tools", "ResumeCronJob", {"name": cron_id})
        call("hermes-cron-tools", "RunCronJob", {"name": cron_id, "timeoutMs": 120000}, timeout=180)
    finally:
        if cron_id:
            try:
                call("hermes-cron-tools", "RemoveCronJob", {"name": cron_id})
            except Exception as error:
                print(f"warn cleanup cron: {error}", file=sys.stderr)

    call("hermes-admin-tools", "EnableTools", {"platform": "cli", "names": ["video"]})
    call("hermes-admin-tools", "DisableTools", {"platform": "cli", "names": ["video"]})
    call("hermes-admin-tools", "EnablePlugin", {"name": "pgs-confirm-forwarder"})
    call("hermes-admin-tools", "DisablePlugin", {"name": "pgs-confirm-forwarder"})

    call("hermes-webhook-tools", "ListWebhookSubscriptions", {})
    call("hermes-cron-tools", "ListCronJobs", {})
    call("hermes-diagnostics-tools", "ListTools", {"platform": "cli"})
    call("hermes-diagnostics-tools", "ListPlugins", {})
    print("Hermes OctoBus smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
