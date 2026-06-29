## Integration Evidence: InstantQuery successful

# Request
```
http://10.0.0.6:9090/api/v1/query?query=up
(no auth)
```

# Response   HTTP/1.1 200 OK
```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "__name__": "up",
          "job": "prometheus"
        },
        "value": [
          1625097600,
          "1"
        ]
      }
    ]
  }
}
```
