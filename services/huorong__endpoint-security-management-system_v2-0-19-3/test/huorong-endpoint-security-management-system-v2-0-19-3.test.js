import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  METHOD_CREATE_ISOLATION_TASK,
  METHOD_CREATE_SCAN_TASK,
  METHOD_GET_CLIENT_DETAILS,
  METHOD_LIST_CLIENTS,
  METHOD_LIST_GROUPS,
  METHOD_LIST_HIGH_RISK_CLIENTS,
  METHOD_LIST_ONLINE_MACS,
  METHOD_LIST_VIRUS_EVENTS,
  METHOD_SEND_NOTIFICATION,
  _test,
  handlers,
} from "../src/huorong-endpoint-security-management-system-v2-0-19-3.js";
import { startMockUpstream } from "./mock_upstream.js";

const buildCtx = (endpoint, req = {}, overrides = {}) => ({
  req,
  bindings: {
    endpoint,
    accessKeyId: "test-ak",
    accessKeySecret: "test-secret",
    ...overrides.bindings,
  },
  limits: {
    timeoutMs: 5000,
    ...overrides.limits,
  },
  meta: {
    instance_id: "inst-test",
    request_id: "req-test",
    ...overrides.meta,
  },
});

test("签名和基础工具函数行为稳定", () => {
  const body = JSON.stringify({});
  const expires = 1234567890;
  const result = _test.buildAuthorization({
    accessKeyId: "ak",
    accessKeySecret: "sk",
    method: "POST",
    path: "/api/group/_list",
    body,
    expires,
  });
  const expectedMd5 = crypto.createHash("md5").update(body).digest("base64");
  const expectedSign = encodeURIComponent(crypto.createHmac("sha1", "sk").update(`ak\n${expires}\nPOST\n${expectedMd5}\napi/group/_list`).digest("base64"));

  assert.equal(result.contentMD5, expectedMd5);
  assert.equal(result.authorization, `HRESSak:${expires}:${expectedSign}`);
  assert.equal(result.canonicalizedResource, "api/group/_list");
  assert.equal(_test.normalizeBaseUrl("https://example.com/"), "https://example.com");
  assert.equal(_test.normalizeBaseUrl("ftp://example.com"), null);
  assert.deepEqual(_test.parseHeaders("{\"X-Test\":\"yes\"}"), { "X-Test": "yes" });
  assert.deepEqual(_test.parseHeaders("bad"), {});
  assert.equal(_test.toLimit({ value: 2 }), 2);
  assert.equal(_test.toOffset({ value: 0 }), 0);
});

test("ListGroups 发送带签名的请求并映射分组", async () => {
  const upstream = await startMockUpstream((record) => {
    assert.equal(record.method, "POST");
    assert.equal(record.url, "/api/group/_list");
    assert.equal(record.headers["content-md5"], crypto.createHash("md5").update("{}").digest("base64"));
    assert.match(record.headers.authorization, /^HRESStest-ak:\d+:/);
    return {
      body: {
        errno: 0,
        errmsg: "",
        data: {
          list: [
            { group_id: 1, parent_group: 0, group_name: "未分组终端" },
          ],
        },
      },
    };
  });
  try {
    const res = await handlers[METHOD_LIST_GROUPS](buildCtx(upstream.endpoint));
    assert.deepEqual(res.groups, [{ group_id: 1, parent_group: 0, group_name: "未分组终端" }]);
  } finally {
    await upstream.close();
  }
});

test("ListOnlineMacs、ListClients、GetClientDetails 映射分页和终端信息", async () => {
  const upstream = await startMockUpstream((record) => {
    if (record.url === "/api/clnts/_online") {
      assert.deepEqual(record.json, { limit: 2, offset: 1 });
      return { body: { errno: 0, data: { list: [{ mac: "00:11" }, "22:33"], total: 3 } } };
    }
    if (record.url === "/api/clnts/_list") {
      return {
        body: {
          errno: 0,
          data: {
            list: [{ id: 7, client_id: "cid-1", local_ip: "10.0.0.1", client_name: "pc-1", is_online: true }],
            total: 1,
          },
        },
      };
    }
    if (record.url === "/api/clnts/_info2") {
      assert.deepEqual(record.json, { clients: ["cid-1"], options: ["hardware", "software"] });
      return {
        body: {
          errno: 0,
          data: {
            list: [{
              id: 7,
              client_id: "cid-1",
              client_name: "pc-1",
              hardware: { board: "demo" },
              software: [{ name: "demo-app" }],
            }],
          },
        },
      };
    }
    throw new Error(`unexpected path ${record.url}`);
  });
  try {
    const online = await handlers[METHOD_LIST_ONLINE_MACS](buildCtx(upstream.endpoint, { limit: { value: 2 }, offset: { value: 1 } }));
    assert.equal(online.total, 3);
    assert.equal(online.records[0].mac, "00:11");
    assert.equal(online.records[1].mac, "22:33");

    const clients = await handlers[METHOD_LIST_CLIENTS](buildCtx(upstream.endpoint, { limit: 10 }));
    assert.equal(clients.total, 1);
    assert.equal(clients.clients[0].client_id, "cid-1");
    assert.equal(clients.clients[0].is_online, true);

    const detail = await handlers[METHOD_GET_CLIENT_DETAILS](buildCtx(upstream.endpoint, { clients: ["cid-1"], options: ["hardware", "software"] }));
    assert.equal(detail.clients[0].base.client_id, "cid-1");
    assert.deepEqual(detail.clients[0].hardware, { board: "demo" });
    assert.deepEqual(detail.clients[0].software, [{ name: "demo-app" }]);
  } finally {
    await upstream.close();
  }
});

test("风险和病毒事件接口映射响应", async () => {
  const upstream = await startMockUpstream((record) => {
    if (record.url === "/api/clnts/_leak") {
      return {
        body: {
          errno: 0,
          data: {
            list: [{ cid: "cid-risk", hostname: "host", group_id: 1, stat: 2 }],
            all_client: 10,
            risk_client: 1,
          },
        },
      };
    }
    if (record.url === "/api/clnts/_virus_events") {
      assert.deepEqual(record.json, { type: 2, limit: 5, offset: 0 });
      return {
        body: {
          errno: 0,
          data: {
            list: [{ client_id: "cid-1", count: 3, result: { success: 2, fail: 1, ignored: 0, trusted: 0 } }],
            total: 1,
          },
        },
      };
    }
    throw new Error(`unexpected path ${record.url}`);
  });
  try {
    const risks = await handlers[METHOD_LIST_HIGH_RISK_CLIENTS](buildCtx(upstream.endpoint));
    assert.equal(risks.all_client, 10);
    assert.equal(risks.risk_client, 1);
    assert.equal(risks.clients[0].cid, "cid-risk");

    const events = await handlers[METHOD_LIST_VIRUS_EVENTS](buildCtx(upstream.endpoint, { type: 2, limit: 5 }));
    assert.equal(events.total, 1);
    assert.equal(events.records[0].result.fail, 1);
  } finally {
    await upstream.close();
  }
});

test("写入类任务请求使用安全默认参数", async () => {
  const paths = [];
  const upstream = await startMockUpstream((record) => {
    paths.push(record.json);
    return { body: { errno: 0, errmsg: "", data: { task_id: 123 } } };
  });
  try {
    await handlers[METHOD_CREATE_SCAN_TASK](buildCtx(upstream.endpoint, { scan_type: "custom_scan", clients: ["cid-1"], scan_list: ["C:\\\\test"] }));
    assert.equal(paths[0].type, "custom_scan");
    assert.deepEqual(paths[0].clients, ["cid-1"]);
    assert.deepEqual(paths[0].param.scan_list, ["C:\\\\test"]);
    assert.equal(paths[0].param.clean_automate, true);
    assert.equal(paths[0].param.clean_quarantine, true);
    assert.equal(paths[0].param.cannot_cancel, true);

    await handlers[METHOD_CREATE_ISOLATION_TASK](buildCtx(upstream.endpoint, { clients: ["cid-1"], net_isolation: true }));
    assert.equal(paths[1].type, "netctrl");
    assert.deepEqual(paths[1].param, { net_isolation: true });

    await handlers[METHOD_SEND_NOTIFICATION](buildCtx(upstream.endpoint, { clients: ["cid-1"], text: "测试通知" }));
    assert.equal(paths[2].type, "message");
    assert.deepEqual(paths[2].param, { text: "测试通知" });
  } finally {
    await upstream.close();
  }
});

test("OctoBus Connect 运行时通过 request 字段传递入参", async () => {
  const upstream = await startMockUpstream((record) => {
    assert.equal(record.url, "/api/task/_create");
    assert.deepEqual(record.json.clients, ["cid-connect"]);
    assert.equal(record.json.type, "quick_scan");
    return { body: { errno: 0, errmsg: "", data: null } };
  });
  try {
    const res = await handlers[METHOD_CREATE_SCAN_TASK]({
      request: { clients: ["cid-connect"], scan_type: "quick_scan" },
      bindings: {
        endpoint: upstream.endpoint,
        accessKeyId: "test-ak",
        accessKeySecret: "test-secret",
      },
      limits: { timeoutMs: 5000 },
    });
    assert.equal(res.errno, 0);
    assert.equal(res.data, null);
  } finally {
    await upstream.close();
  }
});

test("参数错误、认证失败和服务端错误按 gRPC 状态映射", async () => {
  await assert.rejects(
    () => handlers[METHOD_LIST_CLIENTS](buildCtx("http://127.0.0.1", { limit: 0 })),
    /INVALID_ARGUMENT: limit must be >= 1/,
  );
  await assert.rejects(
    () => handlers[METHOD_GET_CLIENT_DETAILS](buildCtx("http://127.0.0.1", {})),
    /INVALID_ARGUMENT: clients or mac must be provided/,
  );

  const authFailed = await startMockUpstream(() => ({ body: { errno: 1, errmsg: "Authentication failed" } }));
  try {
    await assert.rejects(
      () => handlers[METHOD_LIST_GROUPS](buildCtx(authFailed.endpoint)),
      /UNAUTHENTICATED: Authentication failed/,
    );
  } finally {
    await authFailed.close();
  }

  const serverError = await startMockUpstream(() => ({ status: 502, body: { errno: 3, errmsg: "bad gateway" } }));
  try {
    await assert.rejects(
      () => handlers[METHOD_LIST_GROUPS](buildCtx(serverError.endpoint)),
      /UNAVAILABLE: HTTP 502/,
    );
  } finally {
    await serverError.close();
  }
});
