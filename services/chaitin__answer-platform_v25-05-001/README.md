# Chaitin Answer-Platform (全悉) V25.05.001

Chaitin Answer-Platform Advanced Threat Analysis and Warning System — OctoBus service package.

## API Methods

| Method | Description |
|--------|-------------|
| Login | Authenticate and obtain a session token |
| SearchAlarms | Search threat alarms with filters |
| GetAlarm | Get detailed alarm information |
| SearchBlockRules | List block/response rules |
| CreateBlockRule | Create a new block rule |
| UpdateBlockRuleStatus | Enable or disable a block rule |
| DeleteBlockRule | Disable a block rule |
| ListFirewalls | List linked firewall devices |
| CreateBlackList | Add IPs to firewall blacklist |
| DeleteBlackList | Remove IPs from firewall blacklist |
| SearchBlackList | Query the blacklist |
| GetSystemStatus | Get system health info |
| SearchAssets | Search enterprise assets |
| Logout | Invalidate the session |
| GetAgentGroups | Get available probe/agent list |

## Config

```json
{
  "restBaseUrl": "https://<device-ip>",
  "timeoutMs": 30000,
  "maxResponseBytes": 4194304,
  "skipTlsVerify": false
}
```

## Secret

```json
{
  "bindUser": "admin",
  "bindPassword": "your-password"
}
```

`skipTlsVerify` should only be enabled for a trusted deployment using a self-signed certificate.
