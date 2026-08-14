import assert from "node:assert/strict";
import test from "node:test";
import { grpcStatus } from "@chaitin-ai/octobus-sdk";

import { handlers, internals } from "../src/t-answer-ndr.js";
import { service } from "../src/service.js";

const ctx = (request = {}, config = {}) => ({
  request,
  config: {
    endpoint: "https://answer.example",
    timeoutMs: 1000,
    ...config,
  },
  secret: {
    apiToken: "test-token",
    webUsername: "test-user",
    webPassword: "password",
  },
});

test("service exposes every proto handler and each handler executes production routing", async () => {
  assert.ok(service);
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const body = options.body && typeof options.body === "string" ? JSON.parse(options.body) : {};
      const isLogin = body.method === "HeraAccountNoAuthService.Login";
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? "ok",
        result: isLogin ? { ok: true } : { data: [], total: 0, id: "upload-1", file_id: "upload-1" },
      }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "sid=test; Path=/; HttpOnly", "content-disposition": "attachment; filename=result.json" } });
    };

    const request = {
      rawParamsJson: "{\"value\":1}", raw_params_json: "{\"value\":1}",
      id: 1, ids: [1], action: "delete", docId: "doc-1", doc_id: "doc-1",
      keyword: "needle", name: "name", ip: "192.0.2.1", role: "attacker",
      timeRangeStart: 1, timeRangeEnd: 2, days: 1, count: 1, offset: 0,
      query: "x=1", queryJson: "{\"x\":1}",
      pcapFiles: [{ fileName: "sample.pcap", contentBase64: "AA==" }],
      files: [{ id: "upload-1", fileName: "sample.pcap" }], detectPattern: 1,
      waitForCompletion: false,
    };
    for (const [name, handler] of Object.entries(handlers)) {
      const result = await handler(ctx(request));
      assert.equal(typeof result, "object", name);
    }
    assert.equal(Object.keys(handlers).length, 76);
    assert.ok(calls.length >= Object.keys(handlers).length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("protobuf values and request builders cover scalar, list, struct and boundary forms", () => {
  assert.equal(internals.fromValue(undefined), undefined);
  assert.equal(internals.fromValue(null), null);
  assert.deepEqual(internals.fromValue([1, { stringValue: "x" }]), [1, "x"]);
  assert.equal(internals.fromValue({ nullValue: 0 }), null);
  assert.equal(internals.fromValue({ numberValue: 2 }), 2);
  assert.equal(internals.fromValue({ boolValue: true }), true);
  assert.deepEqual(internals.fromValue({ listValue: { values: [{ stringValue: "x" }] } }), ["x"]);
  assert.deepEqual(internals.fromValue({ structValue: { fields: { n: { numberValue: 3 } } } }), { n: 3 });
  assert.deepEqual(internals.fromValue({ fields: { ok: { boolValue: true } } }), { ok: true });
  assert.deepEqual(internals.fromValue({ nested: { stringValue: "yes" } }), { nested: "yes" });

  const aliases = {
    time_range_start: 1, time_range_end: 2, offset: 0, count: 5,
    src_ip: [{ oper: "=", target: "1.1.1.1" }], dest_ip: [{ oper: "=", target: "2.2.2.2" }],
    attacker: [{ oper: "=", target: "a" }], victim: [{ oper: "=", target: "v" }],
    severity: [{ oper: "=", target: "high" }], result: [{ oper: "=", target: "blocked" }],
    keyword: [{ oper: "=", target: "k" }], name: [{ oper: "=", target: "n" }], tag: [{ oper: "=", target: "t" }],
    sort: [{ field: "time", ascending: false }], raw_params_json: "{\"extra\":true}",
  };
  const alert = internals.buildListAlertsParams(aliases);
  assert.equal(alert.extra, true);
  assert.equal(alert.offset, 0);

  assert.deepEqual(internals.fromValue({ listValue: {} }), []);
  assert.deepEqual(internals.fromValue({ fields: {} }), {});
  assert.equal(internals.normalizeDurationMs(-1, 5, 10, 20), 5);
  assert.equal(internals.normalizeDurationMs(999, 5, 10, 20), 20);
  assert.equal(internals.normalizeDurationMs(15, 5, 10, 20), 15);
  assert.deepEqual(internals.buildIdsParams({ ids: [1, 2] }), { ids: [1, 2] });
  assert.deepEqual(internals.buildIdsActionParams({ ids: [1], action: "delete" }), { ids: [1], action: "delete" });
});

test("configuration, JSON-RPC and web-session failures retain typed sanitized errors", async () => {
  const listAssets = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets"];
  await assert.rejects(() => listAssets({ request: {}, config: {}, secret: { apiToken: "x" } }), /endpoint/);
  await assert.rejects(() => listAssets({ request: {}, config: { endpoint: "https://answer.example" }, secret: {} }), /apiToken/);

  const originalFetch = globalThis.fetch;
  try {
    for (const error of [
      { code: 1, message: "未登录" },
      { code: 2, message: "forbidden" },
      { code: -32602, message: "invalid argument" },
      { code: 99, message: "business failure" },
      "bad error",
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error }), { status: 200 });
      await assert.rejects(() => listAssets(ctx({ count: 1 })));
    }

    globalThis.fetch = async () => new Response("not-json", { status: 200 });
    await assert.rejects(() => listAssets(ctx({ count: 1 })), /non-JSON/);
    globalThis.fetch = async () => { throw new Error("secret network detail"); };
    await assert.rejects(() => listAssets(ctx({ count: 1 })), /request failed/);

    const web = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CountAlerts"];
    await assert.rejects(() => web({ request: {}, config: { endpoint: "https://answer.example" }, secret: { apiToken: "x" } }), /webUsername/);
    globalThis.fetch = async () => new Response(JSON.stringify({ result: {} }), { status: 200 });
    await assert.rejects(() => web(ctx({})), /session cookie/);
    globalThis.fetch = async () => { throw new Error("login network"); };
    await assert.rejects(() => web(ctx({})), /web login request failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proto validation rejects malformed ids, documents, raw params and pcap inputs", async () => {
  const invalid = [
    ["GetAlert", {}], ["GetAsset", { id: 0 }], ["StartTcpdumpProcess", { id: -1 }],
    ["DeleteCustomRule", { ids: [] }], ["DeleteAlarmWhiteList", { ids: [0, -1] }],
    ["UploadPcapDetectFiles", {}],
    ["UploadPcapDetectFiles", { pcapFiles: [{ contentBase64: "AA==" }] }],
    ["UploadPcapDetectFiles", { pcapFiles: [{ fileName: "x.pcap" }] }],
    ["UploadPcapDetectFiles", { pcapFiles: [{ fileName: "x.pcap", contentBase64: "" }] }],
    ["CreatePcapDetectTask", { files: [{ fileName: "x" }] }],
    ["CreatePcapDetectTask", { files: [{ id: "x" }] }],
  ];
  for (const [method, request] of invalid) {
    await assert.rejects(Promise.resolve().then(() => handlers[`chaitin.t_answer_ndr.v1.TAnswerNdrService/${method}`](ctx(request))), undefined, method);
  }
  for (const rawParamsJson of ["null", "1", "broken"] ) {
    await assert.rejects(Promise.resolve().then(() => handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListBlockRules"](ctx({ rawParamsJson }))));
  }
});

test("traffic and download RPCs cover protocol and HTTP error boundaries", async () => {
  const traffic = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchTrafficLogs"];
  await assert.rejects(Promise.resolve().then(() => traffic(ctx({ protocol: "invalid" }))), /protocol/);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ result: { total: 0 } }), { status: 200 });
    assert.ok(await traffic(ctx({ protocol: "http" })));
    assert.ok(await traffic(ctx({ protocol: "all" })));

    const download = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/DownloadFile"];
    await assert.rejects(Promise.resolve().then(() => download(ctx({ query: "x" }))), /id is required/);
    await assert.rejects(Promise.resolve().then(() => download(ctx({ id: "x" }))), /query/);
    for (const status of [401, 403, 500, 400]) {
      globalThis.fetch = async () => new Response("error", { status });
      await assert.rejects(() => download(ctx({ id: "x", queryJson: "{}" })));
    }
    globalThis.fetch = async () => { throw Object.assign(new Error("abort"), { name: "AbortError" }); };
    await assert.rejects(() => download(ctx({ id: "x", query: "q" })), /timeout/);
    globalThis.fetch = async () => { throw new Error("network"); };
    await assert.rejects(() => download(ctx({ id: "x", query: "q" })), /request failed/);
    globalThis.fetch = async () => new Response("too large", { status: 200 });
    await assert.rejects(() => download(ctx({ id: "x", query: "q" }, { maxDownloadBytes: 2 })), /exceeds/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transport aborts and full pcap orchestration remain bounded", async () => {
  const originalFetch = globalThis.fetch;
  const list = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets"];
  try {
    globalThis.fetch = async () => { throw Object.assign(new Error("abort"), { name: "AbortError" }); };
    await assert.rejects(() => list(ctx({ count: 1 })), /timeout/);

    const analyze = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/AnalyzePcapFiles"];
    let step = 0;
    globalThis.fetch = async (_url, options = {}) => {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
      step += 1;
      if (step === 1) return new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "set-cookie": "sid=x; Path=/" } });
      if (step === 2) return new Response(JSON.stringify({ result: { files: [{ id: "f", file_name: "x.pcap" }] } }), { status: 200 });
      if (step === 3) return new Response(JSON.stringify({ result: { pcap_detect_tasks: [{ pcap_detect_task_id: 9 }] } }), { status: 200 });
      return new Response(JSON.stringify({ result: { data: [], method: body.method } }), { status: 200 });
    };
    const result = JSON.parse((await analyze(ctx({ pcapFiles: [{ fileName: "x.pcap", contentBase64: "AA==" }], detectPattern: 0, waitForCompletion: false }))).resultJson);
    assert.equal(result.alerts[0].taskId, 9);

    const upload = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/UploadPcapDetectFiles"];
    step = 0;
    globalThis.fetch = async () => {
      step += 1;
      if (step === 1) return new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "set-cookie": "sid=x" } });
      throw Object.assign(new Error("abort"), { name: "AbortError" });
    };
    await assert.rejects(() => upload(ctx({ pcapFiles: [{ fileName: "x", contentBase64: "AA==" }] })), /upload timeout/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web transport maps login and authenticated RPC aborts", async () => {
  const originalFetch = globalThis.fetch;
  const web = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CountAlerts"];
  try {
    globalThis.fetch = async () => { throw Object.assign(new Error("abort"), { name: "AbortError" }); };
    await assert.rejects(() => web(ctx({})), /login timeout/);
    let step = 0;
    globalThis.fetch = async () => {
      step += 1;
      if (step === 1) return new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "set-cookie": "sid=x" } });
      throw Object.assign(new Error("abort"), { name: "AbortError" });
    };
    await assert.rejects(() => web(ctx({})), /web JSON-RPC timeout/);
    step = 0;
    globalThis.fetch = async () => {
      step += 1;
      if (step === 1) return new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "set-cookie": "sid=x" } });
      throw new Error("network");
    };
    await assert.rejects(() => web(ctx({})), /web JSON-RPC request failed/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 99 } }), { status: 200, headers: { "set-cookie": "sid=x" } });
    await assert.rejects(() => web(ctx({})));
    globalThis.fetch = async () => new Response("broken", { status: 200, headers: { "set-cookie": "sid=x" } });
    await assert.rejects(() => web(ctx({})), /non-JSON/);
    step = 0;
    globalThis.fetch = async () => {
      step += 1;
      return step === 1
        ? new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "set-cookie": "sid=x" } })
        : new Response(JSON.stringify({ error: { code: 99 } }), { status: 200 });
    };
    await assert.rejects(() => web(ctx({})));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("builders tolerate absent and alternate proto values", () => {
  assert.deepEqual(internals.buildRawParams({}), {});
  assert.deepEqual(internals.buildListAssetsParams({ offset: -1, count: 0, tagId: { stringValue: "tag" }, groupId: 2, assetType: "server" }), { group_id: 2, asset_type: "server", tag_id: "tag" });
  assert.deepEqual(internals.buildDiscoveredAssetsParams({ offset: 0, count: 2, groupId: 3, importance: 1, port: 443, timeStart: 1, timeEnd: 2, ipAddr: "1.1.1.1", mac: "m", name: "n", os: "linux", assetType: "server", service: "https", tagId: [1] }), { offset: 0, count: 2, group_id: 3, importance: 1, port: 443, time_start: 1, time_end: 2, ip_addr: "1.1.1.1", mac: "m", name: "n", os: "linux", asset_type: "server", service: "https", tag_id: [1] });
  const fallback = internals.buildTimeRange({ days: 2, timeRangeEnd: 1000000000 });
  assert.equal(fallback.time_range_end, 1000000000);
  assert.equal(internals.buildScenarioAlertParams({ attackName: "attack", attackerIp: "1", victimIp: "2", severity: "3", result: "blocked" }).name[0].target, "attack");
  assert.equal(internals.buildTrafficLogParams({ srcIp: "1", destIp: "2", query: "x" }).keyword[0], "x");
});

test("IP analysis covers victim, any-role raw logs and partial upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  let failNext = false;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      if (failNext) { failNext = false; throw new Error("temporary"); }
      const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
      return new Response(JSON.stringify({ result: { data: [{ src_ip: "1.1.1.1", dest_ip: "2.2.2.2", name: "attack", doc_count: 2 }], total: 1 } }), { status: 200, headers: { "set-cookie": "sid=x; Path=/" } });
    };
    const analyze = handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/AnalyzeIpActivity"];
    const victim = JSON.parse((await analyze(ctx({ ip: "2.2.2.2", role: "victim" }))).resultJson);
    assert.ok(victim.alerts_as_victim);
    const any = JSON.parse((await analyze(ctx({ ip: "1.1.1.1", role: "any", includeRawLogs: true }))).resultJson);
    assert.ok(any.raw_logs.http_src);
    failNext = true;
    const partial = JSON.parse((await analyze(ctx({ ip: "1.1.1.1", role: "other" }))).resultJson);
    assert.equal(partial.asset.ok, false);
    await assert.rejects(Promise.resolve().then(() => analyze(ctx({ role: "any" }))), /ip is required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skipTlsVerify is passed as request-scoped runtime options", async () => {
  const originalFetch = globalThis.fetch;
  const originalTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    let options;
    globalThis.fetch = async (_url, requestOptions) => {
      options = requestOptions;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { total: 0, data: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets"](
      ctx({ count: 1 }, { skipTlsVerify: true }),
    );

    assert.ok(options.dispatcher);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalTlsEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildListAlertsParams maps common filters and raw params", () => {
  const params = internals.buildListAlertsParams({
    timeRangeStart: 1700000000000,
    timeRangeEnd: 1700003600000,
    count: 20,
    offset: 0,
    srcIp: [{ oper: "=", target: "1.1.1.1" }],
    severity: [{ oper: "=", target: "1" }],
    rawParamsJson: "{\"read\":0}",
  });

  assert.equal(params.time_range_start, 1700000000000);
  assert.equal(params.time_range_end, 1700003600000);
  assert.equal(params.count, 20);
  assert.deepEqual(params.src_ip, [{ oper: "=", target: "1.1.1.1" }]);
  assert.deepEqual(params.severity, [{ oper: "=", target: "1" }]);
  assert.equal(params.read, 0);
});

test("ListAssets sends API-Token and JSON-RPC body", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "ok",
          result: { total: 1, data: [{ id: 1, ip: "192.0.2.10" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets"](
      ctx({ count: 10, ip: "192.0.2.10" }),
    );

    assert.equal(captured.url, "https://answer.example/rpc");
    assert.equal(captured.options.headers["API-Token"], "test-token");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.method, "AssetService.GetAssetList");
    assert.deepEqual(body.params, { count: 10, ip: "192.0.2.10" });
    assert.deepEqual(JSON.parse(result.resultJson), { total: 1, data: [{ id: 1, ip: "192.0.2.10" }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSON-RPC parameter error maps to INVALID_ARGUMENT", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "bad",
          error: { code: -32000, message: "FieldName:TimeRangeStart 为必填项" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    await assert.rejects(
      () => handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAlerts"](ctx({ count: 10 })),
      /TimeRangeStart/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-JSON HTTP failures map status before response parsing", async (t) => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { status: 401, code: grpcStatus.UNAUTHENTICATED, message: /rejected API token/ },
    { status: 403, code: grpcStatus.PERMISSION_DENIED, message: /permission denied/ },
    { status: 500, code: grpcStatus.UNAVAILABLE, message: /upstream HTTP 500/ },
  ];

  try {
    for (const item of cases) {
      await t.test(`HTTP ${item.status}`, async () => {
        globalThis.fetch = async () =>
          new Response("<html>upstream error</html>", {
            status: item.status,
            headers: { "content-type": "text/html" },
          });

        await assert.rejects(
          () => handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListAssets"](ctx({ count: 1 })),
          (error) => {
            assert.equal(error.code, item.code);
            assert.match(error.message, item.message);
            return true;
          },
        );
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("raw JSON methods pass params through to the selected upstream method", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateBlockRules"](
      ctx({ rawParamsJson: "{\"rules\":[{\"ip\":\"203.0.113.10\"}],\"status\":1}" }),
    );

    const body = JSON.parse(captured.options.body);
    assert.equal(body.method, "RulesService.CreateBlockRules");
    assert.deepEqual(body.params, { rules: [{ ip: "203.0.113.10" }], status: 1 });
    assert.deepEqual(JSON.parse(result.resultJson), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("write methods forward without service-side approval gate", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let body;
    globalThis.fetch = async (url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CreateBlockRules"](
      ctx({ rawParamsJson: "{\"rules\":[{\"ip\":\"203.0.113.10\"}]}" }),
    );

    assert.equal(body.method, "RulesService.CreateBlockRules");
    assert.deepEqual(body.params, { rules: [{ ip: "203.0.113.10" }] });
    assert.deepEqual(JSON.parse(result.resultJson), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("raw array params are forwarded for positional JSON-RPC methods", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let body;
    globalThis.fetch = async (url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/UpdateCustomIntelligence"](
      ctx({ rawParamsJson: "[{\"id\":1,\"status\":1}]" }),
    );

    assert.equal(body.method, "AlarmService.UpdateAlarmCustomIntelligence");
    assert.deepEqual(body.params, [{ id: 1, status: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ids action methods build convenience params and allow raw overrides", async () => {
  const params = internals.buildIdsActionParams({
    ids: [1, 2],
    action: "hide",
    rawParamsJson: "{\"reason\":\"maintenance\"}",
  });

  assert.deepEqual(params, { ids: [1, 2], action: "hide", reason: "maintenance" });
});

test("UploadPcapDetectFiles logs in and uploads multipart pcap with session cookie", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (String(url).endsWith("/rpc")) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-1; Path=/; HttpOnly" },
        });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { files: [{ id: "file-1", file_name: "sample.pcap" }], err_msg: "" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/UploadPcapDetectFiles"](
      ctx({
        pcapFiles: [{ fileName: "sample.pcap", contentBase64: Buffer.from("pcap").toString("base64") }],
      }),
    );

    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].options.body).method, "HeraAccountNoAuthService.Login");
    assert.equal(
      calls[1].url,
      "https://answer.example/api/upload?id=PcapDetectUploadService.UploadPcapDetectFiles",
    );
    assert.equal(calls[1].options.headers.cookie, "sessionid=session-1");
    assert.deepEqual(JSON.parse(result.resultJson), {
      files: [{ id: "file-1", file_name: "sample.pcap" }],
      err_msg: "",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CreatePcapDetectTask uses web session JSON-RPC", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-2; Path=/; HttpOnly" },
        });
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { pcap_detect_tasks: [{ pcap_detect_task_id: 9 }] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CreatePcapDetectTask"](
      ctx({
        files: [{ id: "file-1", fileName: "sample.pcap" }],
        detectPattern: 2,
      }),
    );

    const body = JSON.parse(calls[1].options.body);
    assert.equal(calls[1].options.headers.cookie, "sessionid=session-2");
    assert.equal(body.method, "PcapDetectService.CreatePcapDetectTask");
    assert.deepEqual(body.params, { files: [{ id: "file-1", file_name: "sample.pcap" }], detect_pattern: 2 });
    assert.deepEqual(JSON.parse(result.resultJson), { pcap_detect_tasks: [{ pcap_detect_task_id: 9 }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web-session HTTP failures map status before response parsing", async (t) => {
  const originalFetch = globalThis.fetch;
  const taskRequest = {
    files: [{ id: "file-1", fileName: "sample.pcap" }],
    detectPattern: 2,
  };

  const assertUnavailable = async (operation, message) => {
    await assert.rejects(operation, (error) => {
      assert.equal(error.code, grpcStatus.UNAVAILABLE);
      assert.match(error.message, message);
      return true;
    });
  };

  try {
    await t.test("web login", async () => {
      globalThis.fetch = async () =>
        new Response("<html>login unavailable</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        });

      await assertUnavailable(
        () => handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CreatePcapDetectTask"](ctx(taskRequest)),
        /web login HTTP 502/,
      );
    });

    await t.test("web JSON-RPC", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
            status: 200,
            headers: { "set-cookie": "sessionid=session-error; Path=/; HttpOnly" },
          });
        }
        return new Response("<html>RPC unavailable</html>", {
          status: 503,
          headers: { "content-type": "text/html" },
        });
      };

      await assertUnavailable(
        () => handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CreatePcapDetectTask"](ctx(taskRequest)),
        /upstream web JSON-RPC HTTP 503/,
      );
    });

    await t.test("pcap upload", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
            status: 200,
            headers: { "set-cookie": "sessionid=session-upload-error; Path=/; HttpOnly" },
          });
        }
        return new Response("<html>upload unavailable</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        });
      };

      await assertUnavailable(
        () =>
          handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/UploadPcapDetectFiles"](
            ctx({
              pcapFiles: [{ fileName: "sample.pcap", contentBase64: Buffer.from("pcap").toString("base64") }],
            }),
          ),
        /pcap upload HTTP 500/,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GetPcapDetectAlertRawDocument uses web session JSON-RPC", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-raw; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { data: { payload: "raw" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/GetPcapDetectAlertRawDocument"](
      ctx({ docId: "doc-1" }),
    );

    const body = JSON.parse(calls[1].options.body);
    assert.equal(calls[1].options.headers.cookie, "sessionid=session-raw");
    assert.equal(body.method, "PcapDetectService.GetAlarmDocument");
    assert.deepEqual(body.params, { doc_id: "doc-1" });
    assert.deepEqual(JSON.parse(result.resultJson), { data: { payload: "raw" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DownloadFile calls unified download API and returns base64 content", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return new Response(Buffer.from("pcap-data"), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": "attachment; filename=\"sample.pcap\"",
        },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/DownloadFile"](
      ctx({ id: "LogSearchService.SearchSrcIpAgg", queryJson: "{\"count\":1}" }),
    );

    assert.equal(captured.options.headers["API-Token"], "test-token");
    assert.match(captured.url, /^https:\/\/answer\.example\/api\/download\?/);
    assert.equal(new URL(captured.url).searchParams.get("id"), "LogSearchService.SearchSrcIpAgg");
    assert.equal(result.contentType, "application/octet-stream");
    assert.equal(result.filename, "sample.pcap");
    assert.equal(Buffer.from(result.contentBase64, "base64").toString(), "pcap-data");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseFilename falls back when the UTF-8 filename is malformed", () => {
  assert.equal(
    internals.parseFilename("attachment; filename*=UTF-8''capture%ZZ.pcap; filename=\"fallback.pcap\""),
    "fallback.pcap",
  );
  assert.equal(internals.parseFilename("attachment; filename*=UTF-8''capture%ZZ.pcap"), "");
});

test("pcap analysis polling durations are finite and bounded", () => {
  assert.equal(internals.normalizeDurationMs(Number.MAX_SAFE_INTEGER, 60000, 1000, 600000), 600000);
  assert.equal(internals.normalizeDurationMs(999999, 5000, 1000, 60000), 60000);
  assert.equal(internals.normalizeDurationMs(1, 5000, 1000, 60000), 1000);
  assert.equal(internals.normalizeDurationMs(-1, 5000, 1000, 60000), 5000);
  assert.equal(internals.normalizeDurationMs(Number.POSITIVE_INFINITY, 5000, 1000, 60000), 5000);
});


test("P0 raw JSON methods route to the expected upstream services", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchHttpLogs"](ctx({ rawParamsJson: "{\"count\":1}" }));
    await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/ListBlockRules"](ctx({ rawParamsJson: "{\"count\":1}" }));
    await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/DownloadPcap"](ctx({ rawParamsJson: "{\"doc_id\":\"doc-1\"}" }));

    assert.deepEqual(calls.map((item) => item.method), [
      "LogSearchService.SearchOrigDataHTTPLog",
      "RulesService.SearchBlockRules",
      "PcapDownloadService.DownloadPcap",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("CountAlerts uses web session JSON-RPC", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-count; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { total: 1, ratio_total: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/CountAlerts"](
      ctx({ rawParamsJson: "{\"time_range_start\":1,\"time_range_end\":2}" }),
    );

    const body = JSON.parse(calls[1].options.body);
    assert.equal(calls[1].options.headers.cookie, "sessionid=session-count");
    assert.equal(body.method, "AlarmService.SearchAlarmCount");
    assert.deepEqual(JSON.parse(result.resultJson), { total: 1, ratio_total: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scenario attack search builds stable alert params", async () => {
  const params = internals.buildScenarioAlertParams({
    timeRangeStart: 1700000000000,
    timeRangeEnd: 1700003600000,
    attackName: "MYSQL 弱口令登录",
    assetIp: "192.0.2.10",
    severity: "2",
    count: 5,
  });

  assert.equal(params.time_range_start, 1700000000000);
  assert.equal(params.time_range_end, 1700003600000);
  assert.deepEqual(params.name, [{ oper: "=", target: "MYSQL 弱口令登录" }]);
  assert.deepEqual(params.asset_ip, ["192.0.2.10"]);
  assert.deepEqual(params.severity, [{ oper: "=", target: 2 }]);
  assert.equal(params.count, 5);
});

test("SearchTrafficLogs with any-direction ip fans out into src and dest queries", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/SearchTrafficLogs"](
      ctx({
        protocol: "http",
        ip: "192.0.2.20",
        timeRangeStart: 1700000000000,
        timeRangeEnd: 1700003600000,
        count: 2,
      }),
    );

    assert.deepEqual(calls.map((item) => item.method), [
      "LogSearchService.SearchOrigDataHTTPLog",
      "LogSearchService.SearchOrigDataHTTPLog",
    ]);
    assert.deepEqual(calls[0].params.src_ip, [{ oper: "=", target: "192.0.2.20" }]);
    assert.deepEqual(calls[1].params.dest_ip, [{ oper: "=", target: "192.0.2.20" }]);
    const parsed = JSON.parse(result.resultJson);
    assert.equal(parsed.protocol, "http");
    assert.equal(parsed.ip, "192.0.2.20");
    assert.equal(parsed.results.http_src.ok, true);
    assert.equal(parsed.results.http_dest.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HuntThreats combines alert search with web aggregation calls", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.method === "HeraAccountNoAuthService.Login") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-hunt; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: { method: body.method } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/HuntThreats"](
      ctx({
        query: "弱口令",
        timeRangeStart: 1700000000000,
        timeRangeEnd: 1700003600000,
      }),
    );

    assert.deepEqual(calls.map((item) => item.method), [
      "AlarmService.SearchAlarmList",
      "HeraAccountNoAuthService.Login",
      "AlarmService.SearchAlarmAggTop",
      "AlarmService.SearchAlarmAggTop",
      "AlarmService.SearchAlarmAggTop",
    ]);
    const parsed = JSON.parse(result.resultJson);
    assert.deepEqual(parsed.alertParams.keyword, ["弱口令"]);
    assert.equal(parsed.alerts.ok, true);
    assert.equal(parsed.top_attack_names.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("InvestigateAttackCampaign returns distilled campaign summary", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.method === "HeraAccountNoAuthService.Login") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-campaign; Path=/; HttpOnly" },
        });
      }
      const resultByMethod = {
        "AlarmService.SearchAlarmList": {
          total: 2,
          data: [
            {
              doc_id: "doc-1",
              name: "MYSQL 弱口令登录",
              attacker: "192.0.2.101",
              victim: "203.0.113.227",
              result: "success",
              severity: 3,
            },
          ],
        },
        "AlarmService.SearchAlarmAggTop": {
          data: [{ key: body.params.agg === "attacker" ? "192.0.2.101" : "MYSQL 弱口令登录", doc_count: 2 }],
          total: 1,
        },
      };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result: resultByMethod[body.method] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/InvestigateAttackCampaign"](
      ctx({ query: "弱口令", timeRangeStart: 1700000000000, timeRangeEnd: 1700003600000 }),
    );
    const parsed = JSON.parse(result.resultJson);

    assert.equal(parsed.type, "attack_campaign_investigation");
    assert.equal(parsed.summary.total_alerts, 2);
    assert.deepEqual(parsed.summary.pivot_ips, ["192.0.2.101", "203.0.113.227"]);
    assert.deepEqual(parsed.evidence.sample_alerts[0].attacker, "192.0.2.101");
    assert.deepEqual(calls.map((item) => item.method), [
      "AlarmService.SearchAlarmList",
      "HeraAccountNoAuthService.Login",
      "AlarmService.SearchAlarmAggTop",
      "AlarmService.SearchAlarmAggTop",
      "AlarmService.SearchAlarmAggTop",
      "AlarmService.SearchAlarmAggTop",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AssessIpThreatProfile summarizes IP roles and related entities", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.method === "HeraAccountNoAuthService.Login") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "login", result: { id: 1 } }), {
          status: 200,
          headers: { "set-cookie": "sessionid=session-profile; Path=/; HttpOnly" },
        });
      }
      let result = { total: 0, data: [] };
      if (body.method === "AssetService.GetAssetList") result = { total: 1, data: [{ ip: "203.0.113.227" }] };
      if (body.method === "AlarmService.SearchAlarmList" && body.params.victim) {
        result = {
          total: 7,
          data: [{ name: "MYSQL 弱口令登录", attacker: "192.0.2.101", victim: "203.0.113.227" }],
        };
      }
      if (body.method === "AlarmService.SearchAlarmAggTop") {
        result = { total: 1, data: [{ key: "MYSQL 弱口令登录", doc_count: 7 }] };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "ok", result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await handlers["chaitin.t_answer_ndr.v1.TAnswerNdrService/AssessIpThreatProfile"](
      ctx({ ip: "203.0.113.227", timeRangeStart: 1700000000000, timeRangeEnd: 1700003600000 }),
    );
    const parsed = JSON.parse(result.resultJson);

    assert.equal(parsed.type, "ip_threat_profile");
    assert.equal(parsed.summary.asset_known, true);
    assert.equal(parsed.summary.asset_query_ok, true);
    assert.equal(parsed.summary.alerts_as_attacker, 0);
    assert.equal(parsed.summary.alerts_as_victim, 7);
    assert.equal(parsed.summary.dominant_role, "victim");
    assert.deepEqual(parsed.summary.pivot_ips, ["192.0.2.101", "203.0.113.227"]);
    assert.equal(calls.filter((item) => item.method === "AlarmService.SearchAlarmAggTop").length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
