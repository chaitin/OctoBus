import test from "node:test";
import assert from "node:assert/strict";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_LIST_HOSTS,
  METHOD_GET_HOST,
  METHOD_COUNT_HOSTS,
  METHOD_LIST_AGENTS,
  METHOD_COUNT_AGENTS,
  METHOD_LIST_DETECTIONS,
  METHOD_GET_DETECTION,
  METHOD_LIST_RESPONSE_RESULTS,
  METHOD_LIST_RESPONSE_HISTORY,
  METHOD_GET_ELEMENT_OPERATION_INFOS,
  METHOD_LIST_BASELINES,
  METHOD_GET_BASELINE,
  METHOD_LIST_BASELINE_TASKS,
  METHOD_GET_BASELINE_TASK_STATUS,
  METHOD_LIST_BASELINE_TASK_RESULTS,
  PATH_LIST_HOSTS,
  PATH_GET_HOST,
  PATH_COUNT_HOSTS,
  PATH_LIST_AGENTS,
  PATH_COUNT_AGENTS,
  PATH_LIST_DETECTIONS,
  PATH_GET_DETECTION,
  PATH_LIST_RESPONSE_RESULTS,
  PATH_LIST_RESPONSE_HISTORY,
  PATH_GET_ELEMENT_OPERATION_INFOS,
  PATH_LIST_BASELINES,
  PATH_GET_BASELINE,
  PATH_LIST_BASELINE_TASKS,
  PATH_GET_BASELINE_TASK_STATUS,
  PATH_LIST_BASELINE_TASK_RESULTS,
  handlers,
  rpcdef,
  _test,
} from "../src/qingteng-hids-v5.js";
import { service } from "../src/service.js";

const originalFetch = globalThis.fetch;

const buildCtx = (overrides = {}) => ({
  bindings: {
    baseUrl: "https://hids.example.com",
    token: "test-token-abc123",
    ...(overrides.bindings || {}),
  },
  config: overrides.config || {},
  secret: overrides.secret || {},
  limits: { timeoutMs: 10_000, ...(overrides.limits || {}) },
  req: overrides.req || {},
});

const responseWithStatus = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const okResponse = (body) => responseWithStatus(200, typeof body === "string" ? body : JSON.stringify(body));

const parseErrorPayload = async (fn) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected function to reject");
  return { err: caught, payload: JSON.parse(caught.message) };
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// -- Validation tests --

test("ListHosts validates baseUrl and token", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { baseUrl: "" } }))[PATH_LIST_HOSTS](),
    (err) => {
      assert.ok(err instanceof GrpcError);
      assert.equal(err.code, grpcStatus.INVALID_ARGUMENT);
      assert.match(err.message, /baseUrl is required/);
      return true;
    },
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ bindings: { token: "" } }))[PATH_LIST_HOSTS](),
    /token is required/,
  );
});

// -- Bearer header and URL construction --

test("ListHosts sends Bearer token and correct URL", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [{ id: "1", name: "web-01", main_ip: "10.0.0.1" }], total: 1 });
  };

  const result = await rpcdef(buildCtx())[PATH_LIST_HOSTS]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-asset/service-asset/v1/hosts/list");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-token-abc123");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0].id, "1");
  assert.equal(result.hosts[0].name, "web-01");
  assert.ok(result.raw);
  assert.equal(result.raw.http_status, 200);
});

// -- TLS options --

test("verifyTLS false sets skip TLS flags", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [], total: 0 });
  };

  await rpcdef(buildCtx({ bindings: { verifyTLS: false } }))[PATH_LIST_HOSTS]();

  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.tlsInsecureSkipVerify, true);
  assert.equal(captured.init.insecureSkipVerify, true);
});

test("skipTlsVerify true sets skip TLS flags", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [], total: 0 });
  };

  await rpcdef(buildCtx({ bindings: { skipTlsVerify: true } }))[PATH_LIST_HOSTS]();

  assert.equal(captured.init.skipTlsVerify, true);
  assert.equal(captured.init.tlsInsecureSkipVerify, true);
});

// -- Host mapping --

test("ListHosts maps host fields correctly", async () => {
  globalThis.fetch = async () => okResponse({
    data: [{
      id: "100",
      name: "prod-web-01",
      main_ip: "10.0.0.100",
      agent_id: "agt-100",
      agent_status: "online",
      os: { type: "linux", arch: "x86_64", dist: "Ubuntu", version: "22.04", kernel_version: "5.15.0" },
      group: { id: "g1", name: "Web" },
      location: "Shanghai",
      charger_name: "ops",
      charger_email: "ops@example.com",
      internal_ips: ["10.0.0.100"],
      external_ips: ["203.0.113.100"],
      first_seen: "2025-01-01",
      last_seen: "2025-06-01",
      last_online_at: "2025-06-01T12:00:00Z",
      last_offline_at: "2025-05-31T12:00:00Z",
      agent_run_mode: "user",
      agent_version: "5.1.5",
      host_type: "physical",
      run_level: "normal",
      client_ip: "10.0.0.1",
    }],
    total: 1,
  });

  const result = await rpcdef(buildCtx())[PATH_LIST_HOSTS]();
  const host = result.hosts[0];

  assert.equal(host.id, "100");
  assert.equal(host.name, "prod-web-01");
  assert.equal(host.main_ip, "10.0.0.100");
  assert.equal(host.agent_id, "agt-100");
  assert.equal(host.os_type, "linux");
  assert.equal(host.os_arch, "x86_64");
  assert.equal(host.os_dist, "Ubuntu");
  assert.equal(host.group_id, "g1");
  assert.equal(host.group_name, "Web");
  assert.deepEqual(host.internal_ips, ["10.0.0.100"]);
  assert.deepEqual(host.external_ips, ["203.0.113.100"]);
  assert.equal(host.host_type, "physical");
  assert.ok(host.raw_json);
});

test("GetHost fetches single host by ID", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ id: "42", name: "db-01", main_ip: "10.0.0.42" });
  };

  const result = await rpcdef(buildCtx({ req: { id: "42" } }))[PATH_GET_HOST]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-asset/service-asset/v1/hosts/42");
  assert.equal(captured.init.method, "GET");
  assert.equal(result.host.id, "42");
  assert.equal(result.host.name, "db-01");
});

test("GetHost validates missing id", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[PATH_GET_HOST](),
    /id is required/,
  );
});

test("CountHosts returns total", async () => {
  globalThis.fetch = async () => okResponse({ total: 42 });
  const result = await rpcdef(buildCtx())[PATH_COUNT_HOSTS]();
  assert.equal(result.total, 42);
});

// -- Agent mapping --

test("ListAgents maps agent fields correctly", async () => {
  globalThis.fetch = async () => okResponse({
    data: [{
      agent_id: "agt-1",
      state: "online",
      run_mode: "user",
      hostname: "web-01",
      ip: "10.0.0.1",
      version: "5.1.5",
      run_level: "normal",
      log_level: "info",
      created_at: "2025-01-01",
      last_online_at: "2025-06-01T12:00:00Z",
      last_offline_at: "2025-05-31T12:00:00Z",
      last_offline_reason: "heartbeat_timeout",
      driver_state: "loaded",
      driver_run_state: "running",
      os_type: "linux",
      os_dist: "Ubuntu",
      os_version: "22.04",
      os_arch: "x86_64",
      mo_id: "mo-1",
      connection_type: "direct",
      connection_host: "10.0.0.1",
      proxy_ip: "",
      license_status: "valid",
      host_type: "physical",
    }],
    total: 1,
  });

  const result = await rpcdef(buildCtx())[PATH_LIST_AGENTS]();
  const agent = result.agents[0];

  assert.equal(agent.agent_id, "agt-1");
  assert.equal(agent.state, "online");
  assert.equal(agent.run_mode, "user");
  assert.equal(agent.hostname, "web-01");
  assert.equal(agent.ip, "10.0.0.1");
  assert.equal(agent.driver_state, "loaded");
  assert.equal(agent.license_status, "valid");
});

test("CountAgents returns total", async () => {
  globalThis.fetch = async () => okResponse({ total: 38 });
  const result = await rpcdef(buildCtx())[PATH_COUNT_AGENTS]();
  assert.equal(result.total, 38);
});

// -- Detection mapping --

test("ListDetections maps detection fields correctly", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({
      total: 1,
      detections: [{
        base_info: {
          detection_id: "det-1",
          detection_code: "DC-1",
          severity: "high",
          status: "pending",
          detection_type: "brute_force",
          detection_type_code: "bf_ssh",
          detection_title: "SSH Brute Force",
          detection_time: "2025-06-01T10:00:00Z",
          last_detection_time: "2025-06-01T12:00:00Z",
          host_ip: "10.0.0.1",
          hostname: "web-01",
          agent_id: "agt-1",
          group_name: "Web",
          dup_count: 3,
        },
        detail_info: {
          handle_suggestion: "Block IP",
          action_desc: "Multiple failed SSH logins",
          detection_response_info: {
            operation_process_element_id: "ep-1",
            operation_file_element_id: "ef-1",
          },
        },
      }],
    });

  };
  const result = await rpcdef(buildCtx({ req: { show_detail: true } }))[PATH_LIST_DETECTIONS]();

  assert.equal(result.total, 1);
  const det = result.detections[0];
  assert.equal(det.detection_id, "det-1");
  assert.equal(det.detection_code, "DC-1");
  assert.equal(det.severity, "high");
  assert.equal(det.detection_title, "SSH Brute Force");
  assert.equal(det.dup_count, 3);
  assert.equal(det.handle_suggestion, "Block IP");
  assert.equal(det.operation_process_element_id, "ep-1");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.show_detail, true);
});

test("GetDetection uses detection_ids and show_detail", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({
      total: 1,
      detections: [{
        base_info: { detection_id: "det-99", detection_code: "DC-99", severity: "critical" },
        detail_info: {},
      }],
    });
  };

  const result = await rpcdef(buildCtx({ req: { detection_id: "det-99" } }))[PATH_GET_DETECTION]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-ids/service-ids/v1/detections");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.query.detection_ids, ["det-99"]);
  assert.equal(body.show_detail, true);
  assert.equal(body.size, 1);
  assert.equal(result.detection.detection_id, "det-99");
});

test("GetDetection uses detection_code when provided", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({
      total: 1,
      detections: [{
        base_info: { detection_id: "det-1", detection_code: "DC-CODE" },
        detail_info: {},
      }],
    });
  };

  const result = await rpcdef(buildCtx({ req: { detection_code: "DC-CODE" } }))[PATH_GET_DETECTION]();
  const body = JSON.parse(captured.init.body);
  assert.equal(body.query.detection_code, "DC-CODE");
  assert.equal(result.detection.detection_code, "DC-CODE");
});

test("GetDetection returns NOT_FOUND when empty", async () => {
  globalThis.fetch = async () => okResponse({ total: 0, detections: [] });
  const { err, payload } = await parseErrorPayload(
    () => rpcdef(buildCtx({ req: { detection_id: "det-0" } }))[PATH_GET_DETECTION](),
  );
  assert.equal(err.code, grpcStatus.NOT_FOUND);
  assert.match(err.message, /detection not found/);
});

test("GetDetection validates missing detection_id and detection_code", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[PATH_GET_DETECTION](),
    /detection_id or detection_code is required/,
  );
});

// -- Response result mapping --

test("ListResponseResults maps response fields", async () => {
  globalThis.fetch = async () => okResponse({
    total: 1,
    data: [{
      result_id: "res-1",
      element_id: "elem-1",
      element_type: "process",
      agent_id: "agt-1",
      host_id: "1",
      host_ip: "10.0.0.1",
      hostname: "web-01",
      group_name: "Web",
      operation_method: "kill",
      operation_type: "process_kill",
      operation_status: "success",
      operator: "admin",
      reason: "",
      error: "",
      create_time: "2025-06-01",
      detection_code: "DC-1",
      detection_id: "det-1",
      source: "manual",
    }],
  });

  const result = await rpcdef(buildCtx())[PATH_LIST_RESPONSE_RESULTS]();

  assert.equal(result.total, 1);
  const r = result.results[0];
  assert.equal(r.result_id, "res-1");
  assert.equal(r.element_type, "process");
  assert.equal(r.operation_method, "kill");
  assert.equal(r.operation_status, "success");
});

test("ListResponseHistory returns history items", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ total: 1, data: [{ result_id: "h-1", element_id: "e-1" }] });
  };

  const result = await rpcdef(buildCtx())[PATH_LIST_RESPONSE_HISTORY]();
  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-ids/service-ids/v1/elements/operation/history");
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].result_id, "h-1");
});

test("GetElementOperationInfos sends element_ids and element_type", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ total: 1, data: [{ result_id: "info-1" }] });
  };

  const result = await rpcdef(buildCtx({ req: { element_ids: ["e-1", "e-2"], element_type: "process", show_detail: true } }))[PATH_GET_ELEMENT_OPERATION_INFOS]();

  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.element_ids, ["e-1", "e-2"]);
  assert.equal(body.element_type, "process");
  assert.equal(body.show_detail, true);
  assert.equal(result.infos.length, 1);
});

// -- Baseline mapping --

test("ListBaselines maps baseline fields", async () => {
  globalThis.fetch = async () => okResponse({
    total: 1,
    data: [{
      uuid: "bl-1",
      name: "CIS Benchmark",
      category_id: "cat-1",
      category: "Linux",
      cpu_arch: "x86_64",
      active: true,
      created_at: "2025-01-01",
      updated_at: "2025-06-01",
      check_item_ids: ["chk-1", "chk-2"],
    }],
  });

  const result = await rpcdef(buildCtx())[PATH_LIST_BASELINES]();
  const bl = result.baselines[0];

  assert.equal(bl.uuid, "bl-1");
  assert.equal(bl.name, "CIS Benchmark");
  assert.equal(bl.category, "Linux");
  assert.equal(bl.active, true);
  assert.deepEqual(bl.check_item_ids, ["chk-1", "chk-2"]);
});

test("GetBaseline fetches by baseline_id", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ uuid: "bl-42", name: "Custom BL" });
  };

  const result = await rpcdef(buildCtx({ req: { baseline_id: "bl-42" } }))[PATH_GET_BASELINE]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-baseline/service-baseline/v1/baselines/bl-42");
  assert.equal(captured.init.method, "GET");
  assert.equal(result.baseline.uuid, "bl-42");
});

test("GetBaseline validates missing baseline_id", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[PATH_GET_BASELINE](),
    /baseline_id is required/,
  );
});

// -- Baseline task mapping --

test("ListBaselineTasks maps task fields", async () => {
  globalThis.fetch = async () => okResponse({
    baseline_task: [{
      task_id: "task-1",
      name: "Monthly Scan",
      baseline_name: ["CIS Benchmark"],
      passed: 0.85,
      last_executed_at: "2025-06-01",
      next_executed_at: "2025-07-01",
      created_at: "2025-01-01",
      is_executing: false,
      cron: "0 0 1 * *",
      editable: true,
    }],
  });

  const result = await rpcdef(buildCtx())[PATH_LIST_BASELINE_TASKS]();
  const task = result.tasks[0];

  assert.equal(task.task_id, "task-1");
  assert.equal(task.name, "Monthly Scan");
  assert.deepEqual(task.baseline_name, ["CIS Benchmark"]);
  assert.equal(task.passed, 0.85);
  assert.equal(task.is_executing, false);
});

test("GetBaselineTaskStatus fetches by task_id", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({
      task_status: [{
        task_id: "task-1",
        is_executing: false,
        last_executed_at: "2025-06-01",
        passed: 0.85,
        task_status: "completed",
        task_status_description_key: "done",
        last_execute_record_id: "rec-1",
      }],
    });
  };

  const result = await rpcdef(buildCtx({ req: { task_id: "task-1" } }))[PATH_GET_BASELINE_TASK_STATUS]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-baseline/service-baseline/v1/tasks/task-1/status");
  assert.equal(captured.init.method, "GET");
  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].task_status, "completed");
  assert.equal(result.statuses[0].passed, 0.85);
});

test("GetBaselineTaskStatus validates missing task_id", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: {} }))[PATH_GET_BASELINE_TASK_STATUS](),
    /task_id is required/,
  );
});

test("ListBaselineTaskResults maps result fields", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({
      results: [{
        uuid: "res-uuid-1",
        task_id: "task-1",
        baseline_id: "bl-1",
        execute_record_id: "rec-1",
        agent_id: "agt-1",
        check_id: "chk-1",
        code: 1,
        flag: 0,
        error: "",
        data: "pass",
        check_object_id: "obj-1",
        created_at: "2025-06-01",
      }],
    });
  };

  const result = await rpcdef(buildCtx({ req: { task_id: "task-1", baseline_id: "bl-1" } }))[PATH_LIST_BASELINE_TASK_RESULTS]();

  assert.equal(captured.url, "https://hids.example.com/oapi/com-qt-app-baseline/service-baseline/v1/tasks/task-1/results/bl-1/list");
  assert.equal(captured.init.method, "POST");
  assert.equal(result.results.length, 1);
  const r = result.results[0];
  assert.equal(r.uuid, "res-uuid-1");
  assert.equal(r.check_id, "chk-1");
  assert.equal(r.code, 1);
  assert.equal(r.flag, 0);
});

test("ListBaselineTaskResults validates missing task_id and baseline_id", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { baseline_id: "bl-1" } }))[PATH_LIST_BASELINE_TASK_RESULTS](),
    /task_id is required/,
  );
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { task_id: "task-1" } }))[PATH_LIST_BASELINE_TASK_RESULTS](),
    /baseline_id is required/,
  );
});

// -- Error handling --

test("HTTP and network failures map to correct gRPC codes", async () => {
  const cases = [
    [401, grpcStatus.PERMISSION_DENIED, "PERMISSION_DENIED"],
    [403, grpcStatus.PERMISSION_DENIED, "PERMISSION_DENIED"],
    [404, grpcStatus.NOT_FOUND, "NOT_FOUND"],
    [500, grpcStatus.UNAVAILABLE, "UNAVAILABLE"],
    [503, grpcStatus.UNAVAILABLE, "UNAVAILABLE"],
  ];

  for (const [status, grpcCode, legacyCode] of cases) {
    globalThis.fetch = async () => responseWithStatus(status, JSON.stringify({ error: "test" }));
    const { err, payload } = await parseErrorPayload(() => rpcdef(buildCtx())[PATH_LIST_HOSTS]());
    assert.equal(err.code, grpcCode, `expected ${legacyCode} for HTTP ${status}`);
    assert.equal(payload.http_status, status);
    assert.equal(payload.reason, "http_status_not_ok");
  }

  globalThis.fetch = async () => {
    throw Object.assign(new Error("network error"), { cause: new Error("socket hangup") });
  };
  const network = await parseErrorPayload(() => rpcdef(buildCtx())[PATH_LIST_HOSTS]());
  assert.equal(network.err.code, grpcStatus.UNAVAILABLE);
  assert.equal(network.payload.http_status, 0);
  assert.equal(network.payload.reason, "socket hangup");
});

test("Non-JSON response returns UNKNOWN with raw_body", async () => {
  globalThis.fetch = async () => okResponse("not-json-at-all");
  const { payload } = await parseErrorPayload(() => rpcdef(buildCtx())[PATH_LIST_HOSTS]());
  assert.equal(payload.code, "UNKNOWN");
  assert.equal(payload.reason, "invalid_json");
  assert.equal(payload.raw_body, "not-json-at-all");
});

// -- Raw query merge --

test("raw_query_json merges into query body", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [], total: 0 });
  };

  await rpcdef(buildCtx({
    req: {
      query: {
        raw_query_json: '{"custom_field": "custom_value"}',
        name_like: "web",
      },
    },
  }))[PATH_LIST_HOSTS]();

  const body = JSON.parse(captured.init.body);
  assert.equal(body.query.custom_field, "custom_value");
  assert.equal(body.query.name_like, "web");
});

test("raw_query_json rejects invalid JSON", async () => {
  await assert.rejects(
    () => rpcdef(buildCtx({ req: { query: { raw_query_json: "not-json" } } }))[PATH_LIST_HOSTS](),
    /raw_query_json must be a JSON object/,
  );
});

test("raw_query Struct merges into query body", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [], total: 0 });
  };

  await rpcdef(buildCtx({
    req: {
      query: {
        raw_query: {
          fields: {
            extra: { stringValue: "hello" },
            num: { numberValue: 42 },
          },
        },
      },
    },
  }))[PATH_LIST_HOSTS]();

  const body = JSON.parse(captured.init.body);
  assert.equal(body.query.extra, "hello");
  assert.equal(body.query.num, 42);
});

// -- Handler coverage --

test("handlers expose all 15 methods", () => {
  const expectedMethods = [
    METHOD_LIST_HOSTS,
    METHOD_GET_HOST,
    METHOD_COUNT_HOSTS,
    METHOD_LIST_AGENTS,
    METHOD_COUNT_AGENTS,
    METHOD_LIST_DETECTIONS,
    METHOD_GET_DETECTION,
    METHOD_LIST_RESPONSE_RESULTS,
    METHOD_LIST_RESPONSE_HISTORY,
    METHOD_GET_ELEMENT_OPERATION_INFOS,
    METHOD_LIST_BASELINES,
    METHOD_GET_BASELINE,
    METHOD_LIST_BASELINE_TASKS,
    METHOD_GET_BASELINE_TASK_STATUS,
    METHOD_LIST_BASELINE_TASK_RESULTS,
  ];

  const handlerKeys = Object.keys(handlers).sort();
  assert.deepEqual(handlerKeys, expectedMethods.sort());
  assert.ok(service);
});

// -- SDK handler integration (config+secret merge) --

test("SDK handlers merge config and secret correctly", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return okResponse({ data: [{ id: "1", name: "h-1" }], total: 1 });
  };

  const result = await handlers[METHOD_LIST_HOSTS]({
    config: {
      baseUrl: "https://config-hids.example.com/",
      timeoutMs: 5000,
      verifyTLS: false,
    },
    secret: {
      token: "secret-token",
    },
    req: {},
  });

  assert.equal(result.hosts.length, 1);
  assert.equal(captured.url, "https://config-hids.example.com/oapi/com-qt-app-asset/service-asset/v1/hosts/list");
  assert.equal(captured.init.headers.Authorization, "Bearer secret-token");
  assert.equal(captured.init.timeoutMs, 5000);
  assert.equal(captured.init.skipTlsVerify, true);
});

// -- Helper function tests --

test("helper functions keep edge behavior stable", () => {
  // normalizeBaseUrl
  assert.equal(_test.normalizeBaseUrl("https://host///"), "https://host");
  assert.equal(_test.normalizeBaseUrl("ftp://host"), "");
  assert.equal(_test.normalizeBaseUrl("http://hids.local:8080/"), "http://hids.local:8080");

  // resolveBaseUrl
  assert.equal(_test.resolveBaseUrl({ baseUrl: "https://a" }), "https://a");
  assert.equal(_test.resolveBaseUrl({ base_url: "https://b" }), "https://b");
  assert.equal(_test.resolveBaseUrl({ host: "https://c" }), "https://c");
  assert.equal(_test.resolveBaseUrl({ endpoint: "https://d" }), "https://d");
  assert.equal(_test.resolveBaseUrl({}), "");

  // resolveTimeoutMs
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeoutMs: 5000 } }), 5000);
  assert.equal(_test.resolveTimeoutMs({ limits: { timeoutMs: 3000 }, bindings: {} }), 3000);

  // buildTlsOptions
  assert.deepEqual(_test.buildTlsOptions({ verifyTLS: false }), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions({ skipTlsVerify: true }), {
    skipTlsVerify: true,
    tlsInsecureSkipVerify: true,
    insecureSkipVerify: true,
  });
  assert.deepEqual(_test.buildTlsOptions({}), {});

  // classifyHttpStatus
  assert.equal(_test.classifyHttpStatus(401), "PERMISSION_DENIED");
  assert.equal(_test.classifyHttpStatus(403), "PERMISSION_DENIED");
  assert.equal(_test.classifyHttpStatus(404), "NOT_FOUND");
  assert.equal(_test.classifyHttpStatus(500), "UNAVAILABLE");
  assert.equal(_test.classifyHttpStatus(502), "UNAVAILABLE");
  assert.equal(_test.classifyHttpStatus(400), "UNKNOWN");

  // joinUrl
  assert.equal(_test.joinUrl("https://h", "a", "b"), "https://h/a/b");
  assert.equal(_test.joinUrl("", "/v1/hosts", "42"), "/v1/hosts/42");
  assert.equal(_test.joinUrl("", "/v1/tasks", "t1", "results", "b1", "list"), "/v1/tasks/t1/results/b1/list");

  // parseJsonSafe
  assert.deepEqual(_test.parseJsonSafe('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(_test.parseJsonSafe("bad"), { ok: false, value: null });

  // toValue
  assert.deepEqual(_test.toValue(undefined), undefined);
  assert.deepEqual(_test.toValue(null), { nullValue: "NULL_VALUE" });
  assert.deepEqual(_test.toValue("hello"), { stringValue: "hello" });
  assert.deepEqual(_test.toValue(42), { numberValue: 42 });
  assert.deepEqual(_test.toValue(true), { boolValue: true });
  assert.deepEqual(_test.toValue([1, "a"]).listValue.values, [
    { numberValue: 1 },
    { stringValue: "a" },
  ]);

  // fromStruct
  assert.deepEqual(_test.fromStruct({ fields: { x: { stringValue: "hi" } } }), { x: "hi" });
  assert.deepEqual(_test.fromStruct(null), {});
  assert.deepEqual(_test.fromStruct({ plain: 1 }), { plain: 1 });

  // requestBody
  assert.deepEqual(_test.requestBody({ page: { page: 2, size: 10 } }, { q: 1 }), {
    page: 2,
    size: 10,
    sort: [],
    query: { q: 1 },
  });
});

// -- Query body builders --

test("hostQueryBody maps known fields", () => {
  const result = _test.hostQueryBody({ name_like: "web", ip_like: "10.0", os_types: ["linux", "windows"] });
  assert.equal(result.name_like, "web");
  assert.equal(result.ip_like, "10.0");
  assert.deepEqual(result.os_types, ["linux", "windows"]);
});

test("detectionQueryBody maps time and severity fields", () => {
  const result = _test.detectionQueryBody({
    start_time: 1700000000,
    end_time: 1700100000,
    severities: ["high", "critical"],
    agent_id: "agt-1",
  });
  assert.equal(result.start_time, 1700000000);
  assert.equal(result.end_time, 1700100000);
  assert.deepEqual(result.severities, ["high", "critical"]);
  assert.equal(result.agent_id, "agt-1");
});

test("mergeRawQuery validates non-object JSON", () => {
  assert.throws(
    () => _test.mergeRawQuery({ raw_query_json: '"just a string"' }),
    /raw_query_json must be a JSON object/,
  );
  assert.throws(
    () => _test.mergeRawQuery({ raw_query_json: "[1,2,3]" }),
    /raw_query_json must be a JSON object/,
  );
});

// -- Map function spot checks --

test("mapHost handles empty input", () => {
  const host = _test.mapHost({});
  assert.equal(host.id, "");
  assert.equal(host.name, "");
  assert.ok(host.raw_json);
});

test("mapDetection handles empty input", () => {
  const det = _test.mapDetection({});
  assert.equal(det.detection_id, "");
  assert.equal(det.severity, "");
  assert.ok(det.raw_json);
});

test("mapBaselineTask handles empty input", () => {
  const task = _test.mapBaselineTask({});
  assert.equal(task.task_id, "");
  assert.equal(task.passed, 0);
  assert.equal(task.is_executing, false);
});

test("mapBaselineTaskResult handles empty input", () => {
  const r = _test.mapBaselineTaskResult({});
  assert.equal(r.uuid, "");
  assert.equal(r.code, 0);
  assert.equal(r.flag, 0);
});

test("mapResponseResult handles empty input", () => {
  const r = _test.mapResponseResult({});
  assert.equal(r.result_id, "");
  assert.equal(r.operation_method, "");
});

test("mapAgent handles empty input", () => {
  const a = _test.mapAgent({});
  assert.equal(a.agent_id, "");
  assert.equal(a.state, "");
});

test("mapBaseline handles empty input", () => {
  const bl = _test.mapBaseline({});
  assert.equal(bl.uuid, "");
  assert.equal(bl.active, false);
});

test("mapBaselineTaskStatus handles empty input", () => {
  const s = _test.mapBaselineTaskStatus({});
  assert.equal(s.task_id, "");
  assert.equal(s.is_executing, false);
  assert.equal(s.passed, 0);
});
