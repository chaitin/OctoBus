# H3C SecPath

OctoBus service package for H3C SecPath Comware 7 REST API (RESTCONF).

## Authentication

HTTP Basic Auth (username + password). Configure in `secret.*`.

## Configuration

| Field | Description |
|-------|-------------|
| `config.host` | Device base URL, e.g. `https://10.0.0.1` |
| `secret.username` | Admin username |
| `secret.password` | Admin password |

## Methods

| Method | Description |
|--------|-------------|
| `GetDeviceBase` | Device basic information |
| `GetSecurityZones` | Security zone list |
| `GetZonePairs` | Security zone pairs |
| `GetIPv4SecurityPolicies` | IPv4 firewall policy rules |
| `GetIPv4ObjectGroups` | IPv4 address object groups |
| `GetServiceGroups` | Service object groups |
| `GetSessions` | Active session table |
| `GetInterfaces` | Interface list and status |
| `GetACLGroups` | ACL groups |
| `GetNATStaticMappings` | NAT static mapping entries |
