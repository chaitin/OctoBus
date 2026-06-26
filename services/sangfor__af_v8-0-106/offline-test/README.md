# Sangfor AF Read-Only On-Site Test

Copy `config.example.json` to `config.local.json`, fill the real device address and API account locally, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-readonly-test.ps1
```

This script only performs login and one configured GET query. It does not add, delete, block, unblock, or modify anything.
