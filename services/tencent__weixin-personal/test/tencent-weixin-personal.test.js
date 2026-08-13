import assert from "node:assert/strict";
import test from "node:test";
import { handlers } from "../src/service.js";
import { rpcdef } from "../src/tencent-weixin-personal.js";
import { _test, DEFAULT_LOGIN_SESSION_TTL_MS } from "../src/tencent-weixin-personal.js";

const ctx = (request = {}, extra = {}) => ({
  request,
  config: { baseUrl: "https://ilink.example", loginBaseUrl: "https://login.example", timeoutMs: 100, longPollTimeoutMs: 100 },
  secret: { token: "secret-token", accountId: "bot-1" },
  ...extra,
});

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const withFetch = async (implementation, run) => {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); } finally { globalThis.fetch = previous; }
};

test("exports only the four upstream-backed RPC methods", () => {
  assert.deepEqual(Object.keys(handlers).sort(), ["FetchUpdates", "SendText", "StartLogin", "WaitLogin"].map((name) => `Tencent_WeixinPersonal.Tencent_WeixinPersonal/${name}`).sort());
});

test("StartLogin creates an expiring session without exposing credentials", async () => withFetch(async (url, init) => {
  assert.match(String(url), /get_bot_qrcode/);
  assert.deepEqual(JSON.parse(init.body).local_token_list, ["secret-token"]);
  return response({ qrcode: "qr-secret", qrcode_img_content: "https://scan.example/1" });
}, async () => {
  const result = await handlers["Tencent_WeixinPersonal.Tencent_WeixinPersonal/StartLogin"](ctx());
  assert.equal(result.qrcode, "qr-secret");
  assert.equal(result.expires_in_seconds, 600);
  assert.ok(result.session_key);
  assert.equal("token" in result, false);
}));

test("WaitLogin stores credentials internally and never returns the token", async () => {
  _test.state.loginSessions.set("login-1", { qrcode: "qr", baseUrl: "https://login.example", createdAt: Date.now() });
  await withFetch(async () => response({ status: "confirmed", bot_token: "new-token", ilink_bot_id: "bot-new", baseurl: "https://account.example" }), async () => {
    const result = await handlers["Tencent_WeixinPersonal.Tencent_WeixinPersonal/WaitLogin"](ctx({ session_key: "login-1", timeout_ms: 1 }, { secret: {} }));
    assert.deepEqual(result, { connected: true, account_id: "bot-new", status: "confirmed" });
    assert.equal(_test.state.credential.token, "new-token");
    assert.equal(JSON.stringify(result).includes("new-token"), false);
  });
});

test("WaitLogin handles terminal status and missing sessions", async () => {
  _test.state.loginSessions.set("expired-1", { qrcode: "qr", baseUrl: "https://login.example", createdAt: Date.now() });
  await withFetch(async () => response({ status: "expired" }), async () => {
    assert.deepEqual(await _test.waitLogin({ session_key: "expired-1", timeout_ms: 1 }, ctx()), { connected: false, status: "expired" });
  });
  await assert.rejects(() => _test.waitLogin({ session_key: "missing" }, ctx()), /not found or expired/);
});

test("WaitLogin follows redirects and returns a non-secret timeout result", async () => {
  _test.state.loginSessions.set("redirect-1", { qrcode: "qr", baseUrl: "https://login.example", createdAt: Date.now() });
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return response(calls === 1 ? { status: "scaned_but_redirect", redirect_host: "redirect.example" } : { status: "wait" });
  }, async () => {
    const result = await _test.waitLogin({ session_key: "redirect-1", timeout_ms: 1, verify_code: "123" }, ctx());
    assert.equal(result.connected, false);
    assert.equal(result.status, "scaned_but_redirect");
    assert.equal(_test.state.loginSessions.get("redirect-1").baseUrl, "https://redirect.example");
  });
});

test("FetchUpdates hits iLink and normalizes messages", async () => withFetch(async (url, init) => {
  assert.match(String(url), /getupdates/);
  assert.equal(init.headers.Authorization, "Bearer secret-token");
  return response({ get_updates_buf: "cursor-2", msgs: [{ message_id: 7, from_user_id: "u", item_list: [{ text_item: { text: "hello" } }] }] });
}, async () => {
  const result = await handlers["Tencent_WeixinPersonal.Tencent_WeixinPersonal/FetchUpdates"](ctx({ cursor: "cursor-1" }));
  assert.equal(result.cursor, "cursor-2");
  assert.equal(result.messages[0].local_id, "bot-1:7");
  assert.equal(result.messages[0].text, "hello");
}));

test("SendText validates input and sends text", async () => withFetch(async (url, init) => {
  assert.match(String(url), /sendmessage/);
  const payload = JSON.parse(init.body);
  assert.equal(payload.msg.to_user_id, "peer");
  assert.equal(payload.msg.context_token, "context");
  return response({ ret: 0 });
}, async () => {
  const result = await handlers["Tencent_WeixinPersonal.Tencent_WeixinPersonal/SendText"](ctx({ to_user_id: "peer", message: "hi", context_token: "context" }));
  assert.equal(result.success, true);
  await assert.rejects(() => _test.sendText({ message: "hi" }, ctx()), /to_user_id is required/);
}));

test("HTTP errors, business errors, invalid JSON, and network errors are mapped", async () => {
  await withFetch(async () => response({}, 401), () => assert.rejects(() => _test.fetchUpdates({}, ctx()), /iLink HTTP 401/));
  await withFetch(async () => response({ errcode: 403, errmsg: "denied" }), () => assert.rejects(() => _test.fetchUpdates({}, ctx()), /denied/));
  await withFetch(async () => ({ ok: true, status: 200, text: async () => "bad" }), () => assert.rejects(() => _test.fetchUpdates({}, ctx()), /not valid JSON/));
  await withFetch(async () => { throw new Error("offline"); }, () => assert.rejects(() => _test.fetchUpdates({}, ctx()), /offline/));
  await withFetch(async () => response({ errcode: 401 }), () => assert.rejects(() => _test.fetchUpdates({}, ctx()), /iLink error/));
});

test("session pruning applies TTL and capacity", () => {
  _test.state.loginSessions.clear();
  _test.state.loginSessions.set("old", { createdAt: Date.now() - DEFAULT_LOGIN_SESSION_TTL_MS - 1 });
  _test.pruneSessions();
  assert.equal(_test.state.loginSessions.has("old"), false);
  for (let index = 0; index < 32; index += 1) _test.state.loginSessions.set(String(index), { createdAt: Date.now() });
  _test.pruneSessions();
  assert.equal(_test.state.loginSessions.size, 31);
});

test("URL and message normalization reject unsafe schemes and preserve raw input", () => {
  assert.equal(_test.normalizeBaseUrl("https://example.test/path/?x=1#x"), "https://example.test/path");
  assert.throws(() => _test.normalizeBaseUrl("file:///tmp/token"), /HTTP\/HTTPS/);
  assert.throws(() => _test.normalizeBaseUrl("not a url"), /valid HTTP\/HTTPS/);
  const normalized = _test.normalizeMessage({ seq: 2, voice_item: {}, item_list: [{ voice_item: { text: "voice" } }] }, 0, "bot");
  assert.equal(normalized.text, "voice");
});

test("legacy rpcdef adapter invokes handlers and missing credentials fail closed", async () => {
  const definitions = rpcdef(ctx());
  assert.equal(Object.keys(definitions).length, 4);
  _test.state.credential = null;
  await assert.rejects(() => _test.fetchUpdates({}, ctx({}, { secret: {} })), /token is required/);
});

test("protobuf wrapper scalars from the runtime are unwrapped", async () => withFetch(async (url) => {
  assert.match(String(url), /ilink\.example/);
  return response({ msgs: [] });
}, async () => {
  const result = await _test.fetchUpdates({}, {
    config: { baseUrl: { value: "https://ilink.example" }, longPollTimeoutMs: { value: 10 } },
    secret: { token: { value: "wrapped-token" } },
  });
  assert.deepEqual(result.messages, []);
}));
