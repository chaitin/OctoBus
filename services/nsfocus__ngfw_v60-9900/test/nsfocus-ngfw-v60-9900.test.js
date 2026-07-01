import test from "node:test";
import assert from "node:assert/strict";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_ADD_IPV6_TO_GROUP,
  METHOD_BLOCK_IP,
  METHOD_CREATE_IPV6_ADDRESS_GROUP,
  METHOD_CREATE_NODE_OBJECT,
  METHOD_DELETE_NODE_OBJECT,
  METHOD_GET_SYSTEM_STATUS,
  METHOD_LIST_SECURITY_LOGS,
  METHOD_LIST_SECURITY_POLICIES,
  METHOD_LIST_SECURITY_POLICY_ADDRESS_OBJECTS,
  METHOD_REMOVE_IPV6_FROM_GROUP,
  METHOD_UNBLOCK_IP,
  _test,
  handlers,
} from "../src/nsfocus-ngfw-v60-9900.js";
import { service } from "../src/service.js";

const originalNetconfRequest = _test.NSFOCUSNetconfClient.prototype.request;

const buildCtx = (overrides = {}) => ({
  config: {
    host: "192.168.0.1",
    port: 830,
    timeoutMs: 20000,
    ...(overrides.config || {}),
  },
  secret: {
    username: "admin",
    password: "password",
    ...(overrides.secret || {}),
  },
  request: overrides.request || {},
});

test.afterEach(() => {
  _test.NSFOCUSNetconfClient.prototype.request = originalNetconfRequest;
});

test("GetSystemStatus reads and maps NETCONF device status", async () => {
  let capturedBody;
  _test.NSFOCUSNetconfClient.prototype.request = async function request(body) {
    capturedBody = body;
    assert.equal(this.host, "192.168.0.1");
    assert.equal(this.port, 830);
    return `<?xml version="1.0"?><rpc-reply><data><top><Device><Base><HostDescription>NSFOCUS NF Software, Software Version 6.0, Alpha 9900P21</HostDescription><HostName>NF</HostName><DeviceType>5</DeviceType></Base><CPUs><CPU><CPUUsage>7</CPUUsage></CPU></CPUs><MemoryUsage>31</MemoryUsage></Device></top></data></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_GET_SYSTEM_STATUS](buildCtx());

  assert.match(capturedBody, /<get>/);
  assert.equal(res.product_ver, "NSFOCUS NF Software, Software Version 6.0, Alpha 9900P21");
  assert.equal(res.engine, "netconf");
  assert.equal(res.device_type, "5");
  assert.equal(res.cpu_usage, 7);
  assert.equal(res.mem_usage, 31);
  assert.ok(service);
});

test("CreateNodeObject creates an IPv4Groups group", async () => {
  let capturedBody;
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    capturedBody = body;
    return `<rpc-reply><ok/></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_CREATE_NODE_OBJECT](buildCtx({ request: { name: "octobus_group" } }));

  assert.match(capturedBody, /<IPv4Groups>/);
  assert.match(capturedBody, /<Name>octobus_group<\/Name>/);
  assert.equal(res.status, "success");
  assert.equal(res.name, "octobus_group");
});

test("ListSecurityLogs reads Syslog Logs", async () => {
  let capturedBody;
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    capturedBody = body;
    return `<rpc-reply><data><top><Syslog><Logs><Log><Index>1</Index><Time>2026-06-29T10:00:00</Time><Group>SECM</Group><Digest>SECURITY</Digest><Severity>4</Severity><Content>security log</Content></Log></Logs></Syslog></top></data></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_LIST_SECURITY_LOGS](buildCtx());

  assert.match(capturedBody, /<Syslog><Logs\/><\/Syslog>/);
  assert.equal(res.logs.length, 1);
  assert.equal(res.logs[0].fields.group.stringValue, "SECM");
  assert.equal(res.logs[0].fields.content.stringValue, "security log");
});

test("ListSecurityPolicies reads IPv4 and IPv6 policy rules", async () => {
  const bodies = [];
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    bodies.push(body);
    return `<rpc-reply><data><top><SecurityPolicies><IPv6Rules><Rule><ID>100</ID><RuleName>allow-v6</RuleName><Action>2</Action><Enable>true</Enable><Log>true</Log><RuleGroupName>default</RuleGroupName></Rule></IPv6Rules></SecurityPolicies></top></data></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_LIST_SECURITY_POLICIES](buildCtx({ request: { ip_version: "ipv6" } }));

  assert.match(bodies[0], /<SecurityPolicies><IPv6Rules\/><\/SecurityPolicies>/);
  assert.equal(res.policies.length, 1);
  assert.equal(res.policies[0].fields.id.stringValue, "100");
  assert.equal(res.policies[0].fields.name.stringValue, "allow-v6");
});

test("ListSecurityPolicyAddressObjects reads source and destination address groups", async () => {
  const bodies = [];
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    bodies.push(body);
    if (body.includes("IPv4SrcAddr")) return `<rpc-reply><data><SecurityPolicies><IPv4SrcAddr><SrcAddr><ID>10</ID><SeqNum>1</SeqNum><NameList><NameItem>src_group</NameItem></NameList></SrcAddr></IPv4SrcAddr></SecurityPolicies></data></rpc-reply>]]>]]>`;
    return `<rpc-reply><data><SecurityPolicies><IPv4DestAddr><DestAddr><ID>10</ID><SeqNum>1</SeqNum><NameList><NameItem>dst_group</NameItem></NameList></DestAddr></IPv4DestAddr></SecurityPolicies></data></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_LIST_SECURITY_POLICY_ADDRESS_OBJECTS](buildCtx({ request: { ip_version: "4", rule_id: "10" } }));

  assert.match(bodies[0], /IPv4SrcAddr/);
  assert.match(bodies[1], /IPv4DestAddr/);
  assert.equal(res.objects.length, 2);
  assert.equal(res.objects[0].fields.direction.stringValue, "source");
  assert.equal(res.objects[0].fields.name.stringValue, "src_group");
  assert.equal(res.objects[1].fields.direction.stringValue, "destination");
});

test("DeleteNodeObject removes an IPv4Groups group", async () => {
  let capturedBody;
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    capturedBody = body;
    return `<rpc-reply><ok/></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_DELETE_NODE_OBJECT](buildCtx({ request: { id: "octobus_group" } }));

  assert.match(capturedBody, /<IPv4Groups web:operation=\"remove\">/);
  assert.match(capturedBody, /<Name>octobus_group<\/Name>/);
  assert.equal(res.status, "success");
});

test("BlockIP creates a group and IPv4Objs entries", async () => {
  const bodies = [];
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    bodies.push(body);
    return `<rpc-reply><ok/></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_BLOCK_IP](buildCtx({
    request: {
      ips: ["10.10.10.10", "10.10.10.11"],
      policy_name: "octobus_test_group",
    },
  }));

  assert.equal(bodies.length, 3);
  assert.match(bodies[0], /<IPv4Groups>/);
  assert.match(bodies[1], /<IPv4Objs web:operation=\"create\">/);
  assert.match(bodies[1], /<HostIPv4Address>10.10.10.10<\/HostIPv4Address>/);
  assert.match(bodies[2], /<HostIPv4Address>10.10.10.11<\/HostIPv4Address>/);
  assert.equal(res.policy_result.status, "success");
  assert.equal(res.node_results.length, 2);
});

test("UnblockIP removes IPv4Objs entries", async () => {
  const bodies = [];
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    bodies.push(body);
    return `<rpc-reply><ok/></rpc-reply>]]>]]>`;
  };

  const res = await handlers[METHOD_UNBLOCK_IP](buildCtx({
    request: {
      policy_id: "octobus_test_group",
      node_ids: ["10.10.10.10"],
    },
  }));

  assert.equal(bodies.length, 1);
  assert.match(bodies[0], /<IPv4Objs web:operation=\"remove\">/);
  assert.match(bodies[0], /<Group>octobus_test_group<\/Group>/);
  assert.equal(res.policy_result.status, "success");
  assert.equal(res.node_results[0].status, "success");
});

test("IPv6 group operations build IPv6Groups and IPv6Objs edits", async () => {
  const bodies = [];
  _test.NSFOCUSNetconfClient.prototype.request = async (body) => {
    bodies.push(body);
    return `<rpc-reply><ok/></rpc-reply>]]>]]>`;
  };

  await handlers[METHOD_CREATE_IPV6_ADDRESS_GROUP](buildCtx({ request: { name: "v6_group" } }));
  await handlers[METHOD_ADD_IPV6_TO_GROUP](buildCtx({ request: { group: "v6_group", ips: ["2001:db8::1"] } }));
  await handlers[METHOD_REMOVE_IPV6_FROM_GROUP](buildCtx({ request: { group: "v6_group", ips: ["2001:db8::1"] } }));

  assert.match(bodies[0], /<IPv6Groups>/);
  assert.match(bodies[1], /<IPv6Groups>/);
  assert.match(bodies[2], /<IPv6Objs web:operation=\"create\">/);
  assert.match(bodies[2], /<HostIPv6Address>2001:db8::1<\/HostIPv6Address>/);
  assert.match(bodies[3], /<IPv6Objs web:operation=\"remove\">/);
});

test("validation errors map to gRPC errors", async () => {
  await assert.rejects(
    () => handlers[METHOD_BLOCK_IP](buildCtx({ request: { ips: [] } })),
    /ips is required/,
  );
  await assert.rejects(
    () => handlers[METHOD_CREATE_NODE_OBJECT](buildCtx({ request: {} })),
    /name is required/,
  );
  await assert.rejects(
    () => handlers[METHOD_GET_SYSTEM_STATUS](buildCtx({ config: { host: "" } })),
    (err) => err instanceof GrpcError && err.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("helpers escape XML and derive stable IPv4 object ids", () => {
  assert.equal(_test.escapeXml("a&b<c>"), "a&amp;b&lt;c&gt;");
  assert.equal(_test.ipObjectId("10.10.10.10"), "10101010");
  assert.equal(_test.ipv6ObjectId("2001:db8::1").length, 9);
  assert.match(_test.groupConfig("g&1"), /g&amp;1/);
  assert.match(_test.ipConfig("g", "1.1.1.1"), /<HostIPv4Address>1.1.1.1<\/HostIPv4Address>/);
  assert.match(_test.ipv6Config("g", "2001:db8::1"), /<HostIPv6Address>2001:db8::1<\/HostIPv6Address>/);
});
