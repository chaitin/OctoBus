# Alibaba Cloud Simple Application Server Firewall OctoBus Service

This package adapts Alibaba Cloud Simple Application Server firewall rules to OctoBus.

It targets Alibaba Cloud SWAS OpenAPI `2020-06-01` through `@alicloud/swas-open20200601`.

## Supported Product

- Service name: `alibaba-cloud-simple-application-server-firewall`
- Service dir: `alibaba-cloud__simple-application-server-firewall`
- Runtime mode: `long-running`
- Vendor: Alibaba Cloud
- Product: Simple Application Server
- Capability: instance firewall rule management
- Tested API family: `swas-open` `2020-06-01`

This is not Alibaba Cloud Cloud Firewall ACL. It manages the firewall tab on a Simple Application Server instance.

## Package Files

- `service.json`: OctoBus service manifest.
- `proto/alibaba_cloud_simple_application_server_firewall.proto`: gRPC API definition.
- `config.schema.json`: non-secret region, instance, endpoint, and timeout settings.
- `secret.schema.json`: Alibaba Cloud AccessKey or STS token fields.
- `src/alibaba-cloud-simple-application-server-firewall.js`: SWAS OpenAPI adapter.
- `src/service.js`: OctoBus SDK `defineService` wrapper.
- `bin/alibaba-cloud-simple-application-server-firewall.js`: service-local executable entrypoint.
- `test/alibaba-cloud-simple-application-server-firewall.test.js`: node:test coverage for validation, request mapping, response mapping, error mapping, and config/secret handling.
- `test/mock_upstream.js`: mock SWAS client used by tests.
- `test/live-firewall.test.js`: optional live verification that writes redacted evidence under `test-artifacts/`.

## Configuration

```json
{
  "regionId": "cn-beijing",
  "instanceId": "your-test-instance-id",
  "timeoutMs": 10000
}
```

`regionId` and `instanceId` can also be supplied on each RPC request. `endpoint` is optional and defaults to `swas.<regionId>.aliyuncs.com`.

## Secret

```json
{
  "accessKeyId": "replace-with-access-key-id",
  "accessKeySecret": "replace-with-access-key-secret"
}
```

For STS credentials, include `securityToken`. Do not commit real AccessKey, token, account, cookie, or production endpoint values.

## RPC Methods

- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/CreateFirewallRule`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/CreateFirewallRules`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/ListFirewallRules`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/ModifyFirewallRule`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DeleteFirewallRule`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DeleteFirewallRules`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/EnableFirewallRule`
- `AlibabaCloud_SWAS_Firewall.SimpleApplicationServerFirewallService/DisableFirewallRule`

## Write Behavior

- `CreateFirewallRule` uses the batch SWAS API internally with one rule so `sourceCidrIp` is preserved.
- `CreateFirewallRules` creates multiple rules in one API call.
- `ModifyFirewallRule` requires the target rule ID and the full target protocol/port fields.
- `DeleteFirewallRule` and `DeleteFirewallRules` remove rules. Rollback for create is delete; rollback for delete requires recreating the previous rule from audit data.
- `EnableFirewallRule` and `DisableFirewallRule` toggle a rule. Rollback is the opposite operation.
- `clientToken` is passed through when supplied. Alibaba Cloud uses it for idempotence on supported write operations. If omitted, repeated write calls may create or apply duplicate operations according to upstream API behavior.

Default test parameters should use a non-business high port and a test source CIDR, for example TCP `39080`.

## Audit Fields

Responses expose:

- Alibaba Cloud `request_id`
- created `firewall_rule_id` or `firewall_rule_ids`
- normalized firewall rule fields from list responses
- `raw_json` is intentionally empty; upstream raw response bodies are not returned

The optional live evidence test writes redacted request IDs and masked rule IDs only. It must not include credentials or business-sensitive data.

## Risks And Limits

- These methods change a real server firewall. Use a dedicated test server or a non-business high port.
- The Simple Application Server firewall has a per-instance rule limit.
- Duplicate protocol/port/source combinations can affect existing rules depending on upstream behavior.
- AccessKey should belong to a temporary RAM user or STS session with the minimum SWAS firewall permissions needed for testing.
- Network or Alibaba Cloud 5xx failures map to `UNAVAILABLE`; 401/403 maps to `PERMISSION_DENIED`; parameter errors map to `INVALID_ARGUMENT` or `FAILED_PRECONDITION`.

## Suggested Capset

Use a dedicated capset for firewall operations, for example `swas-firewall-admin`, and bind only the instance that needs these firewall methods. Add a capset token before exposing it outside a local trusted test environment.

## Example OctoBus Flow

```bash
octobus service import alibaba-swas-firewall ./services/alibaba-cloud__simple-application-server-firewall

octobus instance create alibaba-swas-firewall-test \
  --service alibaba-swas-firewall \
  --config-json '{"regionId":"cn-beijing","instanceId":"your-test-instance-id"}' \
  --secret-json '{"accessKeyId":"replace-with-access-key-id","accessKeySecret":"replace-with-access-key-secret"}'

octobus capset create swas-firewall-admin --name "SWAS Firewall Admin"
octobus capset add-instance swas-firewall-admin alibaba-swas-firewall-test
```

Core method call:

```bash
node bin/alibaba-cloud-simple-application-server-firewall.js create-firewall-rule \
  --config-json '{"regionId":"cn-beijing","instanceId":"your-test-instance-id"}' \
  --secret-json '{"accessKeyId":"replace-with-access-key-id","accessKeySecret":"replace-with-access-key-secret"}' \
  --data-json '{"ruleProtocol":"TCP","port":"39080","sourceCidrIp":"203.0.113.10/32","remark":"octobus-live-test"}'
```

## Local Checks

```bash
cd services
npm run validate -- --service-dir alibaba-cloud__simple-application-server-firewall
npm test -- --service-dir alibaba-cloud__simple-application-server-firewall
npm run pack:check
```

`protoc` is required for SDK CLI commands that inspect proto files.

## Live Verification

Live verification is opt-in and writes redacted evidence to `test-artifacts/`.

```bash
ALIBABA_CLOUD_ACCESS_KEY_ID='replace-with-access-key-id' \
ALIBABA_CLOUD_ACCESS_KEY_SECRET='replace-with-access-key-secret' \
ALIBABA_CLOUD_REGION_ID='cn-beijing' \
ALIBABA_CLOUD_SWAS_INSTANCE_ID='your-test-instance-id' \
ALIBABA_CLOUD_SWAS_TEST_SOURCE_CIDR='203.0.113.10/32' \
node --test test/live-firewall.test.js
```

The live test creates, lists, modifies, disables, enables, batch creates, batch deletes, and finally deletes test firewall rules. It attempts cleanup in `finally` if an intermediate step fails.
