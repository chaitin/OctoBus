# ThreatBook OneSIG Policy API

This package corresponds to `newAPI/ONESLG-API文档.md`. The document title and body describe OneSIG policy APIs. The filename appears to use `ONESLG`, but the product text is `OneSIG`.

## Import

```bash
octobus service import --id threatbook-onesig-policy-api ./services/threatbook__onesig-policy-api
```

## Covered Capabilities

This package intentionally exposes a small security-operations surface:

- `ListAssetGroups`
- `ListAssets`
- `ListGlobalWhitelist`
- `ListGlobalBlacklist`
- `CreateGlobalBlacklist`
- `ListHttpBlacklist`
- `CreateHttpBlacklist`

Update, delete, remove, enable, generic signed request, and device status methods are not exposed by this package to keep the default operational surface narrow.

## Customer-Site Offline Test

1. Copy the repository or packed `services` artifact to the offline machine.
2. Make sure Node.js, npm, Go, `protoc`, and the `octobus` binary are available on that machine.
3. From the repository root, run:

```bash
cd services
npm install --offline
npm run validate -- --service-dir threatbook__onesig-policy-api
npm test -- --service-dir threatbook__onesig-policy-api
npm run pack:check
```

4. Import without internet access:

```bash
octobus service import --offline --id threatbook-onesig-policy-api ./services/threatbook__onesig-policy-api
```

5. Create an instance with the customer's OneSIG address, API key, and signing secret. Run list methods first. Only run create methods in a customer-approved test environment.

## Configuration

- `baseUrl`: OneSIG address, for example `https://onesig.example.local`.
- `timeoutMs`: optional timeout in milliseconds.
- `allowInsecureHttp`: set to `true` only for local mock testing.
- `timestampPrecision`: `seconds` or `milliseconds`.
- `headers`: optional extra headers.

## Secrets

- `apiKey`: OneSIG API key.
- `secret`: OneSIG HMAC-SHA1 signing secret.
