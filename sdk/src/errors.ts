import { GrpcError } from "./grpc-error.js";
import {
  ABORTED,
  ALREADY_EXISTS,
  CANCELLED,
  DATA_LOSS,
  DEADLINE_EXCEEDED,
  FAILED_PRECONDITION,
  INTERNAL,
  INVALID_ARGUMENT,
  NOT_FOUND,
  OUT_OF_RANGE,
  PERMISSION_DENIED,
  RESOURCE_EXHAUSTED,
  UNAUTHENTICATED,
  UNAVAILABLE,
  UNIMPLEMENTED,
  UNKNOWN,
} from "./status.js";

export type ServiceErrorCode =
  | "ABORTED"
  | "ALREADY_EXISTS"
  | "CANCELLED"
  | "DATA_LOSS"
  | "DEADLINE_EXCEEDED"
  | "FAILED_PRECONDITION"
  | "INTERNAL"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "OUT_OF_RANGE"
  | "PERMISSION_DENIED"
  | "RESOURCE_EXHAUSTED"
  | "UNAUTHENTICATED"
  | "UNAVAILABLE"
  | "UNIMPLEMENTED"
  | "UNKNOWN";

export interface SafeErrorSummaryOptions {
  maxBodyChars?: number;
}

export interface ResponseLike {
  status?: number;
  statusCode?: number;
  statusText?: string;
}

export interface SafeErrorSummary {
  status: number;
  statusText?: string;
  bodySnippet?: string;
  bodyTruncated?: boolean;
}

const CODE_TO_STATUS: Record<ServiceErrorCode, number> = {
  ABORTED,
  ALREADY_EXISTS,
  CANCELLED,
  DATA_LOSS,
  DEADLINE_EXCEEDED,
  FAILED_PRECONDITION,
  INTERNAL,
  INVALID_ARGUMENT,
  NOT_FOUND,
  OUT_OF_RANGE,
  PERMISSION_DENIED,
  RESOURCE_EXHAUSTED,
  UNAUTHENTICATED,
  UNAVAILABLE,
  UNIMPLEMENTED,
  UNKNOWN,
};

const SENSITIVE_KEY_RE = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|webhook|signature)/i;
const SENSITIVE_ASSIGNMENT_RE = /((?:["'])?(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|webhook|signature)(?:["'])?\s*[=:]\s*(?:["'])?)[^\s,&;"}']+/gi;
const WEBHOOK_URL_RE = /\bhttps?:\/\/[^\s"'<>]*(?:webhook|hooks?)[^\s"'<>]*/gi;
const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

export function grpcInvalidArgumentError(message: string): GrpcError {
  return new GrpcError(INVALID_ARGUMENT, message);
}

export function grpcNotFoundError(message: string): GrpcError {
  return new GrpcError(NOT_FOUND, message);
}

export function grpcPermissionDeniedError(message: string): GrpcError {
  return new GrpcError(PERMISSION_DENIED, message);
}

export function grpcUnauthenticatedError(message: string): GrpcError {
  return new GrpcError(UNAUTHENTICATED, message);
}

export function grpcUnavailableError(message: string): GrpcError {
  return new GrpcError(UNAVAILABLE, message);
}

export function grpcCodeFor(code: string): number {
  return CODE_TO_STATUS[code as ServiceErrorCode] ?? UNKNOWN;
}

export function serviceError(code: ServiceErrorCode, message: string, details?: unknown): GrpcError {
  return new GrpcError(grpcCodeFor(code), String(message ?? ""), {
    legacyCode: code,
    details,
  });
}

export function mapHttpStatusToCode(status: unknown): ServiceErrorCode {
  const code = Number(status);
  if (code === 400) return "INVALID_ARGUMENT";
  if (code === 401) return "UNAUTHENTICATED";
  if (code === 403) return "PERMISSION_DENIED";
  if (code === 404) return "NOT_FOUND";
  if (code === 408) return "DEADLINE_EXCEEDED";
  if (code === 409) return "FAILED_PRECONDITION";
  if (code === 429) return "UNAVAILABLE";
  if (code >= 500 && code <= 599) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

export function missingSecretError(field = "secret"): GrpcError {
  return serviceError("UNAUTHENTICATED", `${field} is required`);
}

function redactString(value: string): string {
  const json = redactJsonString(value);
  if (json !== undefined) {
    return json;
  }
  return value
    .replace(AUTH_HEADER_RE, "$1 ***")
    .replace(WEBHOOK_URL_RE, "[REDACTED_URL]")
    .replace(SENSITIVE_ASSIGNMENT_RE, "$1***")
    .replace(/\*{3}(?:\s+\*{3})+/g, "***");
}

function redactJsonString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return undefined;
  }
  try {
    return JSON.stringify(redactSensitive(JSON.parse(trimmed)));
  } catch {
    return undefined;
  }
}

export function redactSensitive(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_RE.test(key) ? "***" : redactSensitive(item, seen);
  }
  return redacted;
}

export function safeErrorSummary(response: ResponseLike | undefined, body = "", options: SafeErrorSummaryOptions = {}): SafeErrorSummary {
  const maxBodyChars = Number.isFinite(options.maxBodyChars) ? Number(options.maxBodyChars) : 160;
  const rawStatus = Number(response?.status ?? response?.statusCode ?? 0);
  const status = Number.isFinite(rawStatus) ? rawStatus : 0;
  const statusText = String(response?.statusText ?? "").trim();
  const redactedBody = String(redactSensitive(String(body ?? "")));
  const summary: SafeErrorSummary = { status };
  if (statusText) {
    summary.statusText = statusText;
  }
  if (redactedBody) {
    summary.bodySnippet = redactedBody.slice(0, Math.max(0, maxBodyChars));
    summary.bodyTruncated = redactedBody.length > maxBodyChars;
  }
  return summary;
}

export function httpStatusError(response: ResponseLike | undefined, body = ""): GrpcError {
  const summary = safeErrorSummary(response, body);
  const status = summary.status || 0;
  const statusText = summary.statusText ? ` ${summary.statusText}` : "";
  return serviceError(mapHttpStatusToCode(status), `upstream http ${status}${statusText}`, summary);
}
