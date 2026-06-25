# CTYun DDoS Cloud OctoBus Service

OctoBus package for CTYun DDoS High Protection (Edge Cloud) read-only APIs.

## Configuration

- `endpoint`: defaults to `https://ddoscloud-global.ctapi.ctyun.cn`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.

## Secrets

- `accessKeyId` / `ak`: CTYun CDN+ IAM AccessKey ID.
- `secretAccessKey` / `sk`: CTYun CDN+ IAM Secret Access Key.

The product document states that this edge-cloud DDoS API uses AccessKey values created in CDN+ IAM (`vip.ctcdn.cn`), not the AccessKey values from the CTYun public console.

`InvokeReadOnlyApi` only accepts the read-only APIs built into this package. Mutating endpoints such as add, delete, update, create, manage, and ownership verification are intentionally not exposed.
