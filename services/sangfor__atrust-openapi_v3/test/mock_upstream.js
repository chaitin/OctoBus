/* node:coverage disable */
import crypto from "node:crypto";
import http from "node:http";

const API_ID = "mock-api-id";
const API_SECRET = "mock-api-secret";

const readText = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
};

const canonicalQuery = (searchParams) => [...searchParams.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key}=${value}`)
  .join("&");

const signingString = (pathname, searchParams, bodyText) => {
  const queryText = canonicalQuery(searchParams);
  if (queryText && bodyText) return `${pathname}?${queryText}&${bodyText}`;
  if (queryText) return `${pathname}?${queryText}`;
  if (bodyText) return `${pathname}?${bodyText}`;
  return pathname;
};

const expectedSign = (req, url, bodyText) => {
  const timestamp = req.headers["x-ca-timestamp"];
  const nonce = req.headers["x-ca-nonce"];
  const key = `appId=${API_ID}&appSecret=${API_SECRET}&timestamp=${timestamp}&nonce=${nonce}`;
  return crypto.createHmac("sha256", key).update(signingString(url.pathname, url.searchParams, bodyText)).digest("hex");
};

const requireSigned = (req, url, bodyText) => {
  if (req.headers["x-ca-key"] !== API_ID) return "bad key";
  if (!req.headers["x-ca-timestamp"]) return "missing timestamp";
  if (!req.headers["x-ca-nonce"]) return "missing nonce";
  if (req.headers["x-ca-sign"] !== expectedSign(req, url, bodyText)) return "bad sign";
  return "";
};

export const startMockUpstream = async () => {
  const state = {
    requests: [],
    users: [{ id: "user-1", name: "zhangsan", externalId: "ext-user-1", directoryDomain: "local" }],
    groups: [{ id: "group-1", name: "dev", fullPath: "/dev", externalId: "ext-group-1" }],
    roles: [{ id: "role-1", name: "admin", externalId: "ext-role-1" }],
    resources: [{ id: "res-1", name: "oa", groupName: "default" }],
    resourceGroups: [{ id: "default", name: "default" }],
    userDirectories: [{ id: "dir-1", name: "local", type: "local" }],
    devices: [{ id: "device-1", name: "pc-1", externalId: "asset-1" }],
    kicked: [],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const bodyText = await readText(req);
    const signedError = requireSigned(req, url, bodyText);
    state.requests.push({
      method: req.method,
      pathname: url.pathname,
      search: url.search,
      bodyText,
      headers: req.headers,
      signingString: signingString(url.pathname, url.searchParams, bodyText),
      signedError,
    });
    if (signedError) return send(res, 403, { code: "DENIED", msg: signedError, data: {}, traceId: "trace-denied" });

    const testMode = url.searchParams.get("testMode");
    if (testMode === "denied") return send(res, 403, { code: "DENIED", msg: "apiSecret=must-not-leak" });
    if (testMode === "unavailable") return send(res, 503, { code: "ERROR", msg: "internal token=must-not-leak" });
    if (testMode === "bad-request") return send(res, 400, { code: "BAD", msg: "invalid filter" });
    if (testMode === "invalid-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("not-json");
    }
    if (testMode === "large") return send(res, 200, { code: 0, data: "x".repeat(2048) });
    if (testMode === "slow") {
      return setTimeout(() => send(res, 200, { code: 0, data: {} }), 100);
    }

    if (req.method === "GET" && url.pathname === "/api/v1/monitor/getUserStatus") {
      return send(res, 200, {
        code: 0,
        msg: "请求成功",
        data: { data: state.users, count: state.users.length, pageIndex: Number(url.searchParams.get("pageIndex") || 1) },
        traceId: "trace-online",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/monitor/kickoutUsers") {
      const body = JSON.parse(bodyText || "{}");
      state.kicked.push(body);
      return send(res, 200, { code: 0, msg: "请求成功", data: {}, traceId: "trace-kickout" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/user/queryByName") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: state.users.find((item) => item.name === url.searchParams.get("name")), traceId: "trace-user" });
    }

    if (req.method === "POST" && url.pathname === "/api/v3/user/queryAll") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: { data: state.users, request: JSON.parse(bodyText || "{}") }, traceId: "trace-users" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/group/queryByFullPath") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: state.groups.find((item) => item.fullPath === url.searchParams.get("fullPath")), traceId: "trace-group" });
    }

    if (req.method === "POST" && url.pathname === "/api/v3/group/queryAll") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: { data: state.groups, request: JSON.parse(bodyText || "{}") }, traceId: "trace-groups" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/role/queryById") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: state.roles.find((item) => item.id === url.searchParams.get("id")), traceId: "trace-role" });
    }

    if (req.method === "POST" && url.pathname === "/api/v3/role/queryAll") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: { data: state.roles, request: JSON.parse(bodyText || "{}") }, traceId: "trace-roles" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/resource/queryAll") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: { data: state.resources, filter: url.searchParams.get("filter") }, traceId: "trace-resources" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/resource/queryById") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: state.resources.find((item) => item.id === url.searchParams.get("id")), traceId: "trace-resource" });
    }

    if (req.method === "GET" && url.pathname === "/api/v3/resourceGroup/queryAll") {
      return send(res, 200, { code: "OK", msg: "请求成功", data: { resourceGroup: state.resourceGroups }, traceId: "trace-resource-groups" });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/userDirectory/queryAll") {
      return send(res, 200, { code: 0, msg: "请求成功", data: state.userDirectories, traceId: "trace-directories" });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/userDirectory/query") {
      return send(res, 200, { code: 0, msg: "请求成功", data: state.userDirectories.find((item) => item.name === url.searchParams.get("name")), traceId: "trace-directory" });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/device/queryAll") {
      return send(res, 200, { code: 0, msg: "请求成功", data: { data: state.devices, request: JSON.parse(bodyText || "{}") }, traceId: "trace-devices" });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/device/query") {
      return send(res, 200, { code: 0, msg: "请求成功", data: state.devices.find((item) => item.externalId === url.searchParams.get("externalId")), traceId: "trace-device" });
    }

    return send(res, 404, { code: "NOT_FOUND", msg: "not found", data: {}, traceId: "trace-404" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    apiId: API_ID,
    apiSecret: API_SECRET,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    state,
  };
};
