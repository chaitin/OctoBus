import test from "node:test";
import assert from "node:assert/strict";

import { handlers } from "../src/lighthouse-firewall.js";
import { GrpcError } from "@chaitin-ai/octobus-sdk";

const ctx = {
  config: { endpoint: "https://lighthouse.tencentcloudapi.com", region: "ap-guangzhou", timeoutMs: 1000 },
  secret: { secretId: "sid", secretKey: "skey" },
};

const mockFetch = (impl) => {
  global.fetch = async (...args) => impl(...args);
};

test("ListFirewallRules signs and maps Tencent Cloud request", async () => {
  let captured;
  mockFetch(async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        Response: {
          TotalCount: 1,
          FirewallRuleSet: [{ Protocol: "TCP", Port: "22", CidrBlock: "10.0.0.1", Action: "DROP", FirewallRuleDescription: "octobus" }],
          RequestId: "req-1",
        },
      }),
    };
  });

  const res = await handlers.ListFirewallRules({ instance_id: "lhins-test", limit: 20 }, ctx);

  assert.equal(captured.url, "https://lighthouse.tencentcloudapi.com");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["X-TC-Action"], "DescribeFirewallRules");
  assert.equal(captured.init.headers["X-TC-Version"], "2020-03-24");
  assert.equal(captured.init.headers["X-TC-Region"], "ap-guangzhou");
  assert.match(captured.init.headers.Authorization, /^TC3-HMAC-SHA256 Credential=sid\//);
  assert.deepEqual(captured.body, { InstanceId: "lhins-test", Limit: 20 });
  assert.equal(res.total_count, 1);
  assert.equal(res.rules[0].protocol, "TCP");
  assert.equal(res.rules[0].cidr_block, "10.0.0.1");
  assert.equal(res.request_id, "req-1");
});

test("CreateFirewallRules normalizes rule payload", async () => {
  let body;
  mockFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: "req-2" } }) };
  });

  const res = await handlers.CreateFirewallRules({
    region: "ap-shanghai",
    instance_id: "lhins-test",
    rules: [{ protocol: "tcp", port: "443", cidr_block: "0.0.0.0/0", action: "accept", firewall_rule_description: "https" }],
  }, ctx);

  assert.deepEqual(body, {
    InstanceId: "lhins-test",
    FirewallRules: [{ Protocol: "tcp", Port: "443", CidrBlock: "0.0.0.0/0", Action: "ACCEPT", FirewallRuleDescription: "https" }],
  });
  assert.equal(res.request_id, "req-2");
});

test("BlockIP and UnblockIP create matching DROP rules", async () => {
  const calls = [];
  mockFetch(async (_url, init) => {
    calls.push({ action: init.headers["X-TC-Action"], body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: `req-${calls.length}` } }) };
  });

  const req = { instance_id: "lhins-test", source_ips: ["1.1.1.1", "2.2.2.0/24"], protocol: "TCP", port: "ALL" };
  const block = await handlers.BlockIP(req, ctx);
  const unblock = await handlers.UnblockIP(req, ctx);

  assert.equal(calls[0].action, "CreateFirewallRules");
  assert.equal(calls[1].action, "DeleteFirewallRules");
  assert.deepEqual(calls[0].body.FirewallRules, calls[1].body.FirewallRules);
  assert.equal(block.created_rules[0].action, "DROP");
  assert.equal(unblock.deleted_rules[1].cidr_block, "2.2.2.0/24");
});

test("ModifyFirewallRules and ApplyFirewallTemplate map payloads", async () => {
  const bodies = [];
  mockFetch(async (_url, init) => {
    bodies.push({ action: init.headers["X-TC-Action"], body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: "req" } }) };
  });

  await handlers.ModifyFirewallRules({
    instance_id: "lhins-test",
    rules: [{
      firewall_rule: { protocol: "TCP", port: "80", cidr_block: "0.0.0.0/0", action: "ACCEPT" },
      new_firewall_rule: { protocol: "TCP", port: "80", cidr_block: "10.0.0.1", action: "DROP" },
    }],
  }, ctx);
  await handlers.ApplyFirewallTemplate({ template_id: "lhft-test", instance_ids: ["lhins-a", "lhins-b"] }, ctx);

  assert.equal(bodies[0].action, "ModifyFirewallRules");
  assert.equal(bodies[0].body.FirewallRules[0].NewFirewallRule.Action, "DROP");
  assert.equal(bodies[1].action, "ApplyFirewallTemplate");
  assert.deepEqual(bodies[1].body.InstanceIds, ["lhins-a", "lhins-b"]);
});

test("validates arguments and maps cloud errors", async () => {
  await assert.rejects(() => handlers.ListFirewallRules({}, ctx), /instance_id is required/);
  await assert.rejects(() => handlers.CreateFirewallRules({ instance_id: "lhins-test", rules: [] }, ctx), /rules must be a non-empty array/);

  mockFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ Response: { Error: { Code: "UnauthorizedOperation.NoPermission", Message: "denied" }, RequestId: "req" } }),
  }));
  await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "lhins-test" }, ctx), (err) => {
    assert.ok(err instanceof GrpcError);
    assert.equal(err.legacyCode, "PERMISSION_DENIED");
    assert.match(err.message, /denied/);
    return true;
  });
});

test("covers context shapes, validation, HTTP and Tencent error mapping", async () => {
  await assert.rejects(() => handlers.ListFirewallRules({ request: { instance_id: "i" }, config: { region: "r" }, secret: {} }), /secretId is required/);
  await assert.rejects(() => handlers.ListFirewallRules({ req: { instance_id: "i" }, config: { region: "r" }, secret: { secretId: "id" } }), /secretKey is required/);
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ Response: {} }) }));
  await handlers.ListFirewallRules({ instance_id: "i" }, { secret: ctx.secret });
  await assert.rejects(() => handlers.CreateFirewallRules({ instance_id: "i", rules: [null] }, ctx), /must be an object/);
  await assert.rejects(() => handlers.CreateFirewallRules({ instance_id: "i", rules: [{}] }, ctx), /protocol is required/);
  await assert.rejects(() => handlers.BlockIP({ instance_id: "i", source_ips: [""] }, ctx), /must be non-empty/);
  await assert.rejects(() => handlers.ApplyFirewallTemplate({ template_id: "t", instance_ids: [""] }, ctx), /must be non-empty/);

  for (const [code, expected] of [
    ["InvalidParameter.X", "INVALID_ARGUMENT"], ["ResourceNotFound.X", "FAILED_PRECONDITION"],
    ["InternalError.X", "UNAVAILABLE"], ["Other.X", "UNKNOWN"],
  ]) {
    mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ Response: { Error: { Code: code, Message: "failed" } } }) }));
    await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "i" }, ctx), (e) => e.legacyCode === expected);
  }

  mockFetch(async () => ({ ok: false, status: 500, statusText: "down", text: async () => "not-json", headers: new Headers() }));
  await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "i" }, ctx), (e) => e instanceof GrpcError);
  mockFetch(async () => { throw new Error("network down"); });
  await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "i" }, ctx), (e) => e.legacyCode === "UNAVAILABLE");
});

test("DeleteFirewallRules maps write response", async () => {
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: "deleted" } }) }));
  const result = await handlers.DeleteFirewallRules({ instance_id: "i", rules: [{ protocol: "TCP", port: "22", cidr_block: "1.1.1.1", action: "DROP" }] }, ctx);
  assert.equal(result.request_id, "deleted");
});

test("supports aliases, defaults, sparse responses and temporary credentials", async () => {
  const calls = [];
  mockFetch(async (_url, init) => {
    calls.push(init);
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: {} }) };
  });
  const aliasCtx = {
    bindings: { region: "ap-beijing" },
    secrets: { secret_id: "sid", secret_key: "skey", token: "sts" },
  };
  const listed = await handlers.ListFirewallRules({ req: { instanceId: "i", offset: -1, limit: "bad" }, ...aliasCtx });
  assert.equal(listed.total_count, 0);
  assert.deepEqual(listed.rules, []);
  assert.equal(calls[0].headers["X-TC-Token"], "sts");
  const blocked = await handlers.BlockIP({ instanceId: "i", sourceIps: ["1.1.1.1"] }, aliasCtx);
  assert.equal(blocked.created_rules[0].protocol, "TCP");
  assert.equal(blocked.created_rules[0].port, "ALL");
  await handlers.CreateFirewallRules({ instanceId: "i", credential: { secretId: "id", secretKey: "key" }, region: "r", rules: [{ Protocol: "UDP", Port: "53", CidrBlock: "0.0.0.0/0", Action: "ACCEPT" }] }, {});
});

test("maps HTTP error envelopes and alternative response field names", async () => {
  for (const envelope of [
    { Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "bad signature" } } },
    { response: { error: { code: "MissingParameter.InstanceId", message: "missing" } } },
  ]) {
    mockFetch(async () => ({ ok: false, status: 400, statusText: "bad", headers: new Headers(), text: async () => JSON.stringify(envelope) }));
    await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "i" }, ctx), (e) => e instanceof GrpcError);
  }
  mockFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: { error: { code: "FailedOperation.X", message: "failed" } } }) }));
  await assert.rejects(() => handlers.ListFirewallRules({ instance_id: "i" }, ctx), (e) => e.legacyCode === "FAILED_PRECONDITION");
});

test("validates every rule field and write request shape", async () => {
  const base = { instance_id: "i" };
  for (const [rule, message] of [
    [{ protocol: "TCP" }, /port is required/],
    [{ protocol: "TCP", port: "22" }, /cidr_block is required/],
    [{ protocol: "TCP", port: "22", cidr_block: "1.1.1.1" }, /action is required/],
  ]) await assert.rejects(() => handlers.CreateFirewallRules({ ...base, rules: [rule] }, ctx), message);
  await assert.rejects(() => handlers.ModifyFirewallRules({ ...base, rules: [null] }, ctx), /must be an object/);
  await assert.rejects(() => handlers.ApplyFirewallTemplate({ template_id: "t", instance_ids: [] }, ctx), /non-empty array/);
  await assert.rejects(() => handlers.BlockIP({ instance_id: "i", source_ips: "bad" }, ctx), /non-empty array/);
  await assert.rejects(() => handlers.ModifyFirewallRules({ ...base, rules: [{}] }, ctx), /must be an object/);
});
