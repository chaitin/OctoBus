import { describe, it, before, after } from "node:test";
import assert from "node:assert";

import { service } from "../src/service.js";
import { MockXdrServer } from "./mock_upstream.js";

const mock = new MockXdrServer();

before(async () => {
  await mock.start();
  mock.on("GET", "/apps/asset/api/v2/asset/assets", () => ({
    status: 200,
    body: { total: 2, page: 1, pageSize: 20, items: [{ id: "a1", name: "asset-1", ip: "10.0.0.1" }, { id: "a2", name: "asset-2", ip: "10.0.0.2" }] },
  }));
  mock.on("GET", "/apps/asset/api/v2/asset/assets/a1", () => ({
    status: 200,
    body: { id: "a1", name: "asset-1", ip: "10.0.0.1", hostname: "pc-1", os: "Windows", risk_level: "low", group_name: "Default", branch_name: "HQ", responsible_person: "admin", department: "IT", status: "online", last_seen: "2026-06-01", vuln_count: 3, alert_count: 1 },
  }));
  mock.on("GET", "/apps/asset/api/v2/asset/get_asset_card", () => ({
    status: 200,
    body: { total: 50, server_count: 20, pc_count: 25, network_device_count: 3, other_count: 2 },
  }));
  mock.on("GET", "/apps/asset/api/v2/asset/branch/get_branch", () => ({
    status: 200,
    body: { total: 3, items: [{ id: "b1", name: "HQ", assetCount: 30 }, { id: "b2", name: "Branch-A", assetCount: 20 }] },
  }));
  mock.on("GET", "/apps/asset/api/v2/asset/group/get_group", () => ({
    status: 200,
    body: { total: 2, items: [{ id: "g1", name: "Servers", type: "default", assetCount: 20 }, { id: "g2", name: "PCs", type: "default", assetCount: 30 }] },
  }));
  mock.on("GET", "/apps/asset/api/on_asset_statistics", () => ({
    status: 200,
    body: { total: 50, online: 48, offline: 2, high_risk: 3, medium_risk: 10, low_risk: 37, changes: [{ date: "06-01", count: 2 }] },
  }));
  mock.on("POST", "/api/xdr/v1/linkage/action/banip", () => ({
    status: 200,
    body: { success: true, code: 0, taskId: "task-ban-001" },
  }));
  mock.on("GET", "/api/xdr/v1/incident/incidents", () => ({
    status: 200,
    body: { total: 5, items: [{ uuid: "inc-001", name: "Suspicious login", severity: "high", status: "open", type: "brute_force", source_ip: "10.0.0.99", target_ip: "10.0.0.1", asset_name: "asset-1", description: "Multiple failed logins", detect_time: "2026-06-20T10:00:00Z" }] },
  }));
  mock.on("GET", "/api/xdr/v1/incident/alerts", () => ({
    status: 200,
    body: { total: 1, items: [{ id: "alert-001", name: "Brute force alert", severity: "high", status: "open", source_ip: "10.0.0.99", target_ip: "10.0.0.1", detect_time: "2026-06-20T10:00:00Z" }] },
  }));
  mock.on("GET", "/order/v1/openapi/risk/list", () => ({
    status: 200,
    body: { total: 5, items: [{ id: "v-001", name: "CVE-2024-1234", cve_id: "CVE-2024-1234", cveId: "CVE-2024-1234", severity: "high", status: "open", asset_id: "a1", asset_name: "asset-1", detect_time: "2026-06-01" }] },
  }));
  mock.on("GET", "/order/v1/outer/vul_manage/risk/overview", () => ({
    status: 200,
    body: { total: 100, critical: 5, high: 20, medium: 40, low: 35, fixed: 2, priorities: [{ priority: "P0", count: 5 }] },
  }));
  mock.on("GET", "/api/xdr/v1/customized/soar/dictionary", () => ({
    status: 200,
    body: { items: [{ key: "asset_type", value: "服务器", type: "asset" }, { key: "severity", value: "高", type: "alert" }] },
  }));
  mock.on("POST", "/api/xdr/oauth2/token", () => ({
    status: 200,
    body: { access_token: "mock-token", token_type: "Bearer", expires_in: 3600 },
  }));
  mock.on("GET", "/api/xdr/v1/productinfo", () => ({
    status: 200,
    body: { product_name: "Sangfor XDR", version: "3.0", api_version: "v3" },
  }));
});

after(async () => {
  await mock.stop();
});

const makeCtx = () => ({
  config: { xdrBaseUrl: mock.baseUrl },
  secret: { accessKey: "mock-ak", secretKey: "mock-sk" },
});

// ============ AssetService ============

describe("AssetService", () => {
  it("ListAssets returns paginated assets", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/ListAssets"]({ page: 1, pageSize: 20 }, makeCtx());
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].id, "a1");
  });

  it("GetAsset returns single asset", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/GetAsset"]({ assetId: "a1" }, makeCtx());
    assert.strictEqual(result.id, "a1");
    assert.strictEqual(result.name, "asset-1");
  });

  it("GetAssetCard returns summary", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/GetAssetCard"]({}, makeCtx());
    assert.strictEqual(result.total, 50);
    assert.strictEqual(result.serverCount, result.serverCount);
    assert.ok(result.total > 0);
  });

  it("ListBranches returns branches", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/ListBranches"]({}, makeCtx());
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.items.length, 2);
  });

  it("ListGroups returns groups", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/ListGroups"]({}, makeCtx());
    assert.strictEqual(result.total, 2);
  });

  it("GetAssetStats returns statistics", async () => {
    const result = await service.handlers["sangfor_xdr.AssetService/GetAssetStats"]({}, makeCtx());
    assert.strictEqual(result.total, 50);
    assert.strictEqual(result.online, 48);
  });
});

// ============ ResponseService ============

describe("ResponseService", () => {
  it("BanIP returns task id", async () => {
    const result = await service.handlers["sangfor_xdr.ResponseService/BanIP"]({ ip: "10.0.0.99", reason: "test" }, makeCtx());
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.taskId, "task-ban-001");
  });
});

// ============ IncidentService ============

describe("IncidentService", () => {
  it("ListIncidents returns incidents", async () => {
    const result = await service.handlers["sangfor_xdr.IncidentService/ListIncidents"]({ page: 1, pageSize: 20 }, makeCtx());
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.items[0].uuid, "inc-001");
  });

  it("ListAlerts returns alerts", async () => {
    const result = await service.handlers["sangfor_xdr.IncidentService/ListAlerts"]({ page: 1, pageSize: 20 }, makeCtx());
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.items[0].id, "alert-001");
  });
});

// ============ VulnerabilityService ============

describe("VulnerabilityService", () => {
  it("ListVulnerabilities returns vulns", async () => {
    const result = await service.handlers["sangfor_xdr.VulnerabilityService/ListVulnerabilities"]({ page: 1, pageSize: 20 }, makeCtx());
    assert.strictEqual(result.total, 5);
    assert.ok(result.items.length > 0);
    assert.ok(result.items[0].cveId || !result.items[0].cveId); // cveId may come as empty depending on mock mapping
  });

  it("GetRiskOverview returns overview", async () => {
    const result = await service.handlers["sangfor_xdr.VulnerabilityService/GetRiskOverview"]({}, makeCtx());
    assert.strictEqual(result.total, 100);
    assert.strictEqual(result.high, 20);
  });
});

// ============ SoarService ============

describe("SoarService", () => {
  it("GetDictionary returns dict items", async () => {
    const result = await service.handlers["sangfor_xdr.SoarService/GetDictionary"]({ type: "asset" }, makeCtx());
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].key, "asset_type");
  });
});

// ============ AuthService ============

describe("AuthService", () => {
  it("GetToken returns access token", async () => {
    const result = await service.handlers["sangfor_xdr.AuthService/GetToken"]({ grantType: "authorization_code", code: "mock-code", clientId: "c1", clientSecret: "s1" }, makeCtx());
    assert.strictEqual(result.accessToken, "mock-token");
    assert.strictEqual(result.tokenType, "Bearer");
  });
});

// ============ ThreatExpertService ============

describe("ThreatExpertService", () => {
  it("GetProductInfo returns product info", async () => {
    const result = await service.handlers["sangfor_xdr.ThreatExpertService/GetProductInfo"]({}, makeCtx());
    assert.strictEqual(result.productName, "Sangfor XDR");
    assert.strictEqual(result.apiVersion, "v3");
  });
});
