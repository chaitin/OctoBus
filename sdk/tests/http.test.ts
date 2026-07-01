import { describe, expect, it } from "vitest";
import {
  assertOkResponse,
  createTlsDispatcher,
  fetchWithTimeout,
  httpStatusError,
  mapHttpStatusToCode,
  missingSecretError,
  normalizeTimeoutMs,
  readResponseJson,
  readResponseText,
  redactSensitive,
  safeErrorSummary,
} from "../src/index.js";

function response(status: number, body: string, extra: { statusText?: string; textError?: Error } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: extra.statusText ?? "",
    text: async () => {
      if (extra.textError) {
        throw extra.textError;
      }
      return body;
    },
  };
}

describe("service error helpers", () => {
  it("maps HTTP status codes to service error codes", () => {
    expect(mapHttpStatusToCode(400)).toBe("INVALID_ARGUMENT");
    expect(mapHttpStatusToCode(401)).toBe("UNAUTHENTICATED");
    expect(mapHttpStatusToCode(403)).toBe("PERMISSION_DENIED");
    expect(mapHttpStatusToCode(404)).toBe("NOT_FOUND");
    expect(mapHttpStatusToCode(408)).toBe("DEADLINE_EXCEEDED");
    expect(mapHttpStatusToCode(409)).toBe("FAILED_PRECONDITION");
    expect(mapHttpStatusToCode(429)).toBe("UNAVAILABLE");
    expect(mapHttpStatusToCode(503)).toBe("UNAVAILABLE");
    expect(mapHttpStatusToCode(302)).toBe("UNAVAILABLE");
  });

  it("redacts sensitive strings, nested objects, and circular references", () => {
    const value: Record<string, unknown> = {
      token: "abc",
      nested: { password: "secret", value: "Authorization=Bearer abc123" },
      cookieHeader: "sid=secret",
      url: "https://hooks.slack.com/services/T/B/C",
    };
    value.self = value;

    expect(redactSensitive(value)).toEqual({
      token: "***",
      nested: { password: "***", value: "Authorization=***" },
      cookieHeader: "***",
      url: "[REDACTED_URL]",
      self: "[Circular]",
    });
  });

  it("redacts quoted sensitive key assignments in strings", () => {
    expect(redactSensitive('"token"="abc"')).toBe('"token"="***"');
    expect(redactSensitive("'api_key':'secret'")).toBe("'api_key':'***'");
  });

  it("builds safe HTTP summaries and service errors", () => {
    const summary = safeErrorSummary(
      { status: 500, statusText: "Server Error" },
      "token=abc password=secret body-body-body",
      { maxBodyChars: 20 },
    );

    expect(summary.status).toBe(500);
    expect(summary.statusText).toBe("Server Error");
    expect(summary.bodySnippet).not.toContain("abc");
    expect(summary.bodySnippet).not.toContain("secret");
    expect(summary.bodyTruncated).toBe(true);
    expect(missingSecretError("apiKey").legacyCode).toBe("UNAUTHENTICATED");
    expect(httpStatusError({ status: 404 }, "not found").legacyCode).toBe("NOT_FOUND");
  });

  it("redacts quoted JSON secrets in HTTP summaries", () => {
    const summary = safeErrorSummary(
      { status: 401 },
      '{"token":"abc","message":"failed","nested":{"api_key":"secret value"}}',
    );

    expect(summary.bodySnippet).toBe('{"token":"***","message":"failed","nested":{"api_key":"***"}}');
    expect(summary.bodySnippet).not.toContain("abc");
    expect(summary.bodySnippet).not.toContain("secret value");
  });
});

describe("HTTP helpers", () => {
  it("normalizes timeout values and creates explicit TLS dispatchers", async () => {
    expect(normalizeTimeoutMs("25")).toBe(25);
    expect(normalizeTimeoutMs(-1, 7)).toBe(7);
    expect(createTlsDispatcher(false)).toBeUndefined();

    const dispatcher = createTlsDispatcher(true);
    expect(dispatcher).toBeDefined();
    await (dispatcher as { close(): Promise<void> }).close();
  });

  it("strips invalid fetch options and only passes explicit dispatchers", async () => {
    const dispatcher = createTlsDispatcher(true);
    let capturedInit: Record<string, unknown> | undefined;
    const result = await fetchWithTimeout("https://example.test/path", {
      method: "POST",
      timeoutMs: 1,
      skipTlsVerify: true,
      tlsInsecureSkipVerify: true,
      insecureSkipVerify: true,
      dispatcher: "ignored",
    }, {
      timeoutMs: 100,
      dispatcher,
      fetchImpl: async (_url, init) => {
        capturedInit = init as Record<string, unknown>;
        return response(200, "ok") as Response;
      },
    });

    expect(result.status).toBe(200);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit).not.toHaveProperty("timeoutMs");
    expect(capturedInit).not.toHaveProperty("skipTlsVerify");
    expect(capturedInit).not.toHaveProperty("tlsInsecureSkipVerify");
    expect(capturedInit).not.toHaveProperty("insecureSkipVerify");
    expect(capturedInit?.dispatcher).toBe(dispatcher);
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    await (dispatcher as { close(): Promise<void> }).close();
  });

  it("maps timeout, external abort, and network failures", async () => {
    await expect(fetchWithTimeout("https://example.test/slow", {}, {
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    })).rejects.toMatchObject({ legacyCode: "DEADLINE_EXCEEDED" });

    const controller = new AbortController();
    const aborted = fetchWithTimeout("https://example.test/abort", { signal: controller.signal }, {
      timeoutMs: 100,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ legacyCode: "CANCELLED" });

    await expect(fetchWithTimeout("https://example.test/fail", {}, {
      fetchImpl: async () => {
        throw new Error("token=abc network failed");
      },
    })).rejects.toSatisfy((error: Error) => !error.message.includes("abc"));
  });

  it("reads response bodies, JSON, and non-2xx errors safely", async () => {
    await expect(readResponseText(response(200, "plain"))).resolves.toBe("plain");
    await expect(readResponseJson(response(200, "{\"ok\":true}"))).resolves.toEqual({ body: "{\"ok\":true}", json: { ok: true } });

    await expect(readResponseText(response(200, "", { textError: new Error("cookie=sid") }))).rejects.toSatisfy((error: Error & { legacyCode?: string }) => (
      error.legacyCode === "UNAVAILABLE" && !error.message.includes("sid")
    ));
    await expect(readResponseJson(response(200, "{"))).rejects.toMatchObject({ legacyCode: "INTERNAL" });
    await expect(assertOkResponse(response(401, "token=abc", { statusText: "Unauthorized" }))).rejects.toSatisfy((error: Error & { legacyCode?: string; details?: unknown }) => (
      error.legacyCode === "UNAUTHENTICATED"
      && JSON.stringify(error.details).includes("\"status\":401")
      && !JSON.stringify(error.details).includes("abc")
    ));
  });
});
