import assert from "node:assert/strict";
import test from "node:test";

import { handlers } from "../src/sangfor-fw-v8-0-95.js";
import { startMockUpstream } from "./mock_upstream.js";

const baseCtx = (baseUrl) => ({
  config: {
    host: baseUrl,
    namespace: "public",
    timeoutMs: 1000,
  },
  secret: {
    username: "mock-user",
    password: "mock-password",
  },
});

test("login, keepalive, and logout map Sangfor auth endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const login = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Login"]({}, ctx);
    assert.equal(login.code, 0);
    assert.equal(login.token, "mock-token");

    const keepAlive = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/KeepAlive"]({ token: login.token }, ctx);
    assert.equal(keepAlive.code, 0);

    const logout = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/Logout"]({ token: login.token }, ctx);
    assert.equal(logout.code, 0);
    assert.equal(upstream.state.keepAlives, 1);
    assert.equal(upstream.state.logouts, 1);
  } finally {
    await upstream.close();
  }
});

test("blacklist add, list, and remove use documented batch endpoints", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const add = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/AddBlacklist"]({
      targets: ["192.0.2.10", "example.test"],
      description: "test",
    }, ctx);
    assert.equal(add.code, 0);
    assert.equal(upstream.state.blacklist.length, 2);

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlackWhiteList"]({ type: "BLACK" }, ctx);
    assert.equal(list.data.itemLength, 2);

    const remove = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/RemoveBlacklist"]({
      targets: ["192.0.2.10"],
    }, ctx);
    assert.equal(remove.code, 0);
    assert.equal(upstream.state.blacklist.length, 1);
  } finally {
    await upstream.close();
  }
});

test("block IP, unblock IP, and block time map documented operation center APIs", async () => {
  const upstream = await startMockUpstream();
  try {
    const ctx = baseCtx(upstream.baseUrl);
    const block = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/BlockIP"]({
      src_ips: ["198.51.100.10"],
      block_time: "3d",
    }, ctx);
    assert.equal(block.code, 0);
    assert.equal(upstream.state.blockIp[0].ipType, "SRC");
    assert.deepEqual(upstream.state.blockIp[0].srcIP, ["198.51.100.10"]);

    const list = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/ListBlockedIP"]({}, ctx);
    assert.equal(list.data.itemLength, 1);

    const setTime = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/SetBlockTime"]({
      block_time: "2h",
    }, ctx);
    assert.equal(setTime.data.blockTime, "2h");

    const getTime = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/GetBlockTime"]({}, ctx);
    assert.equal(getTime.data.blockTime, "2h");

    const unblock = await handlers["Sangfor_FW_V8095.Sangfor_FW_V8095/UnblockIP"]({
      items: [{ src_ip: "198.51.100.10" }],
    }, ctx);
    assert.equal(unblock.code, 0);
    assert.equal(upstream.state.blockIp.length, 0);
  } finally {
    await upstream.close();
  }
});
