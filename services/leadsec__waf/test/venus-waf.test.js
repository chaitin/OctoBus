import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const healthPath = "/Venus_WAF.Venus_WAF/HealthCheck";
const listBlacklistsPath = "/Venus_WAF.Venus_WAF/ListBlacklists";
const listAccessOptionsPath = "/Venus_WAF.Venus_WAF/ListAccessOptions";
const createAddressObjectPath = "/Venus_WAF.Venus_WAF/CreateAddressObject";
const blockIPPath = "/Venus_WAF.Venus_WAF/BlockIP";
const createBlacklistPath = "/Venus_WAF.Venus_WAF/CreateBlacklist";
const setBlacklistEnabledPath = "/Venus_WAF.Venus_WAF/SetBlacklistEnabled";
const deleteBlacklistPath = "/Venus_WAF.Venus_WAF/DeleteBlacklist";
const listWhitelistsPath = "/Venus_WAF.Venus_WAF/ListWhitelists";
const createWhitelistPath = "/Venus_WAF.Venus_WAF/CreateWhitelist";
const setWhitelistEnabledPath = "/Venus_WAF.Venus_WAF/SetWhitelistEnabled";
const deleteWhitelistPath = "/Venus_WAF.Venus_WAF/DeleteWhitelist";

const buildCtx = (req = {}, overrides = {}) => ({
  config: {
    baseUrl: "https://waf.example.local",
    insecureSkipTlsVerify: false,
    ...overrides.config,
  },
  secret: {
    username: "adm",
    password: "Venus.70",
    ...overrides.secret,
  },
  req,
});

const jsonResponse = (body, options = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  headers: {
    get: (name) => {
      if (String(name).toLowerCase() === "set-cookie") return options.setCookie || "";
      return "application/json";
    },
  },
  text: async () => JSON.stringify(body),
});

const loadHandler = async (path, req = {}, overrides = {}) => {
  const { rpcdef } = await import("../src/venus-waf.js");
  return rpcdef(buildCtx(req, overrides))[path];
};

test("helpers hash password and validate rule payload", async () => {
  const { _test } = await import("../src/venus-waf.js");
  assert.equal(_test.sha256Hex("Venus.70"), "5c6a48b957e06bc290aa58b116eb1c85a50ccae74cc0974d3f46673db660d4b3");
  assert.deepEqual(_test.buildRulePayload({
    name: "rule",
    if_in: "any",
    src_addrobj: "src",
    dst_addrobj: "dst",
    dst_servobj: "https_443",
  }), {
    name: "rule",
    if_in: "any",
    src_addrobj: "src",
    dst_addrobj: "dst",
    dst_servobj: "https_443",
    log: 1,
    log_level: 6,
    enable: 1,
    week_day: "7,",
    day_enable_time: "0-24",
    set_periodic: 1,
  });
  assert.throws(() => _test.buildRulePayload({}), /name is required/);
});

test("HealthCheck logs in with SHA-256 password and stores authorization", async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, "https://waf.example.local/api/mgr/login");
    assert.deepEqual(JSON.parse(init.body), {
      username: "adm",
      password: "5c6a48b957e06bc290aa58b116eb1c85a50ccae74cc0974d3f46673db660d4b3",
    });
    return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } }, { setCookie: "SID=sid-1; Path=/" });
  };

  const handler = await loadHandler(healthPath);
  assert.deepEqual(await handler(), { ok: true, code: 0, message: "success" });
  assert.equal("insecureSkipVerify" in calls[0].init, false);
});

test("default fetch path uses AbortSignal timeout instead of non-standard timeout options", async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
  };

  const handler = await loadHandler(healthPath, {}, { config: { timeoutMs: 1234 } });
  await handler();

  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in calls[0].init, false);
  assert.equal("insecureSkipVerify" in calls[0].init, false);
  assert.equal("tlsInsecureSkipVerify" in calls[0].init, false);
});

test("upstream HTTP error messages redact and truncate response bodies", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 502,
    headers: { get: () => "text/html" },
    text: async () => `<html>${"x".repeat(500)} token=secret authorization=abc</html>`,
  });

  await assert.rejects(
    (await loadHandler(healthPath))(),
    (error) => {
      assert.match(error.message, /upstream http 502/);
      assert.ok(error.message.length < 320);
      assert.doesNotMatch(error.message, /secret|abc/);
      return true;
    },
  );
});

test("ListBlacklists maps data.blacklist and global priority", async () => {
  const urls = [];
  global.fetch = async (url, init) => {
    urls.push(url);
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    assert.equal(init.headers.Authorization, "token-1");
    return jsonResponse({
      code: 0,
      msg: "success",
      data: {
        enable: 1,
        blacklist: [{
          name: "block-1",
          if_in: "any",
          src_addrobj: "src",
          dst_addrobj: "dst",
          dst_servobj: "https_443",
          log: 1,
          log_level: 6,
          enable: 1,
          week_day: "7,",
          day_enable_time: "0-24",
          set_periodic: 1,
        }],
      },
    });
  };

  const handler = await loadHandler(listBlacklistsPath);
  const res = await handler();
  assert.deepEqual(urls, ["https://waf.example.local/api/mgr/login", "https://waf.example.local/blacklist"]);
  assert.equal(res.global_priority_enabled, 1);
  assert.equal(res.rules[0].name, "block-1");
});

test("ListWhitelists accepts upstream list under data.blacklist", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    assert.equal(url, "https://waf.example.local/whitelist");
    return jsonResponse({
      code: 0,
      msg: "success",
      data: {
        enable: 0,
        blacklist: [{ name: "allow-1", if_in: "any" }],
      },
    });
  };

  const handler = await loadHandler(listWhitelistsPath);
  const res = await handler();
  assert.equal(res.global_priority_enabled, 0);
  assert.equal(res.rules[0].name, "allow-1");
});

test("write methods use expected paths and mode values", async () => {
  const writes = [];
  const created = {
    blacklist: new Set(),
    whitelist: new Set(),
  };
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.endsWith("/blacklist") && init.method === "GET") {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: { enable: 1, blacklist: [...created.blacklist].map((name) => ({ name })) },
      });
    }
    if (url.endsWith("/whitelist") && init.method === "GET") {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: { enable: 1, blacklist: [...created.whitelist].map((name) => ({ name })) },
      });
    }
    writes.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/blacklist/add_submit")) created.blacklist.add(JSON.parse(init.body).name);
    if (url.endsWith("/whitelist/add_submit")) created.whitelist.add(JSON.parse(init.body).name);
    return jsonResponse({ code: 0, msg: "success" });
  };

  const rule = {
    name: "octobus_agent_test",
    if_in: "any",
    src_addrobj: "src",
    dst_addrobj: "dst",
    dst_servobj: "https_443",
    log: 1,
    log_level: 6,
    enable: 1,
    week_day: "7,",
    day_enable_time: "0-24",
    set_periodic: 1,
  };

  await (await loadHandler(createBlacklistPath, rule))();
  await (await loadHandler(setBlacklistEnabledPath, { name: rule.name, enable: 0 }))();
  await (await loadHandler(deleteBlacklistPath, { name: rule.name }))();
  await (await loadHandler(createWhitelistPath, rule))();
  await (await loadHandler(setWhitelistEnabledPath, { name: rule.name, enable: 0 }))();
  await (await loadHandler(deleteWhitelistPath, { name: rule.name }))();

  assert.equal(writes[0].url, "https://waf.example.local/blacklist/add_submit");
  assert.equal(writes[1].url, "https://waf.example.local/blacklist/enableItem");
  assert.deepEqual(writes[1].body, { mode: 2, name: rule.name, enable: 0 });
  assert.equal(writes[2].url, "https://waf.example.local/blacklist/delete");
  assert.equal(writes[3].url, "https://waf.example.local/whitelist/add_submit");
  assert.equal(writes[4].url, "https://waf.example.local/whitelist/enableItem");
  assert.deepEqual(writes[4].body, { mode: 1, name: rule.name, enable: 0 });
  assert.equal(writes[5].url, "https://waf.example.local/whitelist/delete");
});

test("BlockIP resolves an existing address object and verifies the created rule", async () => {
  const writes = [];
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.endsWith("/blacklist/add")) {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          if_in: ["gev0/1", "gev0/2"],
          servobj: ["http_80", "any"],
          addr: {
            obj: [
              { name: "any", item: [{ type: 1, net: "0.0.0.0/0" }] },
              { name: "obj_1_1_1_1", item: [{ type: 0, host: "1.1.1.1" }] },
            ],
          },
        },
      });
    }
    if (url.endsWith("/blacklist") && init.method === "GET") {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: { enable: 0, blacklist: [{ name: "octobus_block_1_1_1_1" }] },
      });
    }
    writes.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ code: 0, msg: "success" });
  };

  const handler = await loadHandler(blockIPPath, { ip: "1.1.1.1" });
  const res = await handler();

  assert.equal(res.ok, true);
  assert.equal(writes[0].url, "https://waf.example.local/blacklist/add_submit");
  assert.deepEqual(writes[0].body, {
    name: "octobus_block_1_1_1_1",
    if_in: "gev0/1",
    src_addrobj: "obj_1_1_1_1",
    dst_addrobj: "any",
    dst_servobj: "any",
    log: 1,
    log_level: 6,
    enable: 1,
    week_day: "7,",
    day_enable_time: "0-24",
    set_periodic: 1,
  });
});

test("BlockIP rejects invalid IPs and creates missing address objects", async () => {
  const { rpcdef } = await import("../src/venus-waf.js");
  await assert.rejects(
    () => rpcdef(buildCtx({ ip: "192.16.8.22.22" }))[blockIPPath](),
    /INVALID_ARGUMENT: ip must be a valid IPv4 address/,
  );

  const writes = [];
  let addressCreated = false;
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    if (url.endsWith("/blacklist/add")) {
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          if_in: ["gev0/1"],
          servobj: ["any"],
          addr: {
            obj: addressCreated
              ? [{ name: "octobus_addr_192_168_22_22", item: [{ type: 0, host: "192.168.22.22" }] }]
              : [],
          },
        },
      });
    }
    if (url.endsWith("/addressobject/addAddrObj")) {
      addressCreated = true;
      writes.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ code: 0, msg: "success" });
    }
    if (url.endsWith("/blacklist/add_submit")) {
      writes.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ code: 0, msg: "success" });
    }
    if (url.endsWith("/blacklist") && init.method === "GET") {
      return jsonResponse({ code: 0, msg: "success", data: { blacklist: [{ name: "octobus_block_192_168_22_22" }] } });
    }
    throw new Error("unexpected request");
  };

  const res = await rpcdef(buildCtx({ ip: "192.168.22.22" }))[blockIPPath]();
  assert.equal(res.ok, true);
  assert.deepEqual(writes[0], {
    url: "https://waf.example.local/addressobject/addAddrObj",
    body: {
      name: "octobus_addr_192_168_22_22",
      desc: "",
      item: [{ type: 0, host: "192.168.22.22", net: "", range1: "", range2: "" }],
    },
  });
  assert.equal(writes[1].url, "https://waf.example.local/blacklist/add_submit");
  assert.equal(writes[1].body.src_addrobj, "octobus_addr_192_168_22_22");
});

test("CreateAddressObject creates an IPv4 host object", async () => {
  const writes = [];
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    writes.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ code: 0, msg: "success" });
  };

  const res = await (await loadHandler(createAddressObjectPath, { ip: "2.2.2.2", name: "addr_2", desc: "" }))();
  assert.equal(res.ok, true);
  assert.deepEqual(writes[0], {
    url: "https://waf.example.local/addressobject/addAddrObj",
    body: {
      name: "addr_2",
      desc: "",
      item: [{ type: 0, host: "2.2.2.2", net: "", range1: "", range2: "" }],
    },
  });
});

test("ListAccessOptions maps selectable WAF objects", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, msg: "success", data: { authorization: "token-1" } });
    }
    assert.equal(url, "https://waf.example.local/blacklist/add");
    return jsonResponse({
      code: 0,
      msg: "success",
      data: {
        if_in: ["gev0/1"],
        servobj: ["any"],
        addr: { obj: [{ name: "src1", item: [{ host: "1.1.1.1" }, { net: "10.0.0.0/24" }] }] },
      },
    });
  };

  const res = await (await loadHandler(listAccessOptionsPath))();
  assert.deepEqual(res.interfaces, ["gev0/1"]);
  assert.deepEqual(res.service_objects, ["any"]);
  assert.equal(res.address_objects[0].name, "src1");
  assert.deepEqual(res.address_objects[0].hosts, ["1.1.1.1"]);
  assert.deepEqual(res.address_objects[0].networks, ["10.0.0.0/24"]);
});

test("upstream business auth error maps to UNAUTHENTICATED", async () => {
  global.fetch = async () => jsonResponse({ code: 266, msg: "用户名或密码错误", data: null });
  const handler = await loadHandler(healthPath);
  await assert.rejects(() => handler(), /UNAUTHENTICATED: 用户名或密码错误/);
});

test("all remaining write RPCs honor their proto paths and validate flags", async () => {
  const { rpcdef } = await import("../src/venus-waf.js");
  const writes = [];
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) {
      return jsonResponse({ code: 0, data: { authorization: "token" } });
    }
    writes.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    return jsonResponse({ code: 0, msg: "ok" });
  };
  const rule = {
    name: "r1", if_in: "any", src_addrobj: "src", dst_addrobj: "any", dst_servobj: "any",
  };
  const cases = [
    ["/Venus_WAF.Venus_WAF/UpdateBlacklist", rule, "/blacklist/edit_submit"],
    ["/Venus_WAF.Venus_WAF/DeleteBlockedIP", { name: "r1" }, "/blacklist/delete"],
    ["/Venus_WAF.Venus_WAF/SetBlacklistPriority", { priority: 1 }, "/blacklist/setpriority"],
    ["/Venus_WAF.Venus_WAF/UpdateWhitelist", rule, "/whitelist/edit_submit"],
    ["/Venus_WAF.Venus_WAF/DeleteAllowedIP", { name: "r1" }, "/whitelist/delete"],
    ["/Venus_WAF.Venus_WAF/SetWhitelistPriority", { priority: 0 }, "/whitelist/setpriority"],
  ];
  for (const [path, req, suffix] of cases) {
    await rpcdef(buildCtx(req))[path]();
    assert.equal(writes.at(-1).url, `https://waf.example.local${suffix}`);
  }
  await assert.rejects(() => rpcdef(buildCtx({ name: "r", enable: 2 }))[setBlacklistEnabledPath](), /enable must be 0 or 1/);
  await assert.rejects(() => rpcdef(buildCtx({ priority: 2 }))["/Venus_WAF.Venus_WAF/SetWhitelistPriority"](), /priority must be 0 or 1/);
  await assert.rejects(() => rpcdef(buildCtx({}))[deleteBlacklistPath](), /name is required/);
});

test("AllowIP supports an explicit source object and default rule values", async () => {
  const writes = [];
  global.fetch = async (url, init) => {
    if (url.endsWith("/api/mgr/login")) return jsonResponse({ code: 0, data: { authorization: "token" } });
    if (url.endsWith("/blacklist/add")) {
      return jsonResponse({ code: 0, data: { if_in: ["any"], servobj: ["any"], addr: { obj: [] } } });
    }
    if (url.endsWith("/whitelist") && init.method === "GET") {
      return jsonResponse({ code: 0, data: { blacklist: [{ name: "octobus_allow_8_8_8_8" }] } });
    }
    writes.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({ code: 0, msg: "ok" });
  };
  const handler = await loadHandler("/Venus_WAF.Venus_WAF/AllowIP", { ip: "8.8.8.8", src_addrobj: "dns" });
  assert.equal((await handler()).ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.src_addrobj, "dns");
});

test("HTTP authentication expiry refreshes credentials exactly once", async () => {
  let logins = 0;
  let lists = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/api/mgr/login")) {
      logins += 1;
      return jsonResponse({ code: 0, data: { authorization: `token-${logins}` } });
    }
    lists += 1;
    if (lists === 1) return jsonResponse({ error: "expired" }, { ok: false, status: 401 });
    return jsonResponse({ code: 0, data: { blacklist: [] } });
  };
  assert.deepEqual((await (await loadHandler(listBlacklistsPath))()).rules, []);
  assert.equal(logins, 2);
  assert.equal(lists, 2);
});

test("business authentication expiry refreshes credentials exactly once", async () => {
  let logins = 0;
  let lists = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/api/mgr/login")) {
      logins += 1;
      return jsonResponse({ code: 0, data: { authorization: `token-${logins}` } });
    }
    lists += 1;
    if (lists === 1) return jsonResponse({ code: 401, msg: "session expired" });
    return jsonResponse({ code: 0, data: { blacklist: [] } });
  };
  await (await loadHandler(listBlacklistsPath))();
  assert.equal(logins, 2);
});

test("configuration, login and malformed upstream failures are typed and sanitized", async () => {
  const { rpcdef } = await import("../src/venus-waf.js");
  await assert.rejects(() => rpcdef(buildCtx({}, { config: { baseUrl: "file:///etc/passwd" } }))[healthPath](), /baseUrl is required/);
  await assert.rejects(() => rpcdef(buildCtx({}, { config: { baseUrl: "https://user:pass@example.test" } }))[healthPath](), /baseUrl is required/);
  await assert.rejects(() => rpcdef(buildCtx({}, { config: { timeoutMs: 120001 } }))[healthPath](), /timeoutMs must be between/);
  await assert.rejects(() => rpcdef(buildCtx({}, { secret: { username: "" } }))[healthPath](), /username is required/);
  await assert.rejects(() => rpcdef(buildCtx({}, { secret: { password: "" } }))[healthPath](), /password is required/);

  global.fetch = async () => jsonResponse({ code: 0, data: {} });
  await assert.rejects(() => rpcdef(buildCtx())[healthPath](), /missing data.authorization/);
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "" }, text: async () => "not-json" });
  await assert.rejects(() => rpcdef(buildCtx())[healthPath](), /invalid JSON/);
  global.fetch = async () => { throw new Error("connect failed"); };
  await assert.rejects(() => rpcdef(buildCtx())[healthPath](), /UNAVAILABLE: connect failed/);
});

test("create verifies that upstream persisted the rule", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/api/mgr/login")) return jsonResponse({ code: 0, data: { authorization: "token" } });
    if (url.endsWith("/blacklist")) return jsonResponse({ code: 0, data: { blacklist: [] } });
    return jsonResponse({ code: 0, msg: "accepted" });
  };
  const rule = { name: "missing", if_in: "any", src_addrobj: "src", dst_addrobj: "any", dst_servobj: "any" };
  await assert.rejects(() => loadHandler(createBlacklistPath, rule).then((handler) => handler()), /was not found after create/);
});

test("SDK handler registry exposes every proto RPC with current call context", async () => {
  const { handlers } = await import("../src/venus-waf.js");
  assert.equal(Object.keys(handlers).length, 19);
  const rule = { name: "r", if_in: "any", src_addrobj: "src", dst_addrobj: "any", dst_servobj: "any" };
  for (const [name, handler] of Object.entries(handlers)) {
    let request = {};
    if (/CreateAddressObject/.test(name)) request = { ip: "1.2.3.4", name: "addr" };
    else if (/BlockIP|AllowIP/.test(name)) request = { ip: "1.2.3.4", src_addrobj: "src" };
    else if (/CreateBlacklist|UpdateBlacklist|CreateWhitelist|UpdateWhitelist/.test(name)) request = rule;
    else if (/Delete|Enabled/.test(name)) request = { name: "r", enable: 1 };
    else if (/Priority/.test(name)) request = { priority: 1 };
    await assert.rejects(() => handler({ request }), /baseUrl is required/);
  }
});

test("helper edge cases reject missing appliance options and map wrapped proto values", async () => {
  const { _test } = await import("../src/venus-waf.js");
  assert.deepEqual(_test.normalizeRule({ log: { value: 1 }, enable: "bad" }), {
    name: "", if_in: "", src_addrobj: "", dst_addrobj: "", dst_servobj: "",
    log: 1, log_level: 0, enable: 0, week_day: "", day_enable_time: "", set_periodic: 0,
  });
  assert.equal(_test.buildRulePayload({
    name: { value: "wrapped" }, if_in: "any", src_addrobj: "src", dst_addrobj: "any", dst_servobj: "any",
  }).name, "wrapped");
  const options = _test.normalizeAccessOptions({ data: { addr: { obj: [{ name: "range", item: [{ range1: "1.1.1.1", range2: "1.1.1.2" }] }] } } });
  assert.deepEqual(options.address_objects[0].ranges, ["1.1.1.1-1.1.1.2"]);
  assert.throws(() => _test.buildRuleFromIP({ ip: "1.1.1.1" }, { interfaces: [], service_objects: [], address_objects: [] }, "blacklist"), /no address object/);
  assert.throws(() => _test.buildRuleFromIP({ ip: "1.1.1.1", src_addrobj: "src" }, { interfaces: [], service_objects: [], address_objects: [] }, "blacklist"), /if_in has no available options/);
});

test("login maps HTTP client errors and accepts an empty success body only as missing auth", async () => {
  for (const [status, pattern] of [[403, /PERMISSION_DENIED/], [422, /FAILED_PRECONDITION/]]) {
    global.fetch = async () => ({ ok: false, status, headers: { get: () => "" }, text: async () => "denied" });
    await assert.rejects(() => loadHandler(healthPath).then((handler) => handler()), pattern);
  }
  global.fetch = async () => ({ ok: true, status: 204, headers: { get: () => "" }, text: async () => "" });
  await assert.rejects(() => loadHandler(healthPath).then((handler) => handler()), /upstream business error/);
});

test("insecure TLS option uses bounded node transport and preserves cookie auth", async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === "/api/mgr/login") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": ["SID=one; Path=/", "X=two; Path=/"] });
      res.end(JSON.stringify({ code: 0, data: { authorization: "auth" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: 0, data: { blacklist: [] } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const handler = await loadHandler(listBlacklistsPath, {}, { config: { baseUrl, insecureSkipTlsVerify: true } });
  assert.deepEqual((await handler()).rules, []);
  assert.equal(requests[1].headers.authorization, "auth");
  assert.match(requests[1].headers.cookie, /SID=one/);
});

test("legacy two-argument SDK handlers merge runtime context safely", async () => {
  const { _test } = await import("../src/venus-waf.js");
  global.fetch = async () => jsonResponse({ code: 0, data: { authorization: "token" } });
  const registered = _test.registerHandlers({ config: { baseUrl: "https://base.invalid" }, secret: { username: "u" } });
  const result = await registered[healthPath]({}, { config: { baseUrl: "https://waf.example.local" }, secret: { password: "p" } });
  assert.equal(result.ok, true);
});
