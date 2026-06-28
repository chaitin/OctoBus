import http from "node:http";

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
};

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
};

const tokenFrom = (req) => {
  const cookie = req.headers.cookie || "";
  const match = /(?:^|;\s*)token=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : "";
};

export const startMockUpstream = async () => {
  const state = {
    token: "mock-token",
    logins: 0,
    keepAlives: 0,
    logouts: 0,
    blacklist: [],
    blockIp: [],
    blockTime: "1d",
    requests: [],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push({ method: req.method, pathname: url.pathname, search: url.search, token: tokenFrom(req) });

    try {
      if (req.method === "POST" && url.pathname.endsWith("/login")) {
        const body = await readJson(req);
        state.logins += 1;
        if (!body?.name || !body?.password) return send(res, 200, { code: 22, message: "invalid", data: "" });
        return send(res, 200, {
          code: 0,
          message: "success",
          data: { name: body.name, loginResult: { token: state.token } },
        });
      }

      if (!tokenFrom(req)) return send(res, 200, { code: 1003, message: "not logged in", data: "" });

      if (req.method === "GET" && url.pathname.endsWith("/keepalive")) {
        state.keepAlives += 1;
        return send(res, 200, { code: 0, message: "success", data: 0 });
      }

      if (req.method === "POST" && url.pathname.endsWith("/logout")) {
        state.logouts += 1;
        await readJson(req);
        return send(res, 200, { code: 0, message: "success", data: { name: "mock-user" } });
      }

      if (url.pathname.endsWith("/whiteblacklist")) {
        if (req.method === "GET") {
          return send(res, 200, { code: 0, message: "success", data: { items: state.blacklist, itemLength: state.blacklist.length } });
        }
        if (req.method === "POST" && url.searchParams.get("_method") === "delete") {
          const body = await readJson(req);
          const urls = new Set((body || []).map((item) => item.url));
          state.blacklist = state.blacklist.filter((item) => !urls.has(item.url));
          return send(res, 200, { code: 0, message: "success", data: body });
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          state.blacklist.push(...body);
          return send(res, 200, { code: 0, message: "success", data: body });
        }
      }

      if (url.pathname.endsWith("/blockip")) {
        if (req.method === "GET") {
          return send(res, 200, { code: 0, message: "success", data: { items: state.blockIp, itemLength: state.blockIp.length } });
        }
        if (req.method === "POST" && url.searchParams.get("_method") === "delete") {
          const body = await readJson(req);
          state.blockIp = [];
          return send(res, 200, { code: 0, message: "success", data: body });
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          state.blockIp.push(body);
          return send(res, 200, { code: 0, message: "success", data: body });
        }
      }

      if (url.pathname.endsWith("/blockiptime")) {
        if (req.method === "GET") {
          return send(res, 200, { code: 0, message: "success", data: { blockTime: state.blockTime } });
        }
        if (req.method === "PATCH") {
          const body = await readJson(req);
          state.blockTime = body.blockTime;
          return send(res, 200, { code: 0, message: "success", data: { blockTime: state.blockTime } });
        }
      }

      send(res, 404, { code: 1002, message: "not found", data: "" });
    } catch (err) {
      send(res, 500, { code: 1007, message: err.message, data: "" });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
