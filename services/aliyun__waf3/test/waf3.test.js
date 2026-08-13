import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { handlers } from "../src/waf3.js";
import { server, PORT } from "./mock_upstream.js";

// ── 构造 call 对象 ──
function buildCall(request, configOverrides = {}, secretOverrides = {}) {
  const config = {
    endpoint: `http://127.0.0.1:${PORT}`,
    regionId: "cn-hangzhou",
    instanceId: "waf_v2_test",
    timeoutMs: 5000,
    ...configOverrides
  };
  const secret = {
    accessKeyId: "test-ak-id",
    accessKeySecret: "test-ak-secret",
    ...secretOverrides
  };
  return { request, config, secret };
}

describe("aliyun__waf3", () => {
  before(() => {
    // mock_upstream 在 import 时自动启动
  });

  after(() => {
    server.close();
  });

  // ── BlockIP ──
  describe("BlockIP", () => {
    it("should block IPs and return rule_id", async () => {
      const resp = await handlers.BlockIP(buildCall({
        ips: ["1.2.3.4", "5.6.7.0/24"],
        ruleName: "test-block"
      }));
      assert.ok(resp.ruleId);
      assert.ok(typeof resp.ruleId === "string");
    });

    it("should reject empty ips", async () => {
      await assert.rejects(
        () => handlers.BlockIP(buildCall({ ips: [] })),
        /ips is required/
      );
    });

    it("should reject invalid action", async () => {
      await assert.rejects(
        () => handlers.BlockIP(buildCall({ ips: ["1.2.3.4"], action: "invalid" })),
        /invalid action/
      );
    });
  });

  // ── UnblockIP ──
  describe("UnblockIP", () => {
    it("should unblock IPs", async () => {
      // 先封禁
      const blockResp = await handlers.BlockIP(buildCall({
        ips: ["10.0.0.1", "10.0.0.2"],
        ruleName: "test-unblock"
      }));

      // 再解封
      const resp = await handlers.UnblockIP(buildCall({
        ruleId: blockResp.ruleId,
        ips: ["10.0.0.1"]
      }));
      assert.strictEqual(resp.success, true);
    });

    it("should reject empty rule_id", async () => {
      await assert.rejects(
        () => handlers.UnblockIP(buildCall({ ips: ["1.2.3.4"] })),
        /rule_id is required/
      );
    });
  });

  // ── DescribeIPBlacklist ──
  describe("DescribeIPBlacklist", () => {
    it("should list blacklist rules", async () => {
      await handlers.BlockIP(buildCall({ ips: ["99.99.99.99"], ruleName: "list-test" }));
      const resp = await handlers.DescribeIPBlacklist(buildCall({}));
      assert.ok(resp.rules.length > 0);
      assert.ok(resp.total > 0);
    });

    it("should paginate", async () => {
      const resp = await handlers.DescribeIPBlacklist(buildCall({ pageNumber: 1, pageSize: 5 }));
      assert.ok(Array.isArray(resp.rules));
    });
  });

  // ── AddIPWhitelist ──
  describe("AddIPWhitelist", () => {
    it("should add IP whitelist", async () => {
      const resp = await handlers.AddIPWhitelist(buildCall({
        ips: ["192.168.1.1"],
        ruleName: "test-whitelist"
      }));
      assert.ok(resp.ruleId);
    });

    it("should reject empty ips", async () => {
      await assert.rejects(
        () => handlers.AddIPWhitelist(buildCall({ ips: [] })),
        /ips is required/
      );
    });
  });

  // ── CreateACLRule ──
  describe("CreateACLRule", () => {
    it("should create ACL rule", async () => {
      const resp = await handlers.CreateACLRule(buildCall({
        ruleName: "test-acl",
        conditions: [
          { key: "URL", opValue: "contain", values: "/admin" },
          { key: "IP", opValue: "eq", values: "10.0.0.0/8" }
        ],
        action: "block",
        status: 1
      }));
      assert.ok(resp.ruleId);
    });

    it("should reject empty conditions", async () => {
      await assert.rejects(
        () => handlers.CreateACLRule(buildCall({ ruleName: "test", conditions: [] })),
        /conditions is required/
      );
    });

    it("should reject too many conditions", async () => {
      const conditions = Array.from({ length: 6 }, (_, i) => ({
        key: "URL", opValue: "eq", values: `/test${i}`
      }));
      await assert.rejects(
        () => handlers.CreateACLRule(buildCall({ ruleName: "test", conditions })),
        /maximum 5 conditions/
      );
    });

    it("should reject invalid action", async () => {
      await assert.rejects(
        () => handlers.CreateACLRule(buildCall({
          ruleName: "test",
          conditions: [{ key: "URL", opValue: "eq", values: "/test" }],
          action: "redirect"
        })),
        /invalid action/
      );
    });
  });

  // ── DeleteRule ──
  describe("DeleteRule", () => {
    it("should delete a rule", async () => {
      const created = await handlers.BlockIP(buildCall({
        ips: ["1.1.1.1"],
        ruleName: "delete-test"
      }));
      const resp = await handlers.DeleteRule(buildCall({
        ruleId: created.ruleId
      }));
      assert.strictEqual(resp.success, true);
    });

    it("should reject empty rule_id", async () => {
      await assert.rejects(
        () => handlers.DeleteRule(buildCall({})),
        /rule_id is required/
      );
    });
  });

  // ── DescribeRule ──
  describe("DescribeRule", () => {
    it("should get rule detail", async () => {
      const created = await handlers.BlockIP(buildCall({
        ips: ["2.2.2.2"],
        ruleName: "detail-test"
      }));
      const resp = await handlers.DescribeRule(buildCall({ ruleId: created.ruleId }));
      assert.strictEqual(resp.ruleId, created.ruleId);
      assert.ok(resp.rulesJson);
    });

    it("should reject empty rule_id", async () => {
      await assert.rejects(
        () => handlers.DescribeRule(buildCall({})),
        /rule_id is required/
      );
    });
  });

  // ── DescribeRules ──
  describe("DescribeRules", () => {
    it("should list rules", async () => {
      const resp = await handlers.DescribeRules(buildCall({ defenseScene: "ip_blacklist" }));
      assert.ok(Array.isArray(resp.rules));
    });
  });

  // ── DescribeSecurityTopNMetric ──
  describe("DescribeSecurityTopNMetric", () => {
    it("should query security top N", async () => {
      const now = Math.floor(Date.now() / 1000);
      const resp = await handlers.DescribeSecurityTopNMetric(buildCall({
        startTime: now - 86400,
        endTime: now,
        metric: "real_client_ip",
        limit: 5
      }));
      assert.ok(resp.items.length > 0);
      assert.strictEqual(resp.items[0].name, "45.33.32.156");
    });

    it("should reject missing time range", async () => {
      await assert.rejects(
        () => handlers.DescribeSecurityTopNMetric(buildCall({})),
        /start_time and end_time required/
      );
    });
  });

  // ── DescribeResources ──
  describe("DescribeResources", () => {
    it("should list resources", async () => {
      const resp = await handlers.DescribeResources(buildCall({}));
      assert.ok(resp.resources.length > 0);
    });
  });

  // ── 认证错误映射 ──
  describe("error mapping", () => {
    it("should map UNAUTHENTICATED for invalid AK", async () => {
      // 通过 Mock 的特殊 action 触发认证失败
      try {
        await handlers.DescribeResources(buildCall({}, { endpoint: `http://127.0.0.1:${PORT}/?Action=InvalidAccessKeyId` }));
        assert.fail("should have thrown");
      } catch (e) {
        assert.ok(e.message.includes("Invalid"));
      }
    });
  });
});
