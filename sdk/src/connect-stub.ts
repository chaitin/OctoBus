import { create, fromJson, toJson, type DescMethod, type DescService, type Message } from "@bufbuild/protobuf";
import { findPackageRoot, loadServiceRuntime } from "./proto-loader.js";

export interface ConnectRpcStubOptions {
  baseUrl: string;
  capsetId: string;
  instanceId: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageDir?: string;
  descriptorPath?: string;
  manifestPath?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

export interface ConnectRpcInvokeOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export type ConnectRpcUnaryMethod = (request?: unknown, options?: ConnectRpcInvokeOptions) => Promise<unknown>;

export interface ConnectRpcStub {
  services: Record<string, Record<string, ConnectRpcUnaryMethod>>;
  methods: Record<string, ConnectRpcUnaryMethod>;
  invoke(method: string, request?: unknown, options?: ConnectRpcInvokeOptions): Promise<unknown>;
  service(name: string): Record<string, ConnectRpcUnaryMethod>;
}

interface UnaryConnectMethod {
  service: DescService;
  method: DescMethod;
  fullName: string;
}

export class ConnectRpcError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ConnectRpcError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createConnectRpcStub(options: ConnectRpcStubOptions): ConnectRpcStub {
  const loaded = options.descriptorPath
    ? loadServiceRuntime({
        descriptorPath: options.descriptorPath,
        manifestPath: options.manifestPath,
        packageDir: options.packageDir,
      })
    : loadServiceRuntime({
        packageDir: options.packageDir ?? findPackageRoot({ cwd: options.cwd, env: options.env }),
        env: options.env,
      });
  const methods = discoverUnaryConnectMethods(loaded.services);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("global fetch is not available; pass ConnectRpcStubOptions.fetch");
  }

  const byFullName: Record<string, ConnectRpcUnaryMethod> = {};
  const byService: Record<string, Record<string, ConnectRpcUnaryMethod>> = {};

  const invoke = async (methodName: string, request?: unknown, invokeOptions: ConnectRpcInvokeOptions = {}): Promise<unknown> => {
    const method = methods.find((item) => item.fullName === normalizeMethodName(methodName));
    if (!method) {
      throw new Error(`Connect RPC method ${methodName} is not a unary service method in this package`);
    }
    return invokeConnectUnary(method, request, options, invokeOptions, fetchImpl);
  };

  for (const method of methods) {
    const fn: ConnectRpcUnaryMethod = (request, invokeOptions) => invoke(method.fullName, request, invokeOptions);
    byFullName[method.fullName] = fn;
    byService[method.service.typeName] ??= {};
    byService[method.service.typeName][method.method.name] = fn;
  }

  return {
    services: byService,
    methods: byFullName,
    invoke,
    service(name: string): Record<string, ConnectRpcUnaryMethod> {
      const service = byService[name];
      if (!service) {
        throw new Error(`Connect RPC service ${name} is not defined in this package`);
      }
      return service;
    },
  };
}

function discoverUnaryConnectMethods(services: DescService[]): UnaryConnectMethod[] {
  const methods: UnaryConnectMethod[] = [];
  for (const service of services) {
    for (const method of service.methods) {
      if (method.methodKind !== "unary") {
        continue;
      }
      methods.push({
        service,
        method,
        fullName: `${service.typeName}/${method.name}`,
      });
    }
  }
  return methods;
}

async function invokeConnectUnary(
  method: UnaryConnectMethod,
  request: unknown,
  options: ConnectRpcStubOptions,
  invokeOptions: ConnectRpcInvokeOptions,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const body = JSON.stringify(toJson(method.method.input, messageFromRuntimeValue(method.method.input, request)));
  const headers = new Headers(await resolveHeaders(options.headers));
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  for (const [name, value] of new Headers(invokeOptions.headers)) {
    headers.set(name, value);
  }

  const response = await fetchImpl(connectEndpoint(options.baseUrl, options.capsetId, options.instanceId, method.fullName), {
    method: "POST",
    headers,
    body,
    signal: invokeOptions.signal,
  });
  const responseText = await response.text();
  let responseBody: unknown;
  try {
    responseBody = parseResponseJSON(responseText);
  } catch (error) {
    // Proxies and gateways often return HTML or plain text for failed requests.
    // Preserve the HTTP status so callers can still classify the failure.
    if (!response.ok) {
      throw connectErrorFromResponse(response.status, undefined, response.statusText);
    }
    throw error;
  }
  if (!response.ok) {
    throw connectErrorFromResponse(response.status, responseBody, response.statusText);
  }
  const message = fromJson(method.method.output, responseBody as never);
  return toJson(method.method.output, message);
}

async function resolveHeaders(headers: ConnectRpcStubOptions["headers"]): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? headers() : headers;
}

function parseResponseJSON(text: string): unknown {
  if (text.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConnectRpcError("unknown", `Connect RPC response is not valid JSON: ${message}`, 0);
  }
}

function connectErrorFromResponse(status: number, body: unknown, fallback: string): ConnectRpcError {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const payload = body as { code?: unknown; message?: unknown; details?: unknown };
    return new ConnectRpcError(
      typeof payload.code === "string" ? payload.code : "unknown",
      typeof payload.message === "string" ? payload.message : fallback || "Connect RPC request failed",
      status,
      payload.details,
    );
  }
  return new ConnectRpcError("unknown", fallback || "Connect RPC request failed", status);
}

function connectEndpoint(baseUrl: string, capsetId: string, instanceId: string, method: string): string {
  const [service, methodName] = splitMethodName(method);
  return [
    baseUrl.replace(/\/+$/, ""),
    "capsets",
    encodeURIComponent(capsetId),
    "connect",
    encodeURIComponent(instanceId),
    encodeURIComponent(service),
    encodeURIComponent(methodName),
  ].join("/");
}

function normalizeMethodName(method: string): string {
  return method.startsWith("/") ? method.slice(1) : method;
}

function splitMethodName(method: string): [string, string] {
  const normalized = normalizeMethodName(method);
  const slash = normalized.indexOf("/");
  if (slash < 1 || slash === normalized.length - 1) {
    throw new Error(`invalid Connect RPC method name ${method}`);
  }
  return [normalized.slice(0, slash), normalized.slice(slash + 1)];
}

function messageFromRuntimeValue(schema: DescMethod["input"], value: unknown): Message {
  if (isMessage(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return create(schema);
  }
  if (isPlainObject(value)) {
    try {
      return fromJson(schema, value as never);
    } catch {
      return create(schema, value);
    }
  }
  return create(schema);
}

function isMessage(value: unknown): value is Message {
  return value !== null
    && typeof value === "object"
    && "$typeName" in value
    && typeof (value as { $typeName?: unknown }).$typeName === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
