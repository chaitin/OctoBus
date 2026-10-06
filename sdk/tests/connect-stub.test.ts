import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectRpcError, createConnectRpcStub, generateClientStubSource } from "../src/index.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("Connect RPC stub", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates unary service methods that call OctoBus Connect JSON endpoints", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const stub = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000/",
      capsetId: "dev space",
      instanceId: "calculator-test",
      headers: { authorization: "Bearer token" },
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ result: 12 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(stub.services["calculator.v1.CalculatorService"].Add({ left: 7, right: 5 }, {
      headers: { "x-request-id": "req-1" },
    })).resolves.toEqual({ result: 12 });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:9000/capsets/dev%20space/connect/calculator-test/calculator.v1.CalculatorService/Add");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.body).toBe(JSON.stringify({ left: 7, right: 5 }));
    const headers = new Headers(requests[0].init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-request-id")).toBe("req-1");
  });

  it("supports full method invocation and Connect error responses", async () => {
    const stub = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      fetch: async () => new Response(JSON.stringify({
        code: "invalid_argument",
        message: "left must not be -1",
        details: [{ reason: "negative" }],
      }), { status: 400 }),
    });

    await expect(stub.invoke("/calculator.v1.CalculatorService/Add", { left: -1, right: 5 }))
      .rejects.toMatchObject({
        name: "ConnectRpcError",
        code: "invalid_argument",
        status: 400,
        message: "left must not be -1",
        details: [{ reason: "negative" }],
      } satisfies Partial<ConnectRpcError>);
  });

  it("resolves dynamic headers and accepts empty JSON responses", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const stub = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      headers: async () => ({ authorization: "Bearer dynamic" }),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response("", { status: 200 });
      },
    });

    await expect(stub.invoke("calculator.v1.CalculatorService/Add", undefined, {
      headers: { authorization: "Bearer override" },
    })).resolves.toEqual({});

    expect(JSON.parse(String(requests[0].init.body))).toEqual({});
    expect(new Headers(requests[0].init.headers).get("authorization")).toBe("Bearer override");
  });

  it("reports invalid JSON and fallback HTTP errors", async () => {
    const invalidJson = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      fetch: async () => new Response("not-json", { status: 200 }),
    });
    await expect(invalidJson.invoke("calculator.v1.CalculatorService/Add", { left: 1, right: 2 }))
      .rejects.toMatchObject({
        name: "ConnectRpcError",
        code: "unknown",
        status: 0,
      });

    const fallbackError = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      fetch: async () => new Response("plain failure", { status: 503, statusText: "Service Unavailable" }),
    });
    await expect(fallbackError.invoke("calculator.v1.CalculatorService/Add", { left: 1, right: 2 }))
      .rejects.toMatchObject({
        name: "ConnectRpcError",
        code: "unknown",
        status: 503,
        message: "Service Unavailable",
      });

    const nonObjectError = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      fetch: async () => new Response("", { status: 503, statusText: "Service Unavailable" }),
    });
    await expect(nonObjectError.invoke("calculator.v1.CalculatorService/Add", { left: 1, right: 2 }))
      .rejects.toMatchObject({
        name: "ConnectRpcError",
        code: "unknown",
        status: 503,
        message: "Service Unavailable",
      });
  });

  it("rejects missing services, methods, and fetch implementations", async () => {
    const stub = createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
      fetch: async () => new Response("{}"),
    });

    expect(() => stub.service("calculator.v1.MissingService")).toThrow("Connect RPC service calculator.v1.MissingService is not defined");
    await expect(stub.invoke("calculator.v1.CalculatorService/Sum", [])).rejects.toThrow("is not a unary service method");

    vi.stubGlobal("fetch", undefined);
    expect(() => createConnectRpcStub({
      packageDir: fixturesDir,
      baseUrl: "http://127.0.0.1:9000",
      capsetId: "dev",
      instanceId: "calculator-test",
    })).toThrow("global fetch is not available");
  });

  it("prints an ESM stub module for unary package methods", () => {
    const source = generateClientStubSource({
      packageDir: fixturesDir,
      transport: "connect",
      factoryName: "createCalculatorClient",
    });

    expect(source).toContain(`import { createConnectRpcStub } from "@chaitin-ai/octobus-sdk";`);
    expect(source).toContain("export function createCalculatorClient(options)");
    expect(source).toContain(`"CalculatorService": {`);
    expect(source).toContain(`"Add": (request, options) => stub.invoke("calculator.v1.CalculatorService/Add", request, options),`);
    expect(source).toContain(`"JsonShape": (request, options) => stub.invoke("calculator.v1.CalculatorService/JsonShape", request, options),`);
    expect(source).not.toContain("Sum");
    expect(source).not.toContain("Watch");
    expect(source).not.toContain("Chat");
  });

  it("prints a descriptor-backed ESM wrapper for generated packages", () => {
    const source = generateClientStubSource({
      packageDir: fixturesDir,
      transport: "connect",
      factoryName: "createCalculatorClient",
      descriptorBacked: true,
    });

    expect(source).toContain(`import { dirname, join } from "node:path";`);
    expect(source).toContain(`const descriptorPath = join(__dirname, "descriptors", "descriptor.pb");`);
    expect(source).toContain("createConnectRpcStub({");
    expect(source).toContain("descriptorPath,");
    expect(source).toContain("manifestPath,");
    expect(source).toContain(`"CalculatorService": {`);
    expect(source).toContain(`"Add": (request, options) => stub.invoke("calculator.v1.CalculatorService/Add", request, options),`);
  });
});
