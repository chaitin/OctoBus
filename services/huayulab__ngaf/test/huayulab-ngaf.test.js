import assert from "node:assert/strict";
import test from "node:test";

import {
  METHOD_QUERY_AUDIT_LOG_FULL,
  METHOD_QUERY_BEHAVIOR_LOG_FULL,
  METHOD_QUERY_FLOW_ANALYSIS_FULL,
  METHOD_QUERY_REFERENCE_DATA_FULL,
  METHOD_LIST_POLICY_OBJECTS_FULL,
  METHOD_GET_USER_INFO_FULL,
  METHOD_QUERY_RESOURCE_METRIC_FULL,
  METHOD_QUERY_SECURITY_LOG_FULL,
  METHOD_QUERY_SECURITY_STATISTIC_FULL,
  _test,
  handlers,
} from "../src/huayulab-ngaf.js";
import { createMockUpstream } from "./mock_upstream.js";

function contextFor(baseUrl, overrides = {}) {
  return {
    config: {
      endpoint: `${baseUrl}/api.php`,
      allowInsecureHttp: true,
      timeoutMs: 2000,
      skipTlsVerify: false,
      ...overrides.config,
    },
    secret: {
      username: "admin",
      apiSecret: "secret",
      ...overrides.secret,
    },
  };
}

test("builds the documented login sign", () => {
  assert.equal(
    _test.buildLoginSign("secret"),
    _test.md5(`${_test.md5("secret")}-api-!*195`),
  );
});

test("normalizes website and API endpoint URLs", () => {
  assert.equal(
    _test.normalizeEndpoint(
      "https://example.test:9090/index.php?id=1#x",
      false,
    ),
    "https://example.test:9090/api.php",
  );
  assert.equal(
    _test.normalizeEndpoint("https://example.test:9090", false),
    "https://example.test:9090/api.php",
  );
});

test("rejects plain HTTP unless explicitly allowed", () => {
  assert.throws(
    () => _test.normalizeEndpoint("http://device.example:8080/api.php", false),
    /plain HTTP endpoints are disabled/,
  );
  assert.equal(
    _test.normalizeEndpoint("http://127.0.0.1:8080/api.php", true),
    "http://127.0.0.1:8080/api.php",
  );
  assert.equal(
    _test.normalizeEndpoint("http://127.0.0.1:8080/api.php", false),
    "http://127.0.0.1:8080/api.php",
  );
});

test("GetUserInfo logs in and fetches the current user", async () => {
  const upstream = await createMockUpstream();
  try {
    const response = await handlers[METHOD_GET_USER_INFO_FULL](
      contextFor(upstream.baseUrl),
    );

    assert.equal(response.code, 0);
    assert.equal(response.message, "操作成功");
    assert.equal(response.httpStatus, 200);
    assert.deepEqual(response.user, {
      rid: "1",
      uid: "100",
      uname: "admin",
    });
    assert.equal(upstream.requests.length, 2);
    assert.equal(upstream.requests[0].url, "/api.php/Login/uInterlogin");
    assert.match(
      upstream.requests[0].headers["content-type"],
      /^application\/x-www-form-urlencoded/,
    );
    assert.equal(
      new URLSearchParams(upstream.requests[0].body).get("username"),
      "admin",
    );
    assert.equal(
      new URLSearchParams(upstream.requests[0].body).get("sign"),
      _test.buildLoginSign("secret"),
    );
    assert.equal(upstream.requests[1].url, "/api.php/Login/getUserInfo");
    assert.equal(upstream.requests[1].headers.authorization, "mock-token");
    assert.equal(upstream.requests[1].headers.cookie, "ci_session=mock-session");
    assert.equal(upstream.requests[1].headers.lan, "zh_CN");
  } finally {
    await upstream.close();
  }
});

test("GetUserInfo refreshes token once after an auth failure", async () => {
  const upstream = await createMockUpstream({
    forceFirstUserInfoAuthFailure: true,
  });
  try {
    _test.clearToken({
      endpoint: `${upstream.baseUrl}/api.php`,
      username: "admin",
    });

    const response = await handlers[METHOD_GET_USER_INFO_FULL](
      contextFor(upstream.baseUrl),
    );

    assert.equal(response.code, 0);
    assert.equal(upstream.requests.length, 4);
    assert.equal(upstream.requests[0].url, "/api.php/Login/uInterlogin");
    assert.equal(upstream.requests[1].url, "/api.php/Login/getUserInfo");
    assert.equal(upstream.requests[2].url, "/api.php/Login/uInterlogin");
    assert.equal(upstream.requests[3].url, "/api.php/Login/getUserInfo");
  } finally {
    await upstream.close();
  }
});

test("session cache is isolated by apiSecret", async () => {
  const upstream = await createMockUpstream();
  try {
    await handlers[METHOD_GET_USER_INFO_FULL](
      contextFor(upstream.baseUrl, {
        secret: {
          apiSecret: "secret-one",
        },
      }),
    );

    await handlers[METHOD_GET_USER_INFO_FULL](
      contextFor(upstream.baseUrl, {
        secret: {
          apiSecret: "secret-two",
        },
      }),
    );

    assert.equal(upstream.requests.length, 4);
    assert.equal(upstream.requests[0].url, "/api.php/Login/uInterlogin");
    assert.equal(upstream.requests[2].url, "/api.php/Login/uInterlogin");
    assert.equal(
      new URLSearchParams(upstream.requests[0].body).get("sign"),
      _test.buildLoginSign("secret-one"),
    );
    assert.equal(
      new URLSearchParams(upstream.requests[2].body).get("sign"),
      _test.buildLoginSign("secret-two"),
    );
  } finally {
    await upstream.close();
  }
});

test("business messages mentioning token or session do not trigger re-login", async () => {
  const upstream = await createMockUpstream({
    handler: (request, response) => {
      if (
        request.method === "GET" &&
        request.url.startsWith("/api.php/reporter/safelog/IpsLog/getList")
      ) {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(
          JSON.stringify({
            code: 0,
            message: "total session count and token generated",
            result: {
              total: 0,
              rows: [],
            },
          }),
        );
        return true;
      }
      return false;
    },
  });
  try {
    const response = await handlers[METHOD_QUERY_SECURITY_LOG_FULL]({
      ...contextFor(upstream.baseUrl),
      req: {
        type: "SECURITY_LOG_IPS",
        query: {
          page: 1,
          pageSize: 5,
        },
      },
    });

    assert.equal(response.code, 0);
    assert.equal(upstream.requests.length, 2);
    assert.equal(upstream.requests[0].url, "/api.php/Login/uInterlogin");
    assert.match(
      upstream.requests[1].url,
      /^\/api\.php\/reporter\/safelog\/IpsLog\/getList/,
    );
  } finally {
    await upstream.close();
  }
});

test("requires endpoint and credentials", async () => {
  await assert.rejects(
    () =>
      handlers[METHOD_GET_USER_INFO_FULL]({
        config: {},
        secret: {
          username: "admin",
          apiSecret: "secret",
        },
      }),
    /config\.endpoint is required/,
  );

  await assert.rejects(
    () =>
      handlers[METHOD_GET_USER_INFO_FULL]({
        config: {
          endpoint: "https://example.test/api.php",
        },
        secret: {
          username: "admin",
        },
      }),
    /secret\.apiSecret is required/,
	  );
	});
	
test("upstream requests respect bounded timeout", async () => {
  await assert.rejects(
    () =>
      handlers[METHOD_GET_USER_INFO_FULL]({
        config: {
          endpoint: "https://example.test/api.php",
          timeoutMs: 500,
          skipTlsVerify: false,
        },
        secret: {
          username: "admin",
          apiSecret: "secret",
        },
        fetch: (_url, init = {}) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      }),
    /upstream request timed out after 500ms/,
  );
});

test("upstream responses are bounded in size", async () => {
  const upstream = await createMockUpstream({
    handler: (request, response) => {
      if (
        request.method === "GET" &&
        request.url.startsWith("/api.php/reporter/safelog/IpsLog/getList")
      ) {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.write("x".repeat(10 * 1024 * 1024 + 1));
        response.end();
        return true;
      }
      return false;
    },
  });
  try {
    await assert.rejects(
      () =>
        handlers[METHOD_QUERY_SECURITY_LOG_FULL]({
          ...contextFor(upstream.baseUrl),
          req: {
            type: "SECURITY_LOG_IPS",
          },
        }),
      /upstream request failed: upstream response exceeds/,
    );
  } finally {
    await upstream.close();
  }
});

test("QuerySecurityLog calls a fixed allowlisted endpoint with bounded filters", async () => {
  const upstream = await createMockUpstream();
  try {
    const response = await handlers[METHOD_QUERY_SECURITY_LOG_FULL]({
      ...contextFor(upstream.baseUrl),
      req: {
        type: "SECURITY_LOG_IPS",
        query: {
          page: 2,
          pageSize: 25,
          startTime: "2026-06-25 00:00:00",
          endTime: "2026-06-25 23:59:59",
          order: "desc",
          filtersJson: JSON.stringify({
            srcip: "1.1.1.1",
            "level_type[]": ["1", "2"],
          }),
        },
      },
    });

    assert.equal(response.code, 0);
    assert.equal(response.httpStatus, 200);
    assert.equal(response.upstreamPath, _test.SECURITY_LOG_ENDPOINTS.SECURITY_LOG_IPS);
    const data = JSON.parse(response.dataJson);
    assert.equal(data.total, 1);

    const queryUrl = new URL(
      upstream.requests[1].url,
      "http://mock.local",
    );
    assert.equal(queryUrl.pathname, "/api.php/reporter/safelog/IpsLog/getList");
    assert.equal(queryUrl.searchParams.get("page"), "2");
    assert.equal(queryUrl.searchParams.get("pageSize"), "25");
    assert.deepEqual(queryUrl.searchParams.getAll("time_period[]"), [
      "2026-06-25 00:00:00",
      "2026-06-25 23:59:59",
    ]);
    assert.deepEqual(queryUrl.searchParams.getAll("level_type[]"), ["1", "2"]);
    assert.equal(queryUrl.searchParams.get("srcip"), "1.1.1.1");
    assert.equal(upstream.requests[1].headers.cookie, "ci_session=mock-session");
  } finally {
    await upstream.close();
  }
});

test("QueryResourceMetric reads only documented metric endpoints", async () => {
  const upstream = await createMockUpstream();
  try {
    const response = await handlers[METHOD_QUERY_RESOURCE_METRIC_FULL]({
      ...contextFor(upstream.baseUrl),
      req: {
        type: "RESOURCE_METRIC_CPU",
        query: {
          page: 1,
          pageSize: 10,
        },
      },
    });

    assert.equal(response.code, 0);
    assert.equal(
      response.upstreamPath,
      _test.RESOURCE_METRIC_ENDPOINTS.RESOURCE_METRIC_CPU,
    );
    assert.equal(
      new URL(upstream.requests[1].url, "http://mock.local").pathname,
      "/api.php/reporter/flowanalysis/ResourceTrendTt/getCpuLineData",
    );
    assert.equal(upstream.requests[1].headers.cookie, "ci_session=mock-session");
  } finally {
    await upstream.close();
  }
});

test("ListPolicyObjects uses documented read-only getList endpoints", async () => {
  const upstream = await createMockUpstream();
  try {
    const response = await handlers[METHOD_LIST_POLICY_OBJECTS_FULL]({
      ...contextFor(upstream.baseUrl),
      req: {
        type: "POLICY_OBJECT_IP_WHITELIST",
        query: {
          page: 1,
          pageSize: 20,
          filtersJson: JSON.stringify({
            ip: "10.0.0.1",
          }),
        },
      },
    });

    assert.equal(response.code, 0);
    assert.equal(
      response.upstreamPath,
      _test.POLICY_OBJECT_ENDPOINTS.POLICY_OBJECT_IP_WHITELIST,
    );
    assert.equal(upstream.requests[1].method, "POST");
    assert.equal(
      upstream.requests[1].url,
      "/api.php/netmanage/userauth/IpWhiteList/getList",
    );
    assert.match(
      upstream.requests[1].headers["content-type"],
      /^application\/x-www-form-urlencoded/,
    );
    const body = new URLSearchParams(upstream.requests[1].body);
    assert.equal(body.get("page"), "1");
    assert.equal(body.get("pageSize"), "20");
    assert.equal(body.get("ip"), "10.0.0.1");
    assert.equal(upstream.requests[1].headers.cookie, "ci_session=mock-session");
  } finally {
    await upstream.close();
  }
});

test("read-only queries reject unsupported types and unsafe filter shapes", async () => {
  await assert.rejects(
    () =>
      handlers[METHOD_QUERY_SECURITY_LOG_FULL]({
        ...contextFor("https://example.test"),
        req: {
          type: "SECURITY_LOG_TYPE_UNSPECIFIED",
        },
      }),
    /type is required and must be supported/,
  );

  await assert.rejects(
    () =>
      handlers[METHOD_QUERY_SECURITY_LOG_FULL]({
        ...contextFor("https://example.test"),
        req: {
          type: "SECURITY_LOG_IPS",
          query: {
            filtersJson: JSON.stringify({
              nested: {
                blocked: true,
              },
            }),
          },
        },
      }),
    /must contain scalar values only/,
  );
});

test("all read-only RPC families dispatch only to their fixed endpoint maps", async () => {
  const upstream = await createMockUpstream();
  const cases = [
    [METHOD_QUERY_BEHAVIOR_LOG_FULL, "BEHAVIOR_LOG_ALL", "/reporter/behaviorlog/AllBehaviorLog/getList"],
    [METHOD_QUERY_AUDIT_LOG_FULL, "AUDIT_LOG_HTTP", "/reporter/nsaslog/NsasHttpLog/getList"],
    [METHOD_QUERY_SECURITY_STATISTIC_FULL, "SECURITY_STATISTIC_IPS_HOLE_TOP10", "/reporter/safelog/IpsLog/getHoleIdStaticTop10"],
    [METHOD_QUERY_FLOW_ANALYSIS_FULL, "FLOW_ANALYSIS_USER", "/reporter/flowanalysis/UserTt/getList"],
    [METHOD_QUERY_REFERENCE_DATA_FULL, "REFERENCE_DATA_TIME_OBJECT", "/netmanage/object/TimePlanObject/getTimePlanSel"],
  ];
  try {
    for (const [method, type, expectedPath] of cases) {
      const response = await handlers[method]({
        ...contextFor(upstream.baseUrl),
        req: { type, query: { page: 1, pageSize: 10 } },
      });
      assert.equal(response.code, 0);
      assert.equal(response.upstreamPath, expectedPath);
    }
  } finally {
    await upstream.close();
  }
});

test("request validation rejects malformed endpoints, paging, filters, and ordering", () => {
  assert.throws(() => _test.normalizeEndpoint("not a URL", false), /valid URL/);
  assert.throws(() => _test.normalizeEndpoint("file:///tmp/device", false), /http or https/);
  assert.throws(
    () => _test.resolveConfig({ config: { endpoint: "https://device.test", lan: "xx_YY" }, secret: { username: "u", apiSecret: "s" } }),
    /unsupported lan/,
  );
  assert.throws(() => _test.queryParamsFromRequest({ page: 0 }), /positive integer/);
  assert.throws(() => _test.queryParamsFromRequest({ query: { startTime: "2026-01-01" } }), /provided together/);
  assert.throws(() => _test.queryParamsFromRequest({ query: { order: "random" } }), /asc or desc/);
  assert.throws(() => _test.queryParamsFromRequest({ query: { filtersJson: "[]" } }), /JSON object/);
  assert.throws(() => _test.queryParamsFromRequest({ query: { filtersJson: "{" } }), /valid JSON object/);
  assert.throws(
    () => _test.queryParamsFromRequest({ query: { filtersJson: JSON.stringify({ "bad key!": "x" }) } }),
    /invalid key/,
  );
  assert.throws(
    () => _test.queryParamsFromRequest({ query: { filtersJson: JSON.stringify({ values: Array(21).fill("x") }) } }),
    /too many values/,
  );
  assert.throws(
    () => _test.queryParamsFromRequest({ query: { filtersJson: JSON.stringify({ pageSize: 9999 }) } }),
    /reserved key/,
  );
  for (const key of [
    "page[0]",
    "pageSize[0]",
    "time_period[0]",
    "time_period[]",
    "page.size",
    "page.size[0]",
    "time.period",
    "time.period[0]",
  ]) {
    assert.throws(
      () => _test.queryParamsFromRequest({ query: { filtersJson: JSON.stringify({ [key]: "bypass" }) } }),
      /reserved key/,
    );
  }
});

test("NFS audit queries use the NFS endpoint", async () => {
  const upstream = await createMockUpstream();
  try {
    const response = await handlers[METHOD_QUERY_AUDIT_LOG_FULL]({
      ...contextFor(upstream.baseUrl),
      req: { type: "AUDIT_LOG_NFS" },
    });
    assert.equal(response.upstreamPath, "/reporter/nsaslog/NsasNfsLog/getList");
  } finally {
    await upstream.close();
  }
});

test("configuration and request aliases normalize to bounded canonical values", () => {
  const config = _test.resolveConfig({
    env: {
      endpoint: "http://127.0.0.1:8080",
      allowInsecureHttp: "yes",
      username: " env-user ",
      api_secret: " env-secret ",
      timeoutMs: "999999",
      skipTlsVerify: "on",
      lan: "en_US",
    },
  });
  assert.equal(config.endpoint, "http://127.0.0.1:8080/api.php");
  assert.equal(config.username, "env-user");
  assert.equal(config.apiSecret, "env-secret");
  assert.equal(config.timeoutMs, 30000);
  assert.equal(config.skipTlsVerify, true);
  assert.equal(config.lan, "en_US");

  assert.equal(
    _test.resolveEndpoint(_test.RESOURCE_METRIC_ENDPOINTS, "resource_metric_cpu", "type").typeName,
    "RESOURCE_METRIC_CPU",
  );
  assert.equal(
    _test.resolveEndpoint(_test.RESOURCE_METRIC_ENDPOINTS, 1, "type").typeName,
    "RESOURCE_METRIC_CPU",
  );

  const params = _test.queryParamsFromRequest({
    page_size: 999,
    start_time: "a",
    end_time: "b",
    keyword: "needle",
    filters_json: JSON.stringify({ enabled: true, optional: null }),
  });
  assert.equal(params.get("pageSize"), "200");
  assert.equal(params.get("keyword"), "needle");
  assert.equal(params.get("enabled"), "true");
  assert.equal(params.get("optional"), "");
});
