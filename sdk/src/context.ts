import type { Metadata } from "@grpc/grpc-js";

export interface HandlerContext<TRequest = unknown, TConfig = unknown, TSecret = unknown> {
  request?: TRequest;
  requests?: AsyncIterable<TRequest>;
  metadata: Metadata;
  config: TConfig;
  secret: TSecret;
  method: string;
  serviceId: string;
  instanceId: string;
  workdir: string;
  packageDir: string;
  getMetadata(name: string): string | undefined;
  getMetadataAll(name: string): string[];
}

export interface NormalizedContext<TRequest = unknown> extends Record<string, unknown> {
  request: TRequest;
  config: Record<string, unknown>;
  secret: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeContext<TRequest = unknown>(ctx: unknown = {}): NormalizedContext<TRequest> {
  const source = isPlainObject(ctx) ? ctx : {};
  const legacyRequest = "req" in source ? source.req : {};
  const request = ("request" in source ? source.request : legacyRequest) as TRequest;

  return {
    ...source,
    request,
    config: isPlainObject(source.config) ? source.config : {},
    secret: isPlainObject(source.secret) ? source.secret : {},
    metadata: isPlainObject(source.metadata) ? source.metadata : {},
  };
}

export function mergeConfigSecret(ctx: unknown = {}): Record<string, unknown> {
  const normalized = normalizeContext(ctx);
  return {
    ...normalized.config,
    ...normalized.secret,
  };
}

export function getMetadataValue(ctx: unknown = {}, key: string): unknown {
  const normalized = normalizeContext(ctx);
  const getMetadata = normalized.getMetadata;
  if (typeof getMetadata === "function") {
    return getMetadata.call(normalized, key);
  }
  if (Object.prototype.hasOwnProperty.call(normalized.metadata, key)) {
    return normalized.metadata[key];
  }
  return normalized.metadata[key.toLowerCase()];
}
