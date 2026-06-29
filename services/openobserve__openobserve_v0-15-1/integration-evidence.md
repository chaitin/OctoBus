## Integration Evidence: ListStreams successful

# Request
```
https://10.0.0.5:5080/api/default/streams
Authorization: Basic REDACTED
```

# Response   HTTP/1.1 200 OK
```json
{
  "streams": [
    {
      "name": "logs",
      "stream_type": "logs",
      "created_at": "2026-01-01T00:00:00Z"
    },
    {
      "name": "metrics",
      "stream_type": "metrics",
      "created_at": "2026-01-02T00:00:00Z"
    }
  ]
}
```
