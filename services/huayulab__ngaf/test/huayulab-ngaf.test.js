import assert from "node:assert/strict";
import test from "node:test";

import {
  METHOD_LIST_POLICY_OBJECTS_FULL,
  METHOD_GET_USER_INFO_FULL,
  METHOD_QUERY_RESOURCE_METRIC_FULL,
  METHOD_QUERY_SECURITY_LOG_FULL,
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
    () => _test.normalizeEndpoint("http://127.0.0.1:8080/api.php", false),
    /plain HTTP endpoints are disabled/,
  );
  assert.equal(
    _test.normalizeEndpoint("http://127.0.0.1:8080/api.php", true),
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
