# Venus-MAF

OctoBus service for Venus-MAF application firewall operations.

## Supported Capabilities

- `HealthCheck`: login probe.
- `CreateSite`: create a virtual site through `POST /api/v3/protect/vs/add`.
- `DeleteSite`: delete a virtual site through `POST /api/v3/protect/vs/delete`. If `id` is omitted, the service resolves it by site name.
- `ListSites`: query virtual sites through `GET /api/v3/protect/vs/find`.
- `UploadCustomSensitiveWords`: upload a custom sensitive word file through `POST /api/v3/protect/tmpl/llm/customize/file`.

## Configuration

`baseUrl` is required. UI URLs such as `https://host/monitor` are accepted; the service uses the origin and appends `apiPrefix`.

Optional fields:

- `apiPrefix`: defaults to `/api/v3`.
- `authToken`: defaults to `CMCC_NFV`.
- `deviceType`: defaults to `api`.
- `timeoutMs`: defaults to `10000`.
- `insecureSkipTlsVerify`: enable only for lab self-signed TLS.

TLS verification is enabled by default. When explicitly disabled, the setting is scoped to this service's HTTP dispatcher and does not alter process-wide TLS behavior. Requests use a 10-second default timeout and do not follow redirects, preventing credentials from being forwarded to another origin.

## Secret

- `username`
- `password`

The password is SHA-256 hashed for `POST /api/v3/login`.

## Create Site Example

```json
{
  "name": "octobus-maf-site",
  "description": "OctoBus integration test site",
  "enable": 1,
  "http_type": "http",
  "ip": "192.0.2.10",
  "port": 8080,
  "server_name": ["maf.example.local"],
  "net_mode": 1,
  "safe_mode": 1,
  "upstream": {
    "http_type": "http",
    "load_balance_algo": "round_robin",
    "server_addr": [
      { "ip": "198.51.100.1", "port": 8080, "weight": 100 }
    ]
  }
}
```

## Delete Site Example

```json
{
  "name": "octobus-maf-site"
}
```

## Upload Custom Sensitive Words Example

```json
{
  "filename": "octobus-sensitive-words.txt",
  "content": "secret-word-1\nsecret-word-2\n"
}
```

## Notes

- Write methods verify results where the product exposes a query endpoint.
- `UploadCustomSensitiveWords` returns the upload response from the product; the API document does not define a separate file-list verification endpoint.
- Upstream response bodies are limited to 2 MiB and sensitive-word uploads to 1 MiB.
- Multipart filenames are sanitized before being inserted into `Content-Disposition`.
- Do not store credentials, tokens, cookies, or real internal device addresses in repository files or PR evidence.
