import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { defineService, getMetadataValue, mergeConfigSecret, normalizeContext, runService } from "../src/index.js";
import { loadServicePackage } from "../src/proto-loader.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("HandlerContext", () => {
  let server: grpc.Server | undefined;

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  it("passes request, stripped metadata, config, and method", async () => {
    const configPath = writeConfig({ multiplier: 3 });
    const secretPath = writeJSONFile("secret", { apiToken: "secret-token" });
    const seen: Record<string, unknown> = {};
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          const request = ctx.request as { left: number; right: number };
          seen.request = ctx.request;
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          seen.method = ctx.method;
          seen.serviceId = ctx.serviceId;
          seen.instanceId = ctx.instanceId;
          seen.workdir = ctx.workdir;
          seen.packageDir = ctx.packageDir;
          seen.metadataMap = ctx.metadata.getMap();
          seen.authorization = ctx.getMetadata("authorization");
          seen.authorizationAll = ctx.getMetadataAll("authorization");
          return { result: request.left + request.right };
        },
      },
    });

    const result = await runService(service, {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config", configPath, "--secret", secretPath, "--service", "svc", "--instance", "inst"],
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      cwd: fixturesDir,
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const client = createCalculatorClient(result.address);
    const metadata = new grpc.Metadata();
    metadata.set("authorization", "Bearer token");
    metadata.set("x-octobus-service", "hidden-service");
    metadata.set("x-octobus-instance", "hidden-instance");
    metadata.set("x-octobus-future-control", "hidden");
    metadata.set("x-octobus-ext-username", "alice");
    await unary<{ result: number }>(client, "Add", { left: 2, right: 4 }, metadata);

    expect(seen.request).toMatchObject({ left: 2, right: 4 });
    expect(seen.config).toEqual({ multiplier: 3 });
    expect(seen.secret).toEqual({ apiToken: "secret-token" });
    expect(seen.method).toBe("calculator.v1.CalculatorService/Add");
    expect(seen.serviceId).toBe("svc");
    expect(seen.instanceId).toBe("inst");
    expect(seen.workdir).toBe(fixturesDir);
    expect(seen.packageDir).toBe(fixturesDir);
    expect(seen.authorization).toBe("Bearer token");
    expect(seen.authorizationAll).toEqual(["Bearer token"]);
    expect(seen.metadataMap).toMatchObject({ authorization: "Bearer token", "x-octobus-ext-username": "alice" });
    expect(seen.metadataMap).not.toHaveProperty("x-octobus-service");
    expect(seen.metadataMap).not.toHaveProperty("x-octobus-instance");
    expect(seen.metadataMap).not.toHaveProperty("x-octobus-future-control");
  });

  it("passes inline secret JSON to handlers", async () => {
    const seen: Record<string, unknown> = {};
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": (ctx) => {
          seen.config = ctx.config;
          seen.secret = ctx.secret;
          const request = ctx.request as { left: number; right: number };
          return { result: request.left + request.right };
        },
      },
    });

    const result = await runService(service, {
      argv: ["--runtime", "serve", "--host", "127.0.0.1", "--port", "0", "--config-json", `{"label":"inline"}`, "--secret-json", `{"apiToken":"inline"}`],
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      cwd: fixturesDir,
    });
    if (result.command !== "serve") {
      throw new Error("expected serve result");
    }
    server = result.server;

    const client = createCalculatorClient(result.address);
    await unary<{ result: number }>(client, "Add", { left: 1, right: 2 });

    expect(seen.config).toEqual({ label: "inline" });
    expect(seen.secret).toEqual({ apiToken: "inline" });
  });

  it("normalizes plain SDK context objects", () => {
    const normalized = normalizeContext({
      req: { legacy: true },
      request: { sdk: true },
      config: { baseUrl: "https://api.local" },
      secret: { token: "secret-token" },
      metadata: { requestId: "req-1" },
      bindings: { retained: true },
    });

    expect(normalized.request).toEqual({ sdk: true });
    expect(normalized.config).toEqual({ baseUrl: "https://api.local" });
    expect(normalized.secret).toEqual({ token: "secret-token" });
    expect(normalized.metadata).toEqual({ requestId: "req-1" });
    expect(normalized.bindings).toEqual({ retained: true });
    expect(mergeConfigSecret(normalized)).toEqual({ baseUrl: "https://api.local", token: "secret-token" });
    expect(getMetadataValue(normalized, "requestId")).toBe("req-1");
  });

  it("falls back to legacy req and clears non-plain config, secret, and metadata", () => {
    const metadata = new grpc.Metadata();
    metadata.set("authorization", "Bearer token");
    const normalized = normalizeContext({
      req: { legacy: true },
      config: ["not", "plain"],
      secret: null,
      metadata,
    });

    expect(normalized.request).toEqual({ legacy: true });
    expect(normalized.config).toEqual({});
    expect(normalized.secret).toEqual({});
    expect(normalized.metadata).toEqual({});
    expect(getMetadataValue({
      getMetadata: (key: string) => (key === "authorization" ? "Bearer token" : undefined),
    }, "authorization")).toBe("Bearer token");
  });
});

function createCalculatorClient(address: string): any {
  const loaded = loadServicePackage(fixturesDir);
  const service = loaded.grpcServices.find((item) => item.descriptor.typeName === "calculator.v1.CalculatorService");
  if (!service) {
    throw new Error("calculator fixture service not found");
  }
  const Client = grpc.makeGenericClientConstructor(service.definition, service.descriptor.typeName);
  return new Client(address, grpc.credentials.createInsecure());
}

function unary<T>(client: any, method: string, request: unknown, metadata?: grpc.Metadata): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, metadata ?? new grpc.Metadata(), (error: grpc.ServiceError | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

function writeConfig(config: unknown): string {
  return writeJSONFile("config", config);
}

function writeJSONFile(name: string, value: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-context-"));
  const filePath = path.join(dir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  return filePath;
}
