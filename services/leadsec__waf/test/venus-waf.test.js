import test from "node:test";
import assert from "node:assert/strict";

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
  assert.equal(calls[0].init.insecureSkipVerify, false);
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
