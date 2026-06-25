# CTYun Cloud Firewall C100 OctoBus Service

OctoBus package for CTYun Cloud Firewall native edition C100 read-only query APIs.

## Configuration

- `endpoint`: defaults to `https://ctcfw-east-a.ctapi.ctyun.cn`; the documented global endpoint `https://ctcfw-global.ctapi.ctyun.cn` can be used as an override.
- `regionId`: CTYun resource pool ID sent as the `regionid` request header.
- `urlType`: defaults to `CTAPI`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.

## Secrets

- `accessKeyId` / `ak`: CTYun AccessKey ID.
- `secretAccessKey` / `sk`: CTYun Secret Access Key.

`InvokeReadOnlyApi` only accepts the read-only APIs built into this package. Mutating endpoints such as add, delete, update, save, switch, open, close, sync, export, and order placement are intentionally not exposed.
