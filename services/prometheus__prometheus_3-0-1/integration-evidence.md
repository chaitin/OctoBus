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

## Integration Evidence: ListMetadata successful

# Request
```
http://10.0.0.6:9090/api/v1/metadata
(no auth)
```

# Response   HTTP/1.1 200 OK
```json
{
  "status": "success",
  "data": {
    "up": [
      {"type": "gauge", "help": "1 if the instance is up, 0 otherwise", "unit": ""}
    ]
  }
}
```
