import { Agent } from "undici";
import type { Dispatcher } from "undici";

import { GrpcError } from "./grpc-error.js";
import { httpStatusError, redactSensitive, serviceError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;
let insecureTlsDispatcher: Dispatcher | undefined;

type FetchLike = (url: string | URL, init?: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;
type FetchInit = RequestInit & Record<string, unknown>;

export interface FetchWithTimeoutOptions {
  timeoutMs?: number;
  dispatcher?: Dispatcher;
  fetchImpl?: FetchLike;
}

export interface ResponseWithText {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text(): Promise<string>;
}

export function normalizeTimeoutMs(value: unknown, fallback = DEFAULT_TIMEOUT_MS): number {
  const timeoutMs = Number(value);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return fallback;
}

export function createTlsDispatcher(skipTlsVerify = false): Dispatcher | undefined {
  if (!skipTlsVerify) {
    return undefined;
  }
  insecureTlsDispatcher ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureTlsDispatcher;
}

function bindAbortSignal(controller: AbortController, signal: AbortSignal | null | undefined, onAbort: () => void): () => void {
  if (signal == null) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort();
    controller.abort(signal.reason);
    return () => {};
  }
  const abort = (): void => {
    onAbort();
    controller.abort(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export async function fetchWithTimeout(url: string | URL, init: FetchInit = {}, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? init.timeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  let externalAborted = false;
  let cleanupRequest = (): void => {};
  const unbindAbortSignal = bindAbortSignal(controller, init.signal, () => {
    externalAborted = true;
  });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`timeout after ${timeoutMs}ms`));
    cleanupRequest();
  }, timeoutMs);
  cleanupRequest = (): void => {
    clearTimeout(timeoutId);
    unbindAbortSignal();
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const {
    timeoutMs: _ignoredTimeoutMs,
    skipTlsVerify: _ignoredSkipTlsVerify,
    tlsInsecureSkipVerify: _ignoredTlsInsecureSkipVerify,
    insecureSkipVerify: _ignoredInsecureSkipVerify,
    dispatcher: _ignoredDispatcher,
    signal: _ignoredSignal,
    ...safeInit
  } = init;

  try {
    const response = await fetchImpl(url, {
      ...safeInit,
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      signal: controller.signal,
    });
    return responseWithRequestLifecycle(response, cleanupRequest, () => {
      if (timedOut) {
        return serviceError("DEADLINE_EXCEEDED", `upstream request timed out after ${timeoutMs}ms`);
      }
      if (externalAborted) {
        return serviceError("CANCELLED", "upstream request aborted");
      }
      return undefined;
    });
  } catch (error) {
    cleanupRequest();
    if (timedOut) {
      throw serviceError("DEADLINE_EXCEEDED", `upstream request timed out after ${timeoutMs}ms`);
    }
    if (externalAborted) {
      throw serviceError("CANCELLED", "upstream request aborted");
    }
    throw serviceError("UNAVAILABLE", String(redactSensitive(error instanceof Error ? error.message : "upstream request failed")));
  }
}

function responseWithRequestLifecycle(
  response: Response,
  cleanup: () => void,
  requestError: () => GrpcError | undefined,
): Response {
  const body = response.body;
  if (body === null || body === undefined) {
    cleanup();
    return response;
  }

  const reader = body.getReader();
  const wrappedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        cleanup();
        controller.error(requestError() ?? error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        cleanup();
      }
    },
  });

  const wrappedResponse = new Response(wrappedBody, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  for (const property of ["url", "redirected", "type"] as const) {
    Object.defineProperty(wrappedResponse, property, {
      configurable: true,
      value: response[property],
    });
  }
  return wrappedResponse;
}

export async function readResponseText(response: ResponseWithText): Promise<string> {
  try {
    return String((await response.text()) ?? "");
  } catch (error) {
    if (error instanceof GrpcError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "unknown error";
    throw serviceError("UNAVAILABLE", `failed to read upstream response body: ${redactSensitive(message)}`);
  }
}

export async function readResponseJson(response: ResponseWithText): Promise<{ body: string; json: unknown }> {
  const body = await readResponseText(response);
  if (!body) {
    return { body, json: undefined };
  }
  try {
    return { body, json: JSON.parse(body) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw serviceError("INTERNAL", `failed to parse upstream JSON response: ${redactSensitive(message)}`);
  }
}

export async function assertOkResponse<TResponse extends ResponseWithText>(response: TResponse): Promise<TResponse> {
  if (response.ok) {
    return response;
  }
  const body = await readResponseText(response);
  throw httpStatusError(response, body);
}
