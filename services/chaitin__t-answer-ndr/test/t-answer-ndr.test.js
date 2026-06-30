import assert from "node:assert/strict";
import test from "node:test";
import { grpcStatus } from "@chaitin-ai/octobus-sdk";

import { handlers, internals } from "../src/t-answer-ndr.js";

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

    assert.equal(options.skipTlsVerify, true);
    assert.equal(options.tlsInsecureSkipVerify, true);
    assert.equal(options.insecureSkipVerify, true);
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
