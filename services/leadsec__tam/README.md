# leadsec-TAM

OctoBus service adapter for Leadsec TAM anti-DDoS static IP blacklist and whitelist management.

## Capabilities

- `Leadsec_TAM.LeadsecTAMService/AddBlacklist`: add one or more IP addresses to the static blacklist.
- `Leadsec_TAM.LeadsecTAMService/AddWhitelist`: add one or more IP addresses to the static whitelist.

## Configuration

```json
{
  "baseUrl": "https://10.11.9.107:2018",
  "skipTlsVerify": true,
  "timeoutMs": 8000,
  "language": "zh-cn",
  "remark": "OctoBus"
}
```

## Secret

```json
{
  "username": "admin",
  "password": "********"
}
```

The adapter logs in through `/cnddos/v2.0/api/web_login/ddos`, submits static IP list entries through `/cnddos/v2.0/api/ip_bwlist/info`, and verifies the result through `/cnddos/v2.0/api/ip_bwlist/page_list`.
