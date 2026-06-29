## Integration Evidence: ListAlerts successful

# Request
```
http://10.0.0.7:9093/api/v2/alerts
(no auth)
```

# Response   HTTP/1.1 200 OK
```json
[
  {
    "fingerprint": "abc123",
    "startsAt": "2026-01-01T00:00:00Z",
    "endsAt": "0001-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:01:00Z",
    "generatorURL": "http://prom:9090/graph",
    "labels": {
      "alertname": "HighErrorRate",
      "severity": "critical"
    },
    "annotations": {
      "summary": "High error rate"
    },
    "status": {
      "state": [
        "active"
      ],
      "silencedBy": [],
      "inhibitedBy": []
    }
  }
]
```
