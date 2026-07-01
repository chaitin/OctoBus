# Ruijie Behavior Firewall R2.3.2.t0

OctoBus service package for the Ruijie behavior management + firewall API document sections 4.6, 4.10, and 5.1.

## Configuration

- `manageBaseUrl`: management API origin, for example `https://127.0.0.1:9090`.
- `reportBaseUrl`: reporter API origin, for example `https://127.0.0.1:9091`.
- `baseUrl`: fallback when both APIs share one origin.
- `managePath`: defaults to `/api.php/inter/Inter`.
- `reportPath`: defaults to `/api_reporter.php/inter/Inter`.
- `timeoutMs`: request timeout, default `8000`.
- `strictResponseCode`: default `true`; response code values other than `0` are mapped to gRPC errors.
- `skipTlsVerify`: for private deployments with self-signed certificates.

## Signing

Every request is sent as POST JSON with an `opt` query parameter. The service adds:

- `HY_BZ_API_APP_ID`: `hybzapi` by default.
- `HY_BZ_API_TIMESTAMP`: current Unix timestamp in seconds.
- `HY_BZ_API_SIGNATURE`: HMAC-MD5 of `JSON.stringify(body) + timestamp`.

`signingSecret` is required in secret config. Use the signing secret configured for the target Ruijie API deployment.

## Interface Coverage

### 4.6 Security Policy

Legacy safe policy RPCs map to `getlistsafepolicy`, `addsafepolicy`, `getdetailsafepolicy`, `editsafepolicy`, `insertsafepolicy`, `movesafepolicy`, `editstatussafepolicy`, `deletesafepolicy`, `deleteallsafepolicy`, and `clearcountersafepolicy`.

Security protection policy RPCs map to `getlistsecurityprotectpolicy`, `addsecurityprotectpolicy`, `getdetailsecurityprotectpolicy`, `movesecurityprotectpolicy`, `editstatussecurityprotectpolicy`, `deletesecurityprotectpolicy`, `deleteallsecurityprotectpolicy`, and `clearcountersecurityprotectpolicy`.

### 4.10 White List Policy

IP white list RPCs map to `getlistwhitepolicy`, `addwhitepolicy`, `getdetailwhitepolicy`, `editwhitepolicy`, `deletewhitepolicy`, and `delallwhitepolicy`.

URL white list RPCs map to `getlisturlwhitepolicy`, `addurlwhitepolicy`, `getdetailurlwhitepolicy`, `editurlwhitepolicy`, `editstatusurlwhitepolicy`, `deleteurlwhitepolicy`, and `delallurlwhitepolicy`.

### 5.1 Security Protection Logs

Report RPCs map to `getlogddos`, `getlogvirus`, `getlogips`, `getlogwaf`, and `getloglockip`.

## Payload Strategy

The upstream document contains very large and version-specific field sets. RPCs expose common identifiers such as `name`, `rule_name`, `policy_from`, `policy_to`, pagination, and date fields directly, and also accept `google.protobuf.Struct payload/filter` for the full upstream request body.

Use `RawManage` and `RawReport` for newly discovered opt values without changing the proto.
