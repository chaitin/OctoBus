import assert from "node:assert/strict";
import test from "node:test";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_ACK_MESSAGE_PATH,
  METHOD_GET_GATEWAY_STATUS_PATH,
  METHOD_GET_ACCESS_TOKEN_PATH,
  METHOD_NORMALIZE_EVENT_FULL,
  METHOD_NORMALIZE_EVENT_PATH,
  METHOD_POLL_MESSAGES_PATH,
  METHOD_SEND_C2C_MESSAGE_FULL,
  METHOD_SEND_C2C_MESSAGE_PATH,
  METHOD_SEND_GROUP_MESSAGE_PATH,
  METHOD_START_GATEWAY_PATH,
  METHOD_STOP_GATEWAY_PATH,
  _test,
  handlers,
  rpcdef,
} from "../src/tencent-qq-chat.js";
import { service } from "../src/service.js";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

const response = (status, body) => ({
  status,
  text: async () => body,
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    baseUrl: "https://api.sgroup.qq.com",
    tokenUrl: "https://bots.qq.com/app/getAppAccessToken",
    ...(overrides.config || {}),
  },
  secret: {
    appId: "app-1",
    appSecret: "secret-1",
    ...(overrides.secret || {}),
  },
  bindings: overrides.bindings || {},
  limits: { timeoutMs: 1000, ...(overrides.limits || {}) },
  req: overrides.req || {},
});

const expectGrpcError = async (fn, legacyCode, code) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected function to reject");
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, code);
  return caught;
};

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  _test.tokenCache.clear();
  await _test.stopGateway();
  _test.gatewayState.queue = [];
  _test.gatewayState.droppedMessages = 0;
  _test.gatewayState.localMessageSeq = 0;
});

test("service exports defineService result and handlers", () => {
  assert.equal(typeof service, "object");
  assert.equal(typeof handlers[METHOD_SEND_C2C_MESSAGE_FULL], "function");
  assert.equal(typeof handlers[METHOD_NORMALIZE_EVENT_FULL], "function");
});

test("GetAccessToken posts AppID and AppSecret to official token endpoint", async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({
      access_token: "access-1",
      expires_in: "7200",
    }));
  });

  const result = await rpcdef(buildCtx())[METHOD_GET_ACCESS_TOKEN_PATH]({});

  assert.equal(captured.url, "https://bots.qq.com/app/getAppAccessToken");
  assert.equal(captured.init.method, "POST");
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in captured.init, false);
  assert.deepEqual(JSON.parse(captured.init.body), {
    appId: "app-1",
    clientSecret: "secret-1",
  });
  assert.equal(result.success, true);
  assert.equal(result.access_token, "access-1");
  assert.equal(result.expires_in, 7200);
});

test("SendC2CMessage fetches token and posts to /v2/users/{openid}/messages", async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return response(200, JSON.stringify({
        access_token: "access-1",
        expires_in: 7200,
      }));
    }
    return response(200, JSON.stringify({
      id: "msg-1",
      timestamp: 1710000000,
    }));
  });

  const result = await rpcdef(buildCtx())[METHOD_SEND_C2C_MESSAGE_PATH]({
    openid: "USER_OPENID",
    content: "hello",
    msg_id: "incoming-1",
    msg_seq: 2,
  });

  assert.equal(calls.length, 2);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in calls[0].init, false);
  assert.equal(calls[1].url, "https://api.sgroup.qq.com/v2/users/USER_OPENID/messages");
  assert.ok(calls[1].init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in calls[1].init, false);
  assert.equal(calls[1].init.headers.authorization, "QQBot access-1");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    msg_type: 0,
    content: "hello",
    msg_id: "incoming-1",
    msg_seq: 2,
  });
  assert.equal(result.success, true);
  assert.equal(result.id, "msg-1");
  assert.equal(result.timestamp, "1710000000");
});

test("SendGroupMessage uses configured access token and rich message JSON fields", async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({
      id: "group-msg-1",
      timestamp: "2026-06-29T12:00:00+08:00",
    }));
  });

  const result = await rpcdef(buildCtx({
    secret: {
      accessToken: "configured-token",
    },
  }))[METHOD_SEND_GROUP_MESSAGE_PATH]({
    groupOpenid: "GROUP_OPENID",
    content: "# title",
    msgType: 2,
    markdownJson: '{"content":"# title"}',
    keyboardJson: '{"id":"keyboard-template"}',
    eventId: "event-1",
  });

  assert.equal(captured.url, "https://api.sgroup.qq.com/v2/groups/GROUP_OPENID/messages");
  assert.equal(captured.init.headers.authorization, "QQBot configured-token");
  assert.deepEqual(JSON.parse(captured.init.body), {
    msg_type: 2,
    content: "# title",
    markdown: { content: "# title" },
    keyboard: { id: "keyboard-template" },
    event_id: "event-1",
  });
  assert.equal(result.id, "group-msg-1");
});

test("OpenAPI refreshes a cached app token once after HTTP 401", async () => {
  const calls = [];
  setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response(200, JSON.stringify({ access_token: "stale-token", expires_in: 7200 }));
    if (calls.length === 2) return response(401, JSON.stringify({ code: 401, message: "expired" }));
    if (calls.length === 3) return response(200, JSON.stringify({ access_token: "fresh-token", expires_in: 7200 }));
    return response(200, JSON.stringify({ id: "msg-refreshed", timestamp: 123 }));
  });

  const result = await rpcdef(buildCtx())[METHOD_SEND_C2C_MESSAGE_PATH]({
    openid: "USER_OPENID",
    content: "hello",
  });

  assert.equal(result.id, "msg-refreshed");
  assert.equal(calls.length, 4);
  assert.equal(calls[1].init.headers.authorization, "QQBot stale-token");
  assert.equal(calls[3].init.headers.authorization, "QQBot fresh-token");
});

test("NormalizeEvent maps official C2C and group payloads", async () => {
  const c2cPayload = {
    id: "event-1",
    op: 0,
    s: 42,
    t: "C2C_MESSAGE_CREATE",
    d: {
      id: "ROBOT1.0_msg",
      content: "hello",
      timestamp: "2023-11-06T13:37:18+08:00",
      author: {
        user_openid: "USER_OPENID",
      },
    },
  };

  const c2c = await rpcdef(buildCtx())[METHOD_NORMALIZE_EVENT_PATH]({
    payload_json: JSON.stringify(c2cPayload),
  });

  assert.equal(c2c.is_message, true);
  assert.equal(c2c.is_c2c, true);
  assert.equal(c2c.is_group, false);
  assert.equal(c2c.event_id, "event-1");
  assert.equal(c2c.event_type, "C2C_MESSAGE_CREATE");
  assert.equal(c2c.message_id, "ROBOT1.0_msg");
  assert.equal(c2c.openid, "USER_OPENID");

  const group = await _test.handleNormalizeEvent({
    payload: {
      t: "GROUP_AT_MESSAGE_CREATE",
      d: {
        id: "group-msg",
        group_openid: "GROUP_OPENID",
        content: " at bot",
        author: {
          member_openid: "MEMBER_OPENID",
          member_role: "owner",
        },
      },
    },
  });

  assert.equal(group.is_group, true);
  assert.equal(group.group_openid, "GROUP_OPENID");
  assert.equal(group.openid, "MEMBER_OPENID");
  assert.ok(group.author_json.includes("member_role"));
});

test("Gateway receiver starts, buffers messages, polls, and acks", async () => {
  const fetchCalls = [];
  setFetch(async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return response(200, JSON.stringify({
      url: "wss://api.sgroup.qq.com/websocket",
      shards: 1,
    }));
  });

  class FakeWebSocket {
    static OPEN = 1;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      this.sent = [];
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(name, callback) {
      const listeners = this.listeners.get(name) || [];
      listeners.push(callback);
      this.listeners.set(name, listeners);
    }

    send(data) {
      this.sent.push(JSON.parse(data));
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }

    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
  }

  globalThis.WebSocket = FakeWebSocket;

  const ctx = buildCtx({
    secret: { accessToken: "gateway-token" },
    config: {
      baseUrl: "https://api.sgroup.qq.com",
      gatewayIntents: 1 << 25,
      maxBufferedMessages: 5,
    },
  });

  const start = await rpcdef(ctx)[METHOD_START_GATEWAY_PATH]({});
  assert.equal(start.running, true);
  assert.equal(fetchCalls[0].url, "https://api.sgroup.qq.com/gateway/bot");
  assert.ok(fetchCalls[0].init.signal instanceof AbortSignal);
  assert.equal("timeoutMs" in fetchCalls[0].init, false);

  const socket = FakeWebSocket.instances[0];
  socket.emit("message", {
    data: JSON.stringify({
      op: 10,
      d: { heartbeat_interval: 100000 },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(socket.sent[0], {
    op: 2,
    d: {
      token: "QQBot gateway-token",
      intents: 1 << 25,
      shard: [0, 1],
      properties: {},
    },
  });

  socket.emit("message", {
    data: JSON.stringify({
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "session-1" },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  socket.emit("message", {
    data: JSON.stringify({
      id: "event-1",
      op: 0,
      s: 2,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "msg-1",
        content: "hello",
        author: { user_openid: "USER_OPENID" },
      },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const status = await rpcdef(ctx)[METHOD_GET_GATEWAY_STATUS_PATH]({});
  assert.equal(status.ready, true);
  assert.equal(status.session_id, "session-1");
  assert.equal(status.queue_size, 1);

  const polled = await rpcdef(ctx)[METHOD_POLL_MESSAGES_PATH]({ max_messages: 10 });
  assert.equal(polled.messages.length, 1);
  assert.equal(polled.messages[0].event.event_type, "C2C_MESSAGE_CREATE");
  assert.equal(polled.messages[0].event.openid, "USER_OPENID");

  const acked = await rpcdef(ctx)[METHOD_ACK_MESSAGE_PATH]({ localId: [polled.messages[0].local_id] });
  assert.equal(acked.acked, 1);
  assert.equal(acked.queue_size, 0);

  const stopped = await rpcdef(ctx)[METHOD_STOP_GATEWAY_PATH]({});
  assert.equal(stopped.running, false);
});

test("Gateway ignores stale close events after reconnecting a newer socket", async () => {
  setFetch(async () => response(200, JSON.stringify({
    url: "wss://api.sgroup.qq.com/websocket",
    shards: 1,
  })));

  class FakeWebSocket {
    static OPEN = 1;
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(name, callback) {
      const listeners = this.listeners.get(name) || [];
      listeners.push(callback);
      this.listeners.set(name, listeners);
    }

    send() {}

    close() {
      this.readyState = 3;
      queueMicrotask(() => this.emit("close", {}));
    }

    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
  }

  globalThis.WebSocket = FakeWebSocket;

  const ctx = buildCtx({
    secret: { accessToken: "gateway-token" },
    config: {
      baseUrl: "https://api.sgroup.qq.com",
      gatewayReconnectMs: 100,
    },
  });

  await rpcdef(ctx)[METHOD_START_GATEWAY_PATH]({});
  const firstSocket = FakeWebSocket.instances[0];
  assert.equal(_test.gatewayState.ws, firstSocket);

  await _test.connectGateway();
  const secondSocket = FakeWebSocket.instances[1];
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(_test.gatewayState.ws, secondSocket);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(_test.gatewayState.ws, secondSocket);
  assert.equal(_test.gatewayState.reconnectTimer, null);
  assert.equal(_test.gatewayState.reconnectCount, 0);
});

test("Gateway resumes a known session and reconnects after a missed heartbeat ack", async () => {
  setFetch(async () => response(200, JSON.stringify({ url: "wss://api.sgroup.qq.com/websocket" })));

  class FakeWebSocket {
    static OPEN = 1;
    static instances = [];
    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      this.sent = [];
      FakeWebSocket.instances.push(this);
    }
    addEventListener(name, callback) {
      const listeners = this.listeners.get(name) || [];
      listeners.push(callback);
      this.listeners.set(name, listeners);
    }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket;

  const ctx = buildCtx({
    secret: { accessToken: "gateway-token" },
    config: { baseUrl: "https://api.sgroup.qq.com", gatewayReconnectMs: 100 },
  });
  _test.gatewayState.sessionId = "session-known";
  _test.gatewayState.seq = 42;
  await rpcdef(ctx)[METHOD_START_GATEWAY_PATH]({});
  // startGateway intentionally starts a new session; populate resumable state before HELLO.
  _test.gatewayState.sessionId = "session-known";
  _test.gatewayState.seq = 42;
  const socket = FakeWebSocket.instances[0];
  await _test.gatewayState.ws.listeners.get("message")[0]({
    data: JSON.stringify({ op: 10, d: { heartbeat_interval: 100000 } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(socket.sent[0], {
    op: 6,
    d: { token: "QQBot gateway-token", session_id: "session-known", seq: 42 },
  });

  _test.sendHeartbeat();
  assert.equal(_test.gatewayState.awaitingHeartbeatAck, true);
  _test.sendHeartbeat();
  assert.match(_test.gatewayState.lastError, /heartbeat acknowledgement timed out/);
  assert.ok(_test.gatewayState.reconnectTimer);
});

test("Gateway startup failure is recoverable and maps network errors", async () => {
  setFetch(async () => { throw new Error("socket unavailable"); });
  const status = await rpcdef(buildCtx({
    secret: { accessToken: "gateway-token" },
    config: { gatewayReconnectMs: 100 },
  }))[METHOD_START_GATEWAY_PATH]({});

  assert.equal(status.running, true);
  assert.equal(status.state, "reconnecting");
  assert.match(status.last_error, /gateway request failed/);
  assert.ok(_test.gatewayState.reconnectTimer);
});

test("SDK handlers read ctx.request", async () => {
  setFetch(async () => response(200, JSON.stringify({
    id: "msg-sdk",
    timestamp: 123,
  })));

  const result = await handlers[METHOD_SEND_C2C_MESSAGE_FULL]({
    request: { openid: "USER_OPENID", content: "hello" },
    config: { baseUrl: "https://api.sgroup.qq.com" },
    secret: { accessToken: "token-sdk" },
  });

  assert.equal(result.id, "msg-sdk");
});

test("validation and upstream failures map to gRPC errors", async () => {
  await expectGrpcError(
    () => rpcdef({ config: {}, secret: {} })[METHOD_SEND_C2C_MESSAGE_PATH]({ openid: "1", content: "x" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { accessToken: "token" } }))[METHOD_SEND_C2C_MESSAGE_PATH]({ openid: "", content: "x" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { accessToken: "token" } }))[METHOD_SEND_GROUP_MESSAGE_PATH]({
      group_openid: "g",
      msg_type: 0,
      content: "",
    }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  setFetch(async () => response(429, JSON.stringify({
    code: 22009,
    message: "msg limit exceed",
  })));

  const err = await expectGrpcError(
    () => rpcdef(buildCtx({ secret: { accessToken: "token" } }))[METHOD_SEND_C2C_MESSAGE_PATH]({ openid: "1", content: "x" }),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(err.httpStatus, 429);
  assert.equal(err.responseCode, 22009);
});

test("helpers cover token cache, invalid JSON, and URL normalization", async () => {
  assert.equal(_test.buildApiUrl("https://api.sgroup.qq.com", "v2/users/u/messages"), "https://api.sgroup.qq.com/v2/users/u/messages");
  assert.equal(_test.normalizeBaseUrl("https://api.sgroup.qq.com/", "", "baseUrl"), "https://api.sgroup.qq.com");
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: "1234" } }), 1234);
  assert.throws(() => _test.buildJsonObject("[1]", "markdown_json"), /JSON object/);
  assert.throws(() => _test.parseJsonBody("{"), /not valid JSON/);

  const key = _test.tokenCacheKey("url", "app", "secret");
  _test.writeTokenCache(key, "cached", 7200, 1000);
  assert.equal(_test.readTokenCache(key, 1000), "cached");
  assert.equal(_test.readTokenCache(key, 7200 * 1000), "");
});

test("helpers validate configuration, payload variants, and error mappings", async () => {
  assert.equal(_test.toBoolean("yes"), true);
  assert.equal(_test.toBoolean("off"), false);
  assert.equal(_test.toBoolean(2), true);
  assert.equal(_test.toBoolean({ value: "true" }), true);
  assert.equal(_test.optionalUint32("12.9"), 12);
  assert.equal(_test.optionalUint32(-1), undefined);
  assert.equal(_test.optionalInt32("-2.8"), -2);
  assert.equal(_test.optionalInt32("bad"), undefined);
  assert.equal(_test.resolveGatewayShardIndex({ gateway_shard_index: 0 }), 0);
  assert.equal(_test.resolveGatewayShardCount({ gateway_shard_count: 0 }), 1);
  assert.equal(_test.resolveMaxBufferedMessages({ max_buffered_messages: 2 }), 2);
  assert.equal(_test.eventData({ content: "plain" }).content, "plain");
  assert.throws(() => _test.normalizeBaseUrl("ftp://host", "", "baseUrl"), /HTTP\/HTTPS/);
  assert.throws(() => _test.normalizeBaseUrl("not a url", "", "baseUrl"), /HTTP\/HTTPS/);
  assert.equal(_test.mapHttpStatusToCode(401), "UNAUTHENTICATED");
  assert.equal(_test.mapHttpStatusToCode(403), "PERMISSION_DENIED");
  assert.equal(_test.mapHttpStatusToCode(500), "UNAVAILABLE");
  assert.equal(_test.mapErrorBodyToCode({ code: 11264 }), "PERMISSION_DENIED");
  assert.equal(_test.mapErrorBodyToCode({ code: 123 }), "FAILED_PRECONDITION");
  assert.equal(_test.mapErrorBodyToCode({}), "UNKNOWN");

  assert.deepEqual(_test.buildMessagePayload({
    msg_type: 2,
    ark_json: '{"template_id":1}',
    media_json: '{"file_info":"x"}',
    message_reference_json: '{"message_id":"m"}',
    is_wakeup: true,
  }, { allowWakeup: true }), {
    msg_type: 2,
    ark: { template_id: 1 },
    media: { file_info: "x" },
    message_reference: { message_id: "m" },
    is_wakeup: true,
  });
  assert.throws(() => _test.buildJsonObject("null", "ark_json"), /JSON object/);
  await expectGrpcError(
    () => _test.handleNormalizeEvent({ payload_json: "[]" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );
});

test("token, OpenAPI, gateway, and queue failures remain typed", async () => {
  setFetch(async () => response(403, JSON.stringify({ code: 11264, message: "denied" })));
  const tokenError = await expectGrpcError(
    () => _test.fetchAppAccessToken(buildCtx(), true),
    "PERMISSION_DENIED",
    grpcStatus.PERMISSION_DENIED,
  );
  assert.equal(tokenError.responseCode, 11264);

  setFetch(async () => response(200, "not-json"));
  await expectGrpcError(
    () => _test.callOpenApi(buildCtx({ secret: { accessToken: "token" } }), "/v2/users/u/messages", {}),
    "UNKNOWN",
    grpcStatus.UNKNOWN,
  );

  setFetch(async () => response(200, JSON.stringify({ code: 11263, message: "expired" })));
  await expectGrpcError(
    () => _test.callOpenApi(buildCtx({ secret: { accessToken: "token" } }), "/v2/users/u/messages", {}),
    "UNAUTHENTICATED",
    grpcStatus.UNAUTHENTICATED,
  );

  setFetch(async () => response(200, JSON.stringify({}))); 
  await expectGrpcError(
    () => _test.fetchGatewayInfo(buildCtx(), "token"),
    "UNKNOWN",
    grpcStatus.UNKNOWN,
  );

  _test.gatewayState.queue = [
    { local_id: "1" }, { local_id: "2" }, { local_id: "3" },
  ];
  assert.equal(_test.pollMessages({ max_messages: 2, ack: true }).queue_size, 1);
  assert.deepEqual(await _test.handleAckMessage({ all: true }), { acked: 1, queue_size: 0 });
});

test("Gateway protocol handles ACK, invalid sessions, ignored events, and bounded queues", async () => {
  _test.gatewayState.running = true;
  _test.gatewayState.awaitingHeartbeatAck = true;
  await _test.handleGatewayPayload({ op: 11 }, "token");
  assert.equal(_test.gatewayState.awaitingHeartbeatAck, false);
  assert.ok(_test.gatewayState.lastHeartbeatAckAt);

  _test.gatewayState.sessionId = "old-session";
  _test.gatewayState.seq = 9;
  await _test.handleGatewayPayload({ op: 9 }, "token");
  assert.equal(_test.gatewayState.sessionId, "");
  assert.equal(_test.gatewayState.seq, null);
  assert.ok(_test.gatewayState.reconnectTimer);
  _test.clearGatewayTimers();

  await _test.handleGatewayPayload({ op: 42, t: "IGNORED" }, "token");
  assert.equal(_test.gatewayState.lastEventType, "IGNORED");

  _test.gatewayState.ctx = { bindings: { maxBufferedMessages: 1 } };
  await _test.enqueueGatewayMessage({
    t: "C2C_MESSAGE_CREATE",
    d: { id: "one", content: "one", author: { user_openid: "u" } },
  });
  await _test.enqueueGatewayMessage({
    t: "C2C_MESSAGE_CREATE",
    d: { id: "two", content: "two", author: { user_openid: "u" } },
  });
  assert.equal(_test.gatewayState.queue.length, 1);
  assert.equal(_test.gatewayState.droppedMessages, 1);
});

test("configured token bypasses refresh and transport failures stay unavailable", async () => {
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    if (calls === 1) return response(401, JSON.stringify({ code: 401 }));
    throw new Error("must not retry configured token");
  });
  await expectGrpcError(
    () => _test.callOpenApi(buildCtx({ secret: { accessToken: "fixed" } }), "/v2/users/u/messages", {}),
    "UNAUTHENTICATED",
    grpcStatus.UNAUTHENTICATED,
  );
  assert.equal(calls, 1);

  setFetch(async () => { throw new Error("network down"); });
  await expectGrpcError(
    () => _test.fetchAppAccessToken(buildCtx(), true),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  await expectGrpcError(
    () => _test.callOpenApi(buildCtx({ secret: { accessToken: "fixed" } }), "/v2/users/u/messages", {}),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
});

test("runtime auto-start ignores normal commands and disabled configuration", async () => {
  assert.equal(await _test.maybeAutoStartGatewayFromCli(["help"]), false);
  assert.equal(await _test.maybeAutoStartGatewayFromCli(["--runtime", "serve", "--config-json", "{}"]), false);
  assert.deepEqual(_test.parseRuntimeJsonArg(["--config-json", '{"a":1}'], "--config-json"), { a: 1 });
  assert.deepEqual(_test.parseRuntimeJsonArg(['--config-json={"a":2}'], "--config-json"), { a: 2 });
  assert.equal(_test.parseRuntimeJsonArg([], "--config-json"), undefined);
  assert.equal(_test.parseRuntimeFileArg([], "--config"), undefined);
});

test("Gateway socket events expose errors and reconnect after abnormal close", async () => {
  setFetch(async () => response(200, JSON.stringify({ url: "wss://gateway" })));
  class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    send() {}
    close() { this.readyState = 3; }
    emit(name, event = {}) { this.listeners.get(name)?.(event); }
  }
  globalThis.WebSocket = FakeWebSocket;
  const ctx = buildCtx({
    secret: { accessToken: "token" },
    config: { gatewayReconnectMs: 100 },
  });
  await _test.startGateway(ctx);
  const socket = _test.gatewayState.ws;
  socket.emit("open");
  assert.equal(_test.gatewayState.state, "open");
  socket.emit("error", { message: "ws broke" });
  assert.equal(_test.gatewayState.lastError, "ws broke");
  socket.emit("message", { data: "not-json" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(_test.gatewayState.lastError, /JSON/);
  socket.emit("close");
  assert.equal(_test.gatewayState.ws, null);
  assert.equal(_test.gatewayState.state, "reconnecting");
  assert.ok(_test.gatewayState.reconnectTimer);
});

test("configured token response and missing WebSocket runtime are explicit", async () => {
  const token = await _test.fetchAppAccessToken(buildCtx({ secret: { accessToken: "fixed" } }));
  assert.deepEqual(token, {
    success: true, http_status: 0, access_token: "fixed", expires_in: 0, http_body: "",
  });
  setFetch(async () => response(200, JSON.stringify({ url: "wss://gateway" })));
  globalThis.WebSocket = undefined;
  _test.gatewayState.running = true;
  _test.gatewayState.ctx = buildCtx({ secret: { accessToken: "fixed" } });
  await expectGrpcError(
    () => _test.connectGateway(),
    "FAILED_PRECONDITION",
    grpcStatus.FAILED_PRECONDITION,
  );
});

test("gateway connect and close guards are idempotent", async () => {
  _test.gatewayState.running = false;
  _test.gatewayState.ctx = null;
  assert.equal(await _test.connectGateway(), undefined);
  assert.equal(_test.gatewayState.reconnectTimer, null);

  _test.gatewayState.ws = { close() { throw new Error("already closed"); } };
  assert.doesNotThrow(() => _test.closeGatewaySocket());
  assert.equal(_test.gatewayState.ws, null);

  _test.gatewayState.running = true;
  const second = await _test.startGateway(buildCtx({ secret: { accessToken: "fixed" } }));
  assert.equal(second.running, true);
});
