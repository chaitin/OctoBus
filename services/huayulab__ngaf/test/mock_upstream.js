import http from "node:http";

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function hasSessionCookie(request) {
  return String(request.headers.cookie || "").includes("ci_session=mock-session");
}

export async function createMockUpstream(options = {}) {
  const requests = [];
  const state = {
    token: options.token || "mock-token",
    userInfoCalls: 0,
    forceFirstUserInfoAuthFailure: Boolean(
      options.forceFirstUserInfoAuthFailure,
    ),
  };

  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    const record = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    };
    requests.push(record);

    if (typeof options.handler === "function") {
      const handled = await options.handler(request, response, record, state);
      if (handled) {
        return;
      }
    }

    if (
      request.method === "POST" &&
      request.url === "/api.php/Login/uInterlogin"
    ) {
      const parsed = Object.fromEntries(new URLSearchParams(body));
      if (!parsed.username || !parsed.sign) {
        sendJson(response, 200, {
          code: 1001,
          message: "missing username or sign",
          result: {},
        });
        return;
      }
      sendJson(response, 200, {
        code: 0,
        message: "操作成功",
        result: {
          token: state.token,
        },
      }, {
        "set-cookie": "ci_session=mock-session; path=/; secure; HttpOnly",
      });
      return;
    }

    if (
      request.method === "GET" &&
      request.url === "/api.php/Login/getUserInfo"
    ) {
      state.userInfoCalls += 1;
      if (
        state.forceFirstUserInfoAuthFailure &&
        state.userInfoCalls === 1
      ) {
        sendJson(response, 200, {
          code: 401,
          message: "token expired",
          result: {},
        });
        return;
      }

      if (request.headers.authorization !== state.token) {
        sendJson(response, 401, {
          code: 401,
          message: "unauthorized",
          result: {},
        });
        return;
      }
      sendJson(response, 200, {
        code: 0,
        message: "操作成功",
        result: {
          rid: "1",
          uid: "100",
          uname: "admin",
        },
      });
      return;
    }

    if (
      request.method === "GET" &&
      (request.url.startsWith("/api.php/reporter/") ||
        request.url.startsWith("/api.php/netmanage/object/"))
    ) {
      if (!hasSessionCookie(request)) {
        sendJson(response, 200, {
          code: 1,
          message: "超时退出",
          result: {},
        });
        return;
      }
      sendJson(response, 200, {
        code: 0,
        message: "操作成功",
        result: {
          total: 1,
          rows: [
            {
              id: "mock-row",
              source: request.url,
            },
          ],
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      request.url.startsWith("/api.php/netmanage/") &&
      request.url.endsWith("/getList")
    ) {
      if (!hasSessionCookie(request)) {
        sendJson(response, 200, {
          code: 1,
          message: "超时退出",
          result: {},
        });
        return;
      }
      sendJson(response, 200, {
        code: 0,
        message: "操作成功",
        result: {
          total: 1,
          rows: [
            {
              id: "mock-policy-object",
              source: request.url,
            },
          ],
        },
      });
      return;
    }

    sendJson(response, 404, {
      code: 404,
      message: "not found",
      result: {},
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
