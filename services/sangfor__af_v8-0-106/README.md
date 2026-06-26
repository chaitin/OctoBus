# Sangfor AF 8.0.106

This OctoBus service package was generated from the de-duplicated API documents in `newAPI`.

Source documents:

- `AF8.0.106-API中文文档.extract.txt`

## Import

```bash
octobus service import --id sangfor-af-v8-0-106 ./services/sangfor__af_v8-0-106
```

## Local Offline Test At Customer Site

1. Copy the repository or packed `services` artifact to the offline machine.
2. Install Node.js, npm, Go toolchain, and `protoc` if the machine does not already have them.
3. From the repository root, run:

```bash
cd services
npm install --offline
npm run validate -- --service-dir sangfor__af_v8-0-106
npm test -- --service-dir sangfor__af_v8-0-106 --coverage
npm run pack:check
```

4. Import the service into OctoBus without internet access:

```bash
octobus service import --offline --id sangfor-af-v8-0-106 ./services/sangfor__af_v8-0-106
```

5. Create an instance with the customer's real device address and credentials, then run one read-only method first before any write operation.

## Configuration

- `baseUrl`: product API address, for example `https://af.example.local`.
- `timeoutMs`: optional timeout in milliseconds.
- `allowInsecureHttp`: set to `true` only for local mock testing.
- `headers`: optional extra headers.

## Secrets

- `username`: API username.
- `password`: API password.
- `token`: optional pre-issued token when the site wants to avoid login during a test.

## Validation

```bash
cd services
npm run validate -- --service-dir sangfor__af_v8-0-106
npm test -- --service-dir sangfor__af_v8-0-106 --coverage
npm run pack:check
```

## One-Click Customer Read-Only Test

Use `offline-test/run-readonly-test.ps1` for customer-site verification. Copy `offline-test/config.example.json` to `offline-test/config.local.json`, fill the real device address and API account on the customer machine, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\offline-test\run-readonly-test.ps1
```

The script only verifies login and one configured read-only query. It does not perform any write or cleanup operation, and it generates a masked report under `offline-test/report/`.
