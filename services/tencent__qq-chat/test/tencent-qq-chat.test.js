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
