# CTYun Server Security Guard OctoBus Service

OctoBus package for CTYun Server Security Guard (native edition) and Web Tamper Protection read-only APIs.

## Configuration

- `endpoint`: defaults to `https://ctcsscn-global.ctapi.ctyun.cn`.
- `timeoutMs`: HTTP timeout in milliseconds.
- `headers`: optional additional HTTP headers.

## Secrets

- `accessKeyId` / `ak`: CTYun AccessKey ID.
- `secretAccessKey` / `sk`: CTYun Secret Access Key.

`InvokeReadOnlyApi` only accepts the read-only APIs built into this package. Mutating endpoints such as add, delete, update, save, handle, open, close, scan, sync, and export are intentionally not exposed.

For APIs whose documented path contains `*`, pass replacement values in `payload.pathParams` or `payload.path_params` as an array.
