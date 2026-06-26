import assert from "node:assert/strict";
import test from "node:test";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  METHOD_GET_ME_FULL,
  METHOD_GET_ME_PATH,
  METHOD_SEND_MESSAGE_FULL,
  METHOD_SEND_MESSAGE_PATH,
  _test,
  handlers,
  rpcdef,
} from "../src/telegram-bot-api.js";
import { service } from "../src/service.js";
import { createMockServer } from "./mock_upstream.js";

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;

const buildCtx = (overrides = {}) => ({
  config: {
    base_url: "https://api.telegram.org",
    chat_id: "123456",
    ...(overrides.config || {}),
  },
  secret: {
    bot_token: "123456:TEST_TOKEN",
    ...(overrides.secret || {}),
  },
  bindings: {
    ...(overrides.bindings || {}),
  },
  limits: { timeoutMs: 2000, ...(overrides.limits || {}) },
  meta: { instance_id: "inst", request_id: "req", ...(overrides.meta || {}) },
  req: overrides.req || {},
});

const response = (status, body) => ({
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const expectGrpcError = async (fn, legacyCode, checker = () => {}) => {
  let caught;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected function to reject");
  assert.ok(caught instanceof GrpcError);
  assert.equal(caught.legacyCode, legacyCode);
  assert.equal(caught.code, ({
    FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
    INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
    PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
    UNAVAILABLE: grpcStatus.UNAVAILABLE,
    UNKNOWN: grpcStatus.UNKNOWN,
  })[legacyCode]);
  checker(caught);
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

test("service exports handlers and rpcdef paths", () => {
  assert.equal(typeof service, "object");
  assert.equal(typeof handlers[METHOD_GET_ME_FULL], "function");
  assert.equal(typeof handlers[METHOD_SEND_MESSAGE_FULL], "function");
  const routes = rpcdef(buildCtx());
  assert.equal(typeof routes[METHOD_GET_ME_PATH], "function");
  assert.equal(typeof routes[METHOD_SEND_MESSAGE_PATH], "function");
});

test("GetMe calls Telegram getMe and redacts token in logs", async () => {
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  const mock = createMockServer({
    onRequest: () => response(200, {
      ok: true,
      result: {
        id: 123456,
        is_bot: true,
        first_name: "OctoBus Test",
        username: "octobus_test_bot",
      },
    }),
  });
  globalThis.fetch = mock.fetch;

  const result = await handlers[METHOD_GET_ME_FULL]({}, buildCtx());

  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, "https://api.telegram.org/bot123456:TEST_TOKEN/getMe");
  assert.equal(mock.calls[0].init.method, "GET");
  assert.equal(mock.calls[0].init.timeoutMs, 2000);
  assert.equal(result.http_status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.body_json.fields.result.structValue.fields.username.stringValue, "octobus_test_bot");
  assert.match(logs.join("\n"), /bot\*\*\*\*\*\*\/getMe/);
  assert.doesNotMatch(logs.join("\n"), /TEST_TOKEN/);
});

test("SendMessage builds JSON payload with request and config defaults", async () => {
  const mock = createMockServer({
    onRequest: () => response(200, {
      ok: true,
      result: {
        message_id: 7,
        chat: { id: 123456, type: "private" },
        text: "OctoBus Telegram adapter test",
      },
    }),
  });
  globalThis.fetch = mock.fetch;

  const result = await rpcdef(buildCtx({
    config: {
      chat_id: "654321",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    req: {
      text: { value: "OctoBus Telegram adapter test" },
      disable_notification: "yes",
      reply_to_message_id: { value: 11 },
    },
  }))[METHOD_SEND_MESSAGE_PATH]();

  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, "https://api.telegram.org/bot123456:TEST_TOKEN/sendMessage");
  assert.equal(mock.calls[0].init.method, "POST");
  assert.equal(mock.calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(mock.calls[0].init.body), {
    chat_id: "654321",
    text: "OctoBus Telegram adapter test",
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: true,
    reply_to_message_id: 11,
  });
  assert.equal(result.http_status, 200);
  assert.equal(result.ok, true);
  assert.match(result.raw_body, /message_id/);
});

test("SendMessage request fields override config aliases", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return response(200, { ok: true, result: { message_id: 1 } });
  };

  await handlers[METHOD_SEND_MESSAGE_FULL](
    {
      chatId: "-1001",
      sendMsg: "alias text",
      parseMode: "MarkdownV2",
      disableWebPagePreview: "off",
    },
    buildCtx({
      config: { chat_id: "default", parse_mode: "HTML", disableWebPagePreview: true },
      secret: { bot_token: undefined, botToken: "alias-token" },
    }),
  );

  assert.equal(captured.url, "https://api.telegram.org/botalias-token/sendMessage");
  assert.deepEqual(JSON.parse(captured.init.body), {
    chat_id: "-1001",
    text: "alias text",
    parse_mode: "MarkdownV2",
    disable_web_page_preview: false,
  });
});

test("validates required bindings and request fields", async () => {
  globalThis.fetch = async () => {
    throw new Error("should not fetch");
  };

  await expectGrpcError(
    () => handlers[METHOD_GET_ME_FULL]({}, buildCtx({ config: { base_url: "ftp://bad" } })),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /base_url/),
  );
  await expectGrpcError(
    () => handlers[METHOD_GET_ME_FULL]({}, buildCtx({ secret: { bot_token: "" } })),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /bot_token/),
  );
  await expectGrpcError(
    () => handlers[METHOD_SEND_MESSAGE_FULL]({ text: "hi" }, buildCtx({ config: { chat_id: "" } })),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /chat_id/),
  );
  await expectGrpcError(
    () => handlers[METHOD_SEND_MESSAGE_FULL]({ chat_id: "1", text: " " }, buildCtx()),
    "INVALID_ARGUMENT",
    (err) => assert.match(err.message, /text is required/),
  );
});

test("maps HTTP and network failures to gRPC errors", async () => {
  for (const [status, legacyCode] of [[401, "PERMISSION_DENIED"], [403, "PERMISSION_DENIED"], [400, "FAILED_PRECONDITION"], [429, "FAILED_PRECONDITION"], [500, "UNAVAILABLE"]]) {
    globalThis.fetch = async () => response(status, { ok: false, error_code: status, description: `status ${status}` });
    await expectGrpcError(
      () => handlers[METHOD_GET_ME_FULL]({}, buildCtx()),
      legacyCode,
      (err) => {
        assert.equal(err.httpStatus, status);
        assert.match(err.rawBody, new RegExp(`status ${status}`));
      },
    );
  }

  globalThis.fetch = async () => {
    throw Object.assign(new Error("fetch failed"), { cause: new Error("connect timeout") });
  };
  await expectGrpcError(
    () => handlers[METHOD_GET_ME_FULL]({}, buildCtx()),
    "UNAVAILABLE",
    (err) => assert.match(err.message, /connect timeout/),
  );

  globalThis.fetch = async () => ({
    status: 200,
    text: async () => {
      throw new Error("read failed");
    },
  });
  await expectGrpcError(
    () => handlers[METHOD_GET_ME_FULL]({}, buildCtx()),
    "UNKNOWN",
    (err) => assert.match(err.message, /read failed/),
  );
});

test("helper functions cover normalization and response parsing", () => {
  assert.equal(_test.grpcCodeFor("NOPE"), grpcStatus.UNKNOWN);
  assert.equal(_test.hasOwn(null, "x"), false);
  assert.equal(_test.firstDefined(undefined, null, 0), 0);
  assert.equal(_test.unwrapScalar({ value: { value: "x" } }), "x");
  assert.equal(_test.toTrimmedString(null), "");
  assert.equal(_test.toBoolean(true), true);
  assert.equal(_test.toBoolean("on"), true);
  assert.equal(_test.toBoolean("off"), false);
  assert.equal(_test.toBoolean(Number.NaN), false);
  assert.equal(_test.optionalPositiveInt("12.9"), 12);
  assert.equal(_test.optionalPositiveInt("0"), undefined);
  assert.equal(_test.normalizeBaseUrl(" https://example.test/// "), "https://example.test");
  assert.equal(_test.normalizeBaseUrl("ftp://example.test"), "");
  assert.equal(_test.telegramUrl("https://api.telegram.org", "token", "getMe"), "https://api.telegram.org/bottoken/getMe");
  assert.equal(_test.redactTelegramUrl("https://api.telegram.org/bot123:secret/sendMessage"), "https://api.telegram.org/bot******/sendMessage");
  assert.equal(_test.mapHttpStatusToCode(401), "PERMISSION_DENIED");
  assert.equal(_test.mapHttpStatusToCode(404), "FAILED_PRECONDITION");
  assert.equal(_test.mapHttpStatusToCode(502), "UNAVAILABLE");
  assert.deepEqual(_test.parseJsonObject("not-json"), {});
  assert.equal(_test.normalizeResponse(200, "{\"ok\":true,\"result\":{\"id\":1}}").ok, true);
});
