import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_ACK_MESSAGE_PATH,
  METHOD_FETCH_UPDATES_PATH,
  METHOD_NORMALIZE_MESSAGE_FULL,
  METHOD_NORMALIZE_MESSAGE_PATH,
  METHOD_POLL_MESSAGES_PATH,
  METHOD_SEND_TEXT_FULL,
  METHOD_SEND_TEXT_PATH,
  METHOD_START_LOGIN_PATH,
  METHOD_START_RECEIVER_PATH,
  METHOD_STOP_RECEIVER_PATH,
  METHOD_WAIT_LOGIN_PATH,
  _test,
  handlers,
  rpcdef,
} from "../src/tencent-weixin-personal.js";
import { service } from "../src/service.js";

const originalFetch = globalThis.fetch;

const response = (status, body) => ({
  status,
  text: async () => body,
});

const setFetch = (impl) => {
  globalThis.fetch = impl;
};

const buildCtx = (overrides = {}) => ({
  config: {
    loginBaseUrl: "https://ilinkai.weixin.qq.com",
    baseUrl: "https://ilinkai.weixin.qq.com",
    accountId: "bot-1@im.bot",
    botAgent: "OctoBusTest/1.0.0",
    ...(overrides.config || {}),
  },
  secret: {
    token: "token-1",
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
  await _test.stopAutoLogin();
  await _test.stopReceiver();
  _test.loginSessions.clear();
  Object.assign(_test.runtimeCredentials, {
    connected: false,
    accountId: "",
    userId: "",
    baseUrl: "",
    token: "",
    connectedAt: "",
  });
  Object.assign(_test.autoLoginState, {
    running: false,
    state: "stopped",
    sessionKey: "",
    lastStatus: "",
    lastError: "",
    startedAt: "",
    connectedAt: "",
    promise: null,
  });
  _test.receiverState.queue = [];
  _test.receiverState.droppedMessages = 0;
  _test.receiverState.localMessageSeq = 0;
  _test.receiverState.pollCount = 0;
});

test("service exports defineService result and handlers", () => {
  assert.equal(typeof service, "object");
  assert.equal(typeof handlers[METHOD_SEND_TEXT_FULL], "function");
  assert.equal(typeof handlers[METHOD_NORMALIZE_MESSAGE_FULL], "function");
});

test("StartLogin posts QR request and stores login session", async () => {
  let captured;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({
      qrcode: "qr-1",
      qrcode_img_content: "https://scan.example/qr-1",
    }));
  });

  let result;
  try {
    result = await rpcdef(buildCtx())[METHOD_START_LOGIN_PATH]({ botType: "3" });
  } finally {
    console.log = originalLog;
  }

  assert.equal(captured.url, "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3");
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(JSON.parse(captured.init.body), {
    local_token_list: ["token-1"],
  });
  assert.equal(result.qrcode, "qr-1");
  assert.equal(result.qrcode_url, "https://scan.example/qr-1");
  assert.ok(result.qrcode_terminal.includes("▄▄"));
  assert.ok(logs.some((line) => line.includes("scan this QR code")));
  assert.ok(_test.loginSessions.has(result.session_key));
});

test("StartLogin can suppress terminal QR printing", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  setFetch(async () => response(200, JSON.stringify({
    qrcode: "qr-silent",
    qrcode_img_content: "https://scan.example/silent",
  })));

  try {
    const result = await rpcdef(buildCtx({
      config: { printQrCode: false },
    }))[METHOD_START_LOGIN_PATH]({});
    assert.equal(result.qrcode, "qr-silent");
    assert.ok(result.qrcode_terminal.includes("▄▄"));
    assert.deepEqual(logs, []);
  } finally {
    console.log = originalLog;
  }
});

test("WaitLogin returns confirmed credentials", async () => {
  _test.loginSessions.set("session-1", {
    sessionKey: "session-1",
    qrcode: "qr-1",
    qrcodeUrl: "https://scan.example/qr-1",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({
      status: "confirmed",
      ilink_bot_id: "bot-2@im.bot",
      bot_token: "token-2",
      baseurl: "https://idc.weixin.example",
      ilink_user_id: "user-1@im.wechat",
    }));
  });

  const result = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "session-1",
    timeout_ms: 1,
  });

  assert.equal(captured.url, "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qr-1");
  assert.equal(captured.init.method, "GET");
  assert.equal(result.connected, true);
  assert.equal(result.account_id, "bot-2@im.bot");
  assert.equal(result.token, "token-2");
  assert.equal(result.base_url, "https://idc.weixin.example");
  assert.equal(_test.loginSessions.has("session-1"), false);
});

test("SendText posts iLink text message with base_info and bearer token", async () => {
  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ ret: 0, errmsg: "ok" }));
  });

  const result = await rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH]({
    to_user_id: "user-1@im.wechat",
    message: "hello",
    context_token: "ctx-1",
    client_id: "client-1",
  });

  assert.equal(captured.url, "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
  assert.equal(captured.init.headers.Authorization, "Bearer token-1");
  assert.equal(captured.init.headers.AuthorizationType, "ilink_bot_token");
  assert.equal(captured.init.headers["iLink-App-Id"], "bot");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.msg.to_user_id, "user-1@im.wechat");
  assert.equal(body.msg.context_token, "ctx-1");
  assert.deepEqual(body.msg.item_list, [{ type: 1, text_item: { text: "hello" } }]);
  assert.equal(body.base_info.bot_agent, "OctoBusTest/1.0.0");
  assert.equal(result.success, true);
  assert.equal(result.client_id, "client-1");
});

test("FetchUpdates normalizes incoming messages and returns new cursor", async () => {
  setFetch(async () => response(200, JSON.stringify({
    ret: 0,
    msgs: [{
      seq: 7,
      message_id: 8,
      from_user_id: "user-1@im.wechat",
      to_user_id: "bot-1@im.bot",
      create_time_ms: 1710000000000,
      session_id: "session-1",
      message_type: 1,
      message_state: 2,
      context_token: "ctx-1",
      item_list: [{ type: 1, text_item: { text: "hello" } }],
    }],
    get_updates_buf: "cursor-2",
    longpolling_timeout_ms: 35000,
  })));

  const result = await rpcdef(buildCtx())[METHOD_FETCH_UPDATES_PATH]({
    cursor: "cursor-1",
    timeout_ms: 1000,
  });

  assert.equal(result.cursor, "cursor-2");
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].from_user_id, "user-1@im.wechat");
  assert.equal(result.messages[0].text, "hello");
  assert.equal(result.messages[0].context_token, "ctx-1");
});

test("receiver buffers fetched messages and supports poll plus ack", async () => {
  let pollCount = 0;
  setFetch(async () => {
    pollCount += 1;
    return response(200, JSON.stringify({
      ret: 0,
      msgs: [{
        message_id: pollCount,
        from_user_id: "user-1@im.wechat",
        item_list: [{ type: 1, text_item: { text: `hello ${pollCount}` } }],
      }],
      get_updates_buf: `cursor-${pollCount}`,
    }));
  });

  const start = await rpcdef(buildCtx())[METHOD_START_RECEIVER_PATH]({ cursor: "cursor-0" });
  assert.equal(start.running, true);

  await _test.receiverTick();
  await _test.stopReceiver();

  const polled = await rpcdef(buildCtx())[METHOD_POLL_MESSAGES_PATH]({ max_messages: 10 });
  assert.equal(polled.messages.length >= 1, true);
  assert.equal(polled.messages[0].message.text, "hello 1");
  assert.equal(polled.queue_size, polled.messages.length);

  const acked = await rpcdef(buildCtx())[METHOD_ACK_MESSAGE_PATH]({
    localId: [polled.messages[0].local_id],
  });
  assert.equal(acked.acked, 1);
});

test("NormalizeMessage extracts text from text and voice transcript items", async () => {
  const result = await rpcdef(buildCtx())[METHOD_NORMALIZE_MESSAGE_PATH]({
    raw_json: JSON.stringify({
      message_id: 9,
      from_user_id: "user-1@im.wechat",
      item_list: [
        { type: 1, text_item: { text: "hello" } },
        { type: 3, voice_item: { text: "voice text" } },
      ],
    }),
  });

  assert.equal(result.message_id, 9);
  assert.equal(result.text, "hello\nvoice text");
});

test("SDK handlers read ctx.request", async () => {
  setFetch(async () => response(200, JSON.stringify({ ret: 0 })));

  const result = await handlers[METHOD_SEND_TEXT_FULL]({
    request: {
      to_user_id: "user-1@im.wechat",
      message: "hello",
      client_id: "client-sdk",
    },
    config: { baseUrl: "https://ilinkai.weixin.qq.com" },
    secret: { token: "token-sdk" },
  });

  assert.equal(result.client_id, "client-sdk");
});

test("validation and upstream failures map to gRPC errors", async () => {
  await expectGrpcError(
    () => rpcdef({ config: {}, secret: {} })[METHOD_SEND_TEXT_PATH]({ to_user_id: "u", message: "x" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  await expectGrpcError(
    () => rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH]({ to_user_id: "", message: "x" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  setFetch(async () => response(403, JSON.stringify({ ret: 403, errmsg: "forbidden" })));
  const httpErr = await expectGrpcError(
    () => rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH]({ to_user_id: "u", message: "x" }),
    "PERMISSION_DENIED",
    grpcStatus.PERMISSION_DENIED,
  );
  assert.equal(httpErr.httpStatus, 403);

  setFetch(async () => response(200, JSON.stringify({ ret: -14, errmsg: "session expired" })));
  const businessErr = await expectGrpcError(
    () => rpcdef(buildCtx())[METHOD_FETCH_UPDATES_PATH]({ cursor: "" }),
    "FAILED_PRECONDITION",
    grpcStatus.FAILED_PRECONDITION,
  );
  assert.equal(businessErr.ret, -14);
});

test("login helper covers cached, redirected, expired, and already-bound sessions", async () => {
  _test.loginSessions.set("cached", {
    qrcode: "qr-cached",
    qrcodeUrl: "https://scan.example/cached",
    httpStatus: 200,
    httpBody: "{}",
  });
  const cached = await rpcdef(buildCtx({
    config: { printQrCode: false },
  }))[METHOD_START_LOGIN_PATH]({
    sessionKey: "cached",
  });
  assert.equal(cached.qrcode, "qr-cached");

  _test.loginSessions.set("redirect", {
    qrcode: "qr-redirect",
    qrcodeUrl: "",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  let redirectCaptured;
  setFetch(async (url) => {
    redirectCaptured = String(url);
    return response(200, JSON.stringify({
      status: "scaned_but_redirect",
      redirect_host: "idc.weixin.example",
    }));
  });
  const redirected = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "redirect",
    timeout_ms: 1,
    verify_code: "123456",
  });
  assert.equal(redirected.connected, false);
  assert.equal(redirected.status, "scaned_but_redirect");
  assert.equal(_test.loginSessions.get("redirect").currentBaseUrl, "https://idc.weixin.example");
  assert.ok(redirectCaptured.includes("verify_code=123456"));

  _test.loginSessions.set("expired", {
    qrcode: "qr-expired",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  setFetch(async () => response(200, JSON.stringify({ status: "expired" })));
  const expired = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "expired",
    timeout_ms: 1,
  });
  assert.equal(expired.status, "expired");
  assert.equal(_test.loginSessions.has("expired"), false);

  _test.loginSessions.set("blocked", {
    qrcode: "qr-blocked",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  setFetch(async () => response(200, JSON.stringify({ status: "verify_code_blocked" })));
  const blocked = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "blocked",
    timeout_ms: 1,
  });
  assert.equal(blocked.message, "验证码多次错误，请重新开始登录。");

  _test.loginSessions.set("bound", {
    qrcode: "qr-bound",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  setFetch(async () => response(200, JSON.stringify({ status: "binded_redirect" })));
  const bound = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "bound",
    timeout_ms: 1,
  });
  assert.equal(bound.already_connected, true);

  _test.loginSessions.set("wait-then-confirm", {
    qrcode: "qr-wait",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  let waitPolls = 0;
  setFetch(async () => {
    waitPolls += 1;
    if (waitPolls === 1) return response(200, JSON.stringify({ status: "wait" }));
    return response(200, JSON.stringify({
      status: "confirmed",
      ilink_bot_id: "bot-wait@im.bot",
      bot_token: "token-wait",
      baseurl: "https://ilinkai.weixin.qq.com",
    }));
  });
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  try {
    const waited = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
      session_key: "wait-then-confirm",
      timeout_ms: 2000,
    });
    assert.equal(waited.connected, true);
    assert.equal(waitPolls, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  await expectGrpcError(
    () => rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({ session_key: "missing", timeout_ms: 1 }),
    "FAILED_PRECONDITION",
    grpcStatus.FAILED_PRECONDITION,
  );
});

test("HTTP helpers map network, bad body, and status errors", async () => {
  setFetch(async () => {
    throw new Error("network down");
  });
  const networkErr = await expectGrpcError(
    () => _test.apiPost(buildCtx(), "https://ilinkai.weixin.qq.com", "ilink/bot/sendmessage", {}),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(networkErr.reason, "network down");

  setFetch(async () => ({
    status: 200,
    text: async () => {
      throw new Error("read broke");
    },
  }));
  const readErr = await expectGrpcError(
    () => _test.apiPost(buildCtx(), "https://ilinkai.weixin.qq.com", "ilink/bot/sendmessage", {}),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(readErr.reason, "read broke");

  setFetch(async () => response(429, JSON.stringify({ errcode: 429, errmsg: "too frequent" })));
  const getErr = await expectGrpcError(
    () => _test.apiGet(buildCtx(), "https://ilinkai.weixin.qq.com", "ilink/bot/get_qrcode_status?qrcode=qr"),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(getErr.httpStatus, 429);

  setFetch(async () => response(500, JSON.stringify({ errmsg: "server error" })));
  const postErr = await expectGrpcError(
    () => _test.apiPost(buildCtx(), "https://ilinkai.weixin.qq.com", "ilink/bot/sendmessage", {}),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(postErr.httpStatus, 500);
});

test("receiver queue supports overflow, poll ack, ack all, and no-op tick", async () => {
  _test.receiverState.ctx = { bindings: { maxBufferedMessages: 2 } };
  _test.receiverState.queue = [];
  _test.receiverState.localMessageSeq = 0;
  _test.enqueueReceivedMessages([
    { text: "one" },
    { text: "two" },
    { text: "three" },
  ]);
  assert.equal(_test.receiverState.queue.length, 2);
  assert.equal(_test.receiverState.droppedMessages, 1);

  const ackPoll = await rpcdef(buildCtx())[METHOD_POLL_MESSAGES_PATH]({
    max_messages: 1,
    ack: true,
  });
  assert.equal(ackPoll.messages.length, 1);
  assert.equal(ackPoll.queue_size, 1);

  const all = await rpcdef(buildCtx())[METHOD_ACK_MESSAGE_PATH]({ all: true });
  assert.equal(all.acked, 1);
  assert.equal(all.queue_size, 0);

  const stoppedStatus = await _test.receiverTick();
  assert.equal(stoppedStatus.running, false);
});

test("receiver start handles already-running state and auto-start CLI parsing", async () => {
  setFetch(async () => response(200, JSON.stringify({
    ret: 0,
    msgs: [],
    get_updates_buf: "cursor-auto",
  })));

  assert.equal(await _test.maybeAutoStartReceiverFromCli(["--help"]), false);
  assert.equal(await _test.maybeAutoStartReceiverFromCli([
    "--runtime",
    "serve",
    "--config-json",
    JSON.stringify({ autoStartReceiver: false }),
  ]), false);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-weixin-test-"));
  const configPath = path.join(tempDir, "config.json");
  const secretPath = path.join(tempDir, "secret.json");
  fs.writeFileSync(configPath, JSON.stringify({ autoStartReceiver: false }));
  fs.writeFileSync(secretPath, JSON.stringify({ token: "token-file" }));
  assert.equal(await _test.maybeAutoStartReceiverFromCli([
    "--runtime",
    "serve",
    `--config=${configPath}`,
    `--secret=${secretPath}`,
  ]), false);

  const autoStarted = await _test.maybeAutoStartReceiverFromCli([
    "--runtime",
    "serve",
    "--config-json",
    JSON.stringify({ autoStartReceiver: true, baseUrl: "https://ilinkai.weixin.qq.com" }),
    "--secret-json",
    JSON.stringify({ token: "token-auto", accountId: "bot-auto@im.bot" }),
  ]);
  assert.equal(autoStarted, true);
  const already = await rpcdef(buildCtx())[METHOD_START_RECEIVER_PATH]({});
  assert.equal(already.running, true);
  await rpcdef(buildCtx())[METHOD_STOP_RECEIVER_PATH]({});
});

test("startup auto login waits for QR confirmation and starts receiver", async () => {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));

  const calls = [];
  setFetch(async (url, init) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (call.url.includes("get_bot_qrcode")) {
      return response(200, JSON.stringify({
        qrcode: "qr-auto",
        qrcode_img_content: "https://scan.example/auto",
      }));
    }
    if (call.url.includes("get_qrcode_status")) {
      return response(200, JSON.stringify({
        status: "confirmed",
        ilink_bot_id: "bot-auto@im.bot",
        bot_token: "token-auto",
        baseurl: "https://idc.weixin.example",
        ilink_user_id: "user-auto@im.wechat",
      }));
    }
    if (call.url.includes("getupdates")) {
      return response(200, JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "cursor-auto" }));
    }
    return response(200, JSON.stringify({ ret: 0 }));
  });

  try {
    const started = await _test.maybeAutoStartLoginFromCli([
      "--runtime",
      "serve",
      "--config-json",
      JSON.stringify({
        loginBaseUrl: "https://ilinkai.weixin.qq.com",
        loginWaitTimeoutMs: 1,
        autoLoginRetryMs: 100,
      }),
      "--secret-json",
      JSON.stringify({}),
    ]);
    assert.equal(started, true);
    await _test.autoLoginState.promise;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.deepEqual(errors, []);
  assert.equal(_test.runtimeCredentials.connected, true);
  assert.equal(_test.runtimeCredentials.accountId, "bot-auto@im.bot");
  assert.equal(_test.runtimeCredentials.token, "token-auto");
  assert.equal(_test.runtimeCredentials.baseUrl, "https://idc.weixin.example");
  assert.equal(_test.receiverState.running, true);
  assert.ok(logs.some((line) => line.includes("scan this QR code")));
  assert.ok(logs.some((line) => line.includes("connected as bot-auto@im.bot")));

  let sendCall;
  setFetch(async (url, init) => {
    sendCall = { url: String(url), init };
    return response(200, JSON.stringify({ ret: 0 }));
  });
  const sent = await rpcdef({ config: {}, secret: {} })[METHOD_SEND_TEXT_PATH]({
    to_user_id: "user-1@im.wechat",
    message: "hello",
  });
  assert.equal(sent.success, true);
  assert.equal(sendCall.url, "https://idc.weixin.example/ilink/bot/sendmessage");
  assert.equal(sendCall.init.headers.Authorization, "Bearer token-auto");
});

test("startup auto login skips existing token unless explicitly enabled", async () => {
  setFetch(async () => {
    throw new Error("fetch should not run");
  });
  const skipped = await _test.maybeAutoStartLoginFromCli([
    "--runtime",
    "serve",
    "--config-json",
    JSON.stringify({}),
    "--secret-json",
    JSON.stringify({ token: "existing-token" }),
  ]);
  assert.equal(skipped, false);
});

test("helper aliases and small scalar branches behave as expected", () => {
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean(1), true);
  assert.equal(_test.toBoolean("off"), false);
  assert.equal(_test.toBoolean({ value: "yes" }), true);
  assert.equal(_test.optionalUint32("-1"), undefined);
  assert.equal(_test.optionalIntWithDefault("0", 7, 1), 7);
  assert.equal(_test.mapHttpStatusToCode(401), "UNAUTHENTICATED");
  assert.equal(_test.mapHttpStatusToCode(404), "FAILED_PRECONDITION");
  assert.equal(_test.mapHttpStatusToCode(200), "UNKNOWN");
  assert.equal(_test.mapBusinessCodeToGrpcCode(0, 401), "UNAUTHENTICATED");
  assert.equal(_test.mapBusinessCodeToGrpcCode(0, 403), "PERMISSION_DENIED");
  assert.equal(_test.mapBusinessCodeToGrpcCode(0, -2), "UNAVAILABLE");
  assert.equal(_test.mapBusinessCodeToGrpcCode(0, 0), "UNKNOWN");
  assert.equal(_test.resolveLongPollTimeoutMs({ bindings: { long_poll_timeout_ms: "2222" } }, {}), 2222);
  assert.equal(_test.resolveBotType({ bot_type: "4" }, {}), "4");
  assert.equal(_test.resolveRouteTag({ route_tag: "tag-1" }), "tag-1");
  assert.equal(_test.resolvePrintQrCode({ print_qr_code: false }), false);
  assert.equal(_test.resolveAutoStartLogin({ auto_start_login: false }), false);
  assert.equal(_test.resolveAutoStartReceiverAfterLogin({ auto_start_receiver_after_login: false }), false);
  assert.equal(_test.resolveLoginWaitTimeoutMs({ login_wait_timeout_ms: "3333" }), 3333);
  assert.equal(_test.resolveAutoLoginRetryMs({ auto_login_retry_ms: "4444" }), 4444);
  assert.ok(_test.buildTerminalQrCode("hello").includes("▄▄"));
});

test("normalization and send helpers cover object input, invalid input, aliases, and generated client id", async () => {
  const objectNormalized = await rpcdef(buildCtx())[METHOD_NORMALIZE_MESSAGE_PATH]({
    message: {
      seq: 1,
      item_list: [],
    },
  });
  assert.equal(objectNormalized.seq, 1);

  await expectGrpcError(
    () => rpcdef(buildCtx())[METHOD_NORMALIZE_MESSAGE_PATH]({ raw_json: "[]" }),
    "INVALID_ARGUMENT",
    grpcStatus.INVALID_ARGUMENT,
  );

  let captured;
  setFetch(async (url, init) => {
    captured = { url: String(url), init };
    return response(200, JSON.stringify({ ret: 0 }));
  });
  const result = await rpcdef(buildCtx())[METHOD_SEND_TEXT_PATH]({
    to: "user-2@im.wechat",
    text: "hi",
    runId: "run-1",
  });
  const body = JSON.parse(captured.init.body);
  assert.equal(body.msg.to_user_id, "user-2@im.wechat");
  assert.equal(body.msg.run_id, "run-1");
  assert.match(result.client_id, /^octobus-weixin-/);
});

test("more failure branches cover invalid URLs, GET network errors, wait timeout, and receiver errors", async () => {
  assert.throws(() => _test.normalizeBaseUrl("not a url", "", "baseUrl"), /HTTP\/HTTPS URL/);

  setFetch(async () => {
    throw new Error("get network down");
  });
  const getNetworkErr = await expectGrpcError(
    () => _test.apiGet(buildCtx(), "https://ilinkai.weixin.qq.com", "ilink/bot/get_qrcode_status?qrcode=qr"),
    "UNAVAILABLE",
    grpcStatus.UNAVAILABLE,
  );
  assert.equal(getNetworkErr.reason, "get network down");

  _test.loginSessions.set("need-code", {
    qrcode: "qr-code",
    currentBaseUrl: "https://ilinkai.weixin.qq.com",
  });
  setFetch(async () => response(200, JSON.stringify({ status: "need_verifycode" })));
  const needCode = await rpcdef(buildCtx())[METHOD_WAIT_LOGIN_PATH]({
    session_key: "need-code",
    timeout_ms: 1,
  });
  assert.equal(needCode.message, "需要输入手机微信显示的验证码。");

  _test.receiverState.running = true;
  _test.receiverState.ctx = _test.resolveCallContext(buildCtx());
  _test.receiverState.cursor = "";
  setFetch(async () => response(200, JSON.stringify({ ret: -14, errmsg: "expired" })));
  await expectGrpcError(
    () => _test.receiverTick(),
    "FAILED_PRECONDITION",
    grpcStatus.FAILED_PRECONDITION,
  );
  assert.equal(_test.receiverState.state, "error");

  _test.receiverState.abortController = new AbortController();
  const stopped = await _test.stopReceiver();
  assert.equal(stopped.running, false);
});

test("helpers cover URL normalization and invalid JSON", async () => {
  assert.equal(_test.buildUrl("https://ilinkai.weixin.qq.com", "ilink/bot/sendmessage"), "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
  assert.equal(_test.normalizeBaseUrl("https://ilinkai.weixin.qq.com/", "", "baseUrl"), "https://ilinkai.weixin.qq.com");
  assert.equal(_test.resolveTimeoutMs({ bindings: { timeout_ms: "1234" } }), 1234);
  assert.throws(() => _test.parseJsonBody("{"), /not valid JSON/);
  assert.throws(() => _test.normalizeBaseUrl("ftp://example.com", "", "baseUrl"), /HTTP\/HTTPS/);
});
