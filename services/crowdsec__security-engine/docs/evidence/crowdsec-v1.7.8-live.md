# CrowdSec v1.7.8 live compatibility evidence

Validated on 2026-08-14 against the official ARM64 image
`crowdsecurity/crowdsec:v1.7.8` (digest
`sha256:2f527c9bb8b367120eb08b82890aa912ce96bfa1ada93dda0721700e4b4e0dde`).
This was a real CrowdSec Local API process, not `test/mock_upstream.js`.

The service handlers were invoked through the current SDK single-context ABI.
Temporary watcher and bouncer credentials were created inside an isolated local
container and removed with the container after validation. No credential is
recorded here.

Validated flow:

1. `BlockIP` created a two-minute decision for documentation-range IP
   `192.0.2.123` and returned alert ID `2`.
2. `ListAlerts` returned two alerts.
3. `GetAlert` retrieved alert ID `2`.
4. `ListDecisions`, authenticated as a real bouncer, returned two decisions.
5. `DeleteDecision` removed one decision.
6. `UnblockIP` safely returned zero for an absent documentation-range IP.

Sanitized result:

```json
{"image":"crowdsecurity/crowdsec:v1.7.8","blockAlertId":2,"alerts":2,"getAlertId":2,"decisions":2,"deleted":1,"unblock":0}
```

The container log also recorded HTTP 200 responses for watcher login and the
LAPI calls. Unit/L2 tests remain deterministic and do not require Docker.
