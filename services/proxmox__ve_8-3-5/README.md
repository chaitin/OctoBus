# Proxmox VE 8.3.5

OctoBus service package for the Proxmox VE 8.3.5 REST API (`/api2/json/`). This package exposes a small, read-only inventory surface that is useful for agents and tools that need to look up Proxmox cluster resources without depending on the full official SDK.

## Import

```bash
octobus service import --id ve-8-3-5 ./services/proxmox__ve_8-3-5
```

## Package Layout

- `service.json`: OctoBus service package manifest.
- `proto/proxmox_ve_8_3_5.proto`: Protobuf contract for the read-only inventory RPCs.
- `src/ve-8-3-5.js`: Runtime handler, request validation, HTTP request building, and error mapping.
- `config.schema.json`: Non-secret binding schema.
- `secret.schema.json`: Proxmox API token schema.
- `test/`: Node test coverage and mock upstream.

## Bindings

Configuration:

- `baseUrl` (or `base_url`, `host`, `restBaseUrl`, `url`): Proxmox API base URL, e.g. `https://pve.example.com:8006`.
- `defaultNode` (or `default_node`, `node`): Default Proxmox node name used when a per-RPC request omits `node`.
- `allowInsecureHttp` (or `allow_insecure_http`): when `true`, allows plain HTTP base URLs (default `false`). Loopback HTTP URLs are accepted for local tests without this flag.
- `skipTlsVerify` (or `tlsInsecureSkipVerify`, `insecureSkipVerify`, `tls_skip_verify`): skip TLS certificate verification for self-signed deployments (default `false`).
- `timeoutMs` (or `timeout_ms`, `timeout`): HTTP timeout in milliseconds, default `5000`.
- `headers`: optional additional HTTP headers merged into every request.

Secrets:

- `tokenId` (or `token_id`): Proxmox API token identifier in the form `USER@REALM!TOKENID` (e.g. `root@pam!automation`).
- `tokenSecret` (or `token_secret`): the token secret value associated with the token ID.
- `username`, `realm`: optional metadata describing the principal and authentication realm of the token.
- `pveAuthTicket`: optional legacy PVE auth cookie, reserved for future ticket-based flows.

## RPC Methods

- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListNodes` -> `GET /api2/json/nodes`
- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListQemuVMs` -> `GET /api2/json/nodes/{node}/qemu`
- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetQemuVMConfig` -> `GET /api2/json/nodes/{node}/qemu/{vmid}/config`
- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListLXCs` -> `GET /api2/json/nodes/{node}/lxc`
- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/ListStorage` -> `GET /api2/json/nodes/{node}/storage`
- `Proxmox_VE_8_3_5.Proxmox_VE_8_3_5/GetNodeStatus` -> `GET /api2/json/nodes/{node}/status`

## Authentication

Each request is signed with the Proxmox API token by setting:

```
Authorization: PVEAPIToken=USER@REALM!TOKENID=TOKENSECRET
```

The header is built from `tokenId` and `tokenSecret`. Plain `PVEAuthCookie` ticket flows are not exercised by the read-only methods here.

## Behavior

- All RPCs are GET requests against the `/api2/json/` prefix.
- `ListNodes` does not need a `node` argument; everything else uses `req.node` (or `bindings.defaultNode`).
- `GetQemuVMConfig` requires both `node` and `vmid`.
- Responses are decoded from Proxmox's `{ "data": ... }` envelope and projected to compact proto messages. The raw upstream body and HTTP status are also returned for callers that need the full payload.
- HTTP `401` / `403` map to `PERMISSION_DENIED`; other `4xx` map to `FAILED_PRECONDITION`; `5xx` and network failures map to `UNAVAILABLE`; non-JSON or empty responses map to `UNKNOWN`.

## Validation

```bash
cd services
npm run validate -- --service-dir proxmox__ve_8-3-5
npm test -- --service-dir proxmox__ve_8-3-5 --coverage
npm run pack:check
```
