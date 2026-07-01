import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, runSdkCli, sameExecutablePath } from "../src/cli.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseCliArgs", () => {
  it("matches symlinked bin paths to their real target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-bin-"));
    const target = path.join(root, "cli.js");
    const link = path.join(root, "octobus-sdk");
    fs.writeFileSync(target, "", "utf8");
    fs.symlinkSync(target, link);

    expect(sameExecutablePath(target, link)).toBe(true);
  });

  it("parses serve arguments", () => {
    expect(parseCliArgs([
      "--runtime",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "50051",
      "--config",
      "config.json",
      "--secret",
      "secret.json",
      "--workdir",
      "/tmp/work",
      "--service",
      "svc",
      "--instance",
      "inst",
    ])).toEqual({
      command: "serve",
      host: "127.0.0.1",
      port: 50051,
      config: "config.json",
      configJson: undefined,
      secret: "secret.json",
      secretJson: undefined,
      secretFd: undefined,
      workdir: "/tmp/work",
      service: "svc",
      instance: "inst",
    });
  });

  it("parses serve secret fd arguments", () => {
    expect(parseCliArgs([
      "--runtime",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "50051",
      "--config",
      "config.json",
      "--secret-fd",
      "3",
    ])).toEqual({
      command: "serve",
      host: "127.0.0.1",
      port: 50051,
      config: "config.json",
      configJson: undefined,
      secret: undefined,
      secretJson: undefined,
      secretFd: "3",
      workdir: undefined,
      service: undefined,
      instance: undefined,
    });
  });

  it("parses inspect with optional --json", () => {
    expect(parseCliArgs(["--runtime", "inspect"])).toEqual({
      command: "inspect",
      json: true,
      yaml: false,
      schema: undefined,
    });
    expect(parseCliArgs(["--runtime", "inspect", "--json"])).toEqual({
      command: "inspect",
      json: true,
      yaml: false,
      schema: undefined,
    });
    expect(parseCliArgs(["--runtime", "inspect", "--yaml"])).toEqual({
      command: "inspect",
      json: false,
      yaml: true,
      schema: undefined,
    });
    expect(parseCliArgs(["--runtime", "inspect", "--config-schema"])).toEqual({
      command: "inspect",
      json: true,
      yaml: false,
      schema: "config",
    });
    expect(parseCliArgs(["--runtime", "inspect", "--secret-schema", "--yaml"])).toEqual({
      command: "inspect",
      json: false,
      yaml: true,
      schema: "secret",
    });
  });

  it("returns command help", () => {
    const root = parseCliArgs(["--runtime"]);
    expect(root).toMatchObject({
      command: "help",
    });
    if (root.command !== "help") {
      throw new Error("expected help command");
    }
    expect(root.help).toContain("Usage: octobus-service");
    expect(root.help).toContain("client-stub");
    expect(root.help).toContain("client-package");

    const commands = ["serve", "invoke", "inspect", "dev", "client-stub", "client-package"];
    for (const command of commands) {
      expect(parseCliArgs(["--runtime", command, "--help"])).toMatchObject({
        command: "help",
      });
      const parsed = parseCliArgs(["--runtime", command, "--help"]);
      if (parsed.command !== "help") {
        throw new Error("expected help command");
      }
      expect(parsed.help).toContain(`Usage: octobus-service ${command}`);
      if (command === "inspect") {
        expect(parsed.help).toContain("--config-schema");
        expect(parsed.help).toContain("--secret-schema");
      }
      if (command === "client-package") {
        expect(parsed.help).toContain("--bundle-deps");
        expect(parsed.help).toContain("--publish");
      }
    }

    expect(parseCliArgs(["--help"])).toEqual({
      command: "cli",
      args: ["--help"],
    });
  });

  it("parses dev arguments", () => {
    expect(parseCliArgs(["--runtime", "dev", "--host", "127.0.0.1", "--port", "0", "--config-json", "{}"])).toEqual({
      command: "dev",
      host: "127.0.0.1",
      port: 0,
      config: undefined,
      configJson: "{}",
      secret: undefined,
      secretJson: undefined,
      secretFd: undefined,
      workdir: undefined,
      service: undefined,
      instance: undefined,
    });
  });

  it("parses service cli passthrough arguments", () => {
    expect(parseCliArgs(["add", "--data-json", `{"left":1,"right":2}`, "--help"])).toEqual({
      command: "cli",
      args: ["add", "--data-json", `{"left":1,"right":2}`, "--help"],
    });
  });

  it("parses runtime client generation arguments", () => {
    expect(parseCliArgs(["--runtime", "client-stub", "--transport", "connect", "--factory", "createCalculatorClient"])).toEqual({
      command: "client-stub",
      transport: "connect",
      factoryName: "createCalculatorClient",
    });
    expect(parseCliArgs([
      "--runtime",
      "client-package",
      "--transport",
      "grpc",
      "--name",
      "@acme/calculator-client",
      "--out",
      "client",
      "--factory",
      "createCalculatorClient",
      "--force",
      "--bundle-deps",
      "--publish",
    ])).toEqual({
      command: "client-package",
      transport: "grpc",
      packageName: "@acme/calculator-client",
      outDir: "client",
      factoryName: "createCalculatorClient",
      force: true,
      bundleDeps: true,
      publish: true,
    });
  });

  it("parses invoke arguments", () => {
    expect(parseCliArgs([
      "--runtime",
      "invoke",
      "--method",
      "calculator.v1.CalculatorService/Add",
      "--config",
      "config.json",
      "--secret",
      "secret.json",
      "--metadata",
      "metadata.json",
      "--workdir",
      "/tmp/work",
      "--service",
      "svc",
      "--instance",
      "inst",
    ])).toEqual({
      command: "invoke",
      method: "calculator.v1.CalculatorService/Add",
      config: "config.json",
      secret: "secret.json",
      secretFd: undefined,
      metadata: "metadata.json",
      workdir: "/tmp/work",
      service: "svc",
      instance: "inst",
    });
  });

  it("rejects missing invoke arguments", () => {
    const base = ["--runtime", "invoke", "--method", "calculator.v1.CalculatorService/Add", "--config", "config.json", "--metadata", "metadata.json", "--workdir", "/tmp/work"];
    const cases: Array<[string, string[], string]> = [
      ["method", base.filter((arg, i) => arg !== "--method" && base[i - 1] !== "--method"), "invoke requires --method"],
      ["config", base.filter((arg, i) => arg !== "--config" && base[i - 1] !== "--config"), "invoke requires --config"],
      ["metadata", base.filter((arg, i) => arg !== "--metadata" && base[i - 1] !== "--metadata"), "invoke requires --metadata"],
      ["workdir", base.filter((arg, i) => arg !== "--workdir" && base[i - 1] !== "--workdir"), "invoke requires --workdir"],
    ];

    for (const [_name, args, message] of cases) {
      expect(() => parseCliArgs(args)).toThrow(message);
    }
  });

  it("rejects invalid serve port", () => {
    expect(() => parseCliArgs(["--runtime", "serve", "--host", "127.0.0.1", "--port", "nope", "--config", "config.json"]))
      .toThrow("invalid --port");
  });

  it("rejects conflicting config sources", () => {
    expect(() => parseCliArgs(["--runtime", "serve", "--host", "127.0.0.1", "--port", "50051", "--config", "config.json", "--config-json", "{}"]))
      .toThrow("--config and --config-json are mutually exclusive");
  });

  it("rejects conflicting secret sources", () => {
    expect(() => parseCliArgs(["--runtime", "serve", "--host", "127.0.0.1", "--port", "50051", "--config", "config.json", "--secret", "secret.json", "--secret-json", "{}"]))
      .toThrow("--secret and --secret-json are mutually exclusive");
    expect(() => parseCliArgs(["--runtime", "serve", "--host", "127.0.0.1", "--port", "50051", "--config", "config.json", "--secret", "secret.json", "--secret-fd", "3"]))
      .toThrow("--secret and --secret-fd are mutually exclusive");
    expect(() => parseCliArgs(["--runtime", "invoke", "--method", "calculator.v1.CalculatorService/Add", "--config", "config.json", "--metadata", "metadata.json", "--workdir", "/tmp/work", "--secret", "secret.json", "--secret-fd", "3"]))
      .toThrow("--secret and --secret-fd are mutually exclusive");
  });

  it("passes removed runtime command names to the business CLI without --runtime", () => {
    expect(parseCliArgs(["call-json", "--method", "calculator.v1.CalculatorService/Add", "--data-json", "{}"])).toEqual({
      command: "cli",
      args: ["call-json", "--method", "calculator.v1.CalculatorService/Add", "--data-json", "{}"],
    });
  });

  it("rejects conflicting inspect formats", () => {
    expect(() => parseCliArgs(["--runtime", "inspect", "--json", "--yaml"]))
      .toThrow("--json and --yaml are mutually exclusive");
  });

  it("rejects conflicting inspect schema selections", () => {
    expect(() => parseCliArgs(["--runtime", "inspect", "--config-schema", "--secret-schema"]))
      .toThrow("--config-schema and --secret-schema are mutually exclusive");
  });
});

describe("runSdkCli", () => {
  it("bootstraps a minimal on-demand service package", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-service-"));
    const stdout = writableBuffer();
    const code = await runSdkCli({
      argv: [
        "bootstrap",
        "--name",
        "@acme/echo-service",
        "--out",
        outDir,
      ],
      cwd: fixturesDir,
      stdout,
      stderr: writableBuffer(),
    });

    expect(code).toBe(0);
    expect(stdout.data()).toContain(`generated service package at ${outDir}`);
    expect(fs.existsSync(path.join(outDir, "node_modules"))).toBe(false);

    const packageJson = JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"));
    expect(packageJson).toEqual({
      name: "@acme/echo-service",
      version: "0.1.0",
      private: true,
      type: "module",
      bin: {
        "echo-service": "bin/echo-service.js",
      },
      dependencies: {
        "@chaitin-ai/octobus-sdk": "^0.6.0",
      },
    });

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "service.json"), "utf8"));
    expect(manifest).toMatchObject({
      schema: "chaitin.octobus.service.v1",
      name: "echo-service",
      runtime: { mode: "on-demand" },
      proto: {
        roots: ["proto"],
        files: ["proto/echo-service.proto"],
      },
      configSchema: "config.schema.json",
      secretSchema: "secret.schema.json",
    });

    const proto = fs.readFileSync(path.join(outDir, "proto", "echo-service.proto"), "utf8");
    expect(proto).toContain("package echo.service.v1;");
    expect(proto).toContain("service EchoService");
    expect(proto).toContain("rpc Echo(EchoRequest) returns (EchoResponse);");

    const entry = path.join(outDir, "bin", "echo-service.js");
    const entryStat = fs.statSync(entry);
    expect(entryStat.mode & 0o111).not.toBe(0);
    const source = fs.readFileSync(entry, "utf8");
    expect(source).toContain(`import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";`);
    expect(source).toContain(`"echo.service.v1.EchoService/Echo"`);
    expect(source).toContain(`ctx.getMetadata("x-octobus-ext-business-request-id")`);
    expect(source).not.toContain("x-business-request-id");

    const readme = fs.readFileSync(path.join(outDir, "README.md"), "utf8");
    expect(readme).toContain(`node bin/echo-service.js --runtime dev --port 50051 --config-json '{}' --secret-json '{}'`);

    const validateStdout = writableBuffer();
    await expect(runSdkCli({
      argv: ["validate", "--strict"],
      cwd: outDir,
      env: { OCTOBUS_PACKAGE_DIR: outDir },
      stdout: validateStdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(validateStdout.data()).toContain("service package is valid");
  });

  it("bootstraps a long-running service package when requested", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-long-running-"));
    const code = await runSdkCli({
      argv: [
        "bootstrap",
        "--name",
        "worker",
        "--out",
        outDir,
        "--runtime-mode",
        "long-running",
      ],
      cwd: fixturesDir,
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    });

    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "service.json"), "utf8"))).toMatchObject({
      name: "worker",
      runtime: { mode: "long-running" },
      proto: { files: ["proto/worker.proto"] },
    });
  });

  it("validates bootstrap arguments and output directory safety", async () => {
    const invalidName = writableBuffer();
    await expect(runSdkCli({
      argv: ["bootstrap", "--name", "Bad Name", "--out", "ignored"],
      cwd: fixturesDir,
      stdout: writableBuffer(),
      stderr: invalidName,
    })).resolves.toBe(1);
    expect(invalidName.data()).toContain("bootstrap --name");
    expect(invalidName.data()).toContain("is not a valid npm package name");

    const invalidRuntime = writableBuffer();
    await expect(runSdkCli({
      argv: ["bootstrap", "--name", "@acme/service", "--out", "ignored", "--runtime-mode", "daemon"],
      cwd: fixturesDir,
      stdout: writableBuffer(),
      stderr: invalidRuntime,
    })).resolves.toBe(1);
    expect(invalidRuntime.data()).toContain("bootstrap --runtime-mode must be on-demand or long-running");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-nonempty-"));
    fs.writeFileSync(path.join(outDir, "keep.txt"), "keep", "utf8");
    const nonEmpty = writableBuffer();
    await expect(runSdkCli({
      argv: ["bootstrap", "--name", "@acme/service", "--out", outDir],
      cwd: fixturesDir,
      stdout: writableBuffer(),
      stderr: nonEmpty,
    })).resolves.toBe(1);
    expect(nonEmpty.data()).toContain("is not empty; pass --force");
    expect(fs.existsSync(path.join(outDir, "package.json"))).toBe(false);

    await expect(runSdkCli({
      argv: ["bootstrap", "--name", "@acme/service", "--out", outDir, "--force"],
      cwd: fixturesDir,
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(fs.existsSync(path.join(outDir, "package.json"))).toBe(true);

    const help = writableBuffer();
    await expect(runSdkCli({
      argv: [],
      cwd: fixturesDir,
      stdout: help,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(help.data()).toContain("bootstrap");
  });

  it("bootstraps bundled dependencies when requested", async () => {
    const npmLog = path.join(os.tmpdir(), `octobus-bootstrap-npm-install-${process.pid}-${Date.now()}.log`);
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-npm-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.appendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(' ') + '\\n');`,
      "fs.mkdirSync(path.join(process.cwd(), 'node_modules', '@chaitin-ai', 'octobus-sdk'), { recursive: true });",
      "process.exit(0);",
      "",
    ].join("\n"), { mode: 0o755 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-bundled-"));
    const stdout = writableBuffer();
    await expect(runSdkCli({
      argv: [
        "bootstrap",
        "--name",
        "@acme/bundled-service",
        "--out",
        outDir,
        "--bundle-deps",
      ],
      cwd: fixturesDir,
      env: {
        ...process.env,
        PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdout,
      stderr: writableBuffer(),
    })).resolves.toBe(0);

    expect(stdout.data()).toContain("installed bundled production dependencies");
    expect(fs.readFileSync(npmLog, "utf8")).toContain("install --omit=dev");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toMatchObject({
      bundledDependencies: ["@chaitin-ai/octobus-sdk"],
    });
    expect(fs.existsSync(path.join(outDir, "node_modules", "@chaitin-ai", "octobus-sdk"))).toBe(true);
  });

  it("reports bootstrap bundled dependency install failures clearly", async () => {
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-npm-fail-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "console.error('registry unavailable');",
      "process.exit(42);",
      "",
    ].join("\n"), { mode: 0o755 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bootstrap-bundle-fail-"));
    const stderr = writableBuffer();
    await expect(runSdkCli({
      argv: [
        "bootstrap",
        "--name",
        "@acme/bundle-fail",
        "--out",
        outDir,
        "--bundle-deps",
      ],
      cwd: fixturesDir,
      env: {
        ...process.env,
        PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdout: writableBuffer(),
      stderr,
    })).resolves.toBe(1);

    expect(stderr.data()).toContain(`npm install --omit=dev failed in ${outDir}`);
    expect(stderr.data()).toContain("registry unavailable");
  });

  it("prints Connect RPC stub source", async () => {
    const stdout = writableBuffer();
    const code = await runSdkCli({
      argv: ["client-stub", "--transport", "connect", "--factory", "createCalculatorClient"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(code).toBe(0);
    expect(stdout.data()).toContain("export function createCalculatorClient(options)");
    expect(stdout.data()).toContain("calculator.v1.CalculatorService/Add");
  });

  it("prints gRPC stub source", async () => {
    const stdout = writableBuffer();
    const code = await runSdkCli({
      argv: ["client-stub", "--transport", "grpc", "--factory", "createCalculatorGrpcClient"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
    });

    expect(code).toBe(0);
    expect(stdout.data()).toContain("export function createCalculatorGrpcClient(options)");
    expect(stdout.data()).toContain("calculator.v1.CalculatorService/Add");
    expect(stdout.data()).toContain("createGrpcStub");
  });

  it("validates client-stub arguments and omits removed stub commands from help", async () => {
    const invalidTransport = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-stub", "--transport", "http"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidTransport,
    })).resolves.toBe(1);
    expect(invalidTransport.data()).toContain("client-stub --transport must be connect or grpc");

    const invalidFactory = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-stub", "--transport", "connect", "--factory", "Bad Name"],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidFactory,
    })).resolves.toBe(1);
    expect(invalidFactory.data()).toContain("client-stub --factory");

    const help = writableBuffer();
    await expect(runSdkCli({
      argv: [],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: help,
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(help.data()).toContain("client-stub");
    expect(help.data()).not.toContain("connect-stub");
    expect(help.data()).not.toContain("grpc-stub");
  });

  it("generates a Connect client package with descriptor-backed source and metadata", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-connect-client-"));
    const stdout = writableBuffer();
    const code = await runSdkCli({
      argv: [
        "client-package",
        "--transport",
        "connect",
        "--name",
        "@acme/calculator-client",
        "--out",
        outDir,
        "--factory",
        "createCalculatorClient",
      ],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout,
      stderr: writableBuffer(),
    });

    expect(code).toBe(0);
    expect(stdout.data()).toContain(`generated connect client package at ${outDir}`);
    expect(fs.existsSync(path.join(outDir, "descriptors", "descriptor.pb"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "descriptors", "service.json"), "utf8"))).toMatchObject({
      name: "calculator",
    });
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toEqual({
      name: "@acme/calculator-client",
      version: "0.1.0",
      type: "module",
      main: "index.js",
      types: "index.d.ts",
      dependencies: {
        "@chaitin-ai/octobus-sdk": "*",
      },
    });
    expect(fs.existsSync(path.join(outDir, "node_modules"))).toBe(false);

    const source = fs.readFileSync(path.join(outDir, "index.js"), "utf8");
    expect(source).toContain(`const descriptorPath = join(__dirname, "descriptors", "descriptor.pb");`);
    expect(source).toContain(`const manifestPath = join(__dirname, "descriptors", "service.json");`);
    expect(source).toContain("createConnectRpcStub({");
    expect(source).toContain(`"CalculatorService": {`);
    expect(source).toContain(`"Add": (request, options) => stub.invoke("calculator.v1.CalculatorService/Add", request, options),`);
    expect(source).not.toContain(`"Sum":`);

    const types = fs.readFileSync(path.join(outDir, "index.d.ts"), "utf8");
    expect(types).toContain("import type { ConnectRpcInvokeOptions, ConnectRpcStub, ConnectRpcStubOptions }");
    expect(types).toContain("export interface CalculatorServiceClient");
    expect(types).toContain("Add(request?: unknown, options?: ConnectRpcInvokeOptions): Promise<unknown>;");
    expect(types).not.toContain("Sum(");
  });

  it("generates a gRPC client package with streaming wrapper signatures and grpc dependency", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-grpc-client-"));
    const code = await runSdkCli({
      argv: [
        "client-package",
        "--transport",
        "grpc",
        "--name",
        "@acme/calculator-grpc-client",
        "--out",
        outDir,
      ],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    });

    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toMatchObject({
      dependencies: {
        "@chaitin-ai/octobus-sdk": "*",
        "@grpc/grpc-js": "^1.13.4",
      },
    });

    const source = fs.readFileSync(path.join(outDir, "index.js"), "utf8");
    expect(source).toContain("export function createGrpcClient(options)");
    expect(source).toContain(`"Add": (request, options) => stub.invoke("calculator.v1.CalculatorService/Add", request, options),`);
    expect(source).toContain(`"Sum": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Sum", requests, options),`);
    expect(source).toContain(`"Watch": (request, options) => stub.invoke("calculator.v1.CalculatorService/Watch", request, options),`);
    expect(source).toContain(`"Chat": (requests, options) => stub.invoke("calculator.v1.CalculatorService/Chat", requests, options),`);

    const types = fs.readFileSync(path.join(outDir, "index.d.ts"), "utf8");
    expect(types).toContain("import type { GrpcInvokeOptions, GrpcReadableResult, GrpcStub, GrpcStubOptions }");
    expect(types).toContain("Add(request?: unknown, options?: GrpcInvokeOptions): Promise<unknown>;");
    expect(types).toContain("Watch(request?: unknown, options?: GrpcInvokeOptions): GrpcReadableResult;");
    expect(types).toContain("Sum(");
    expect(types).toContain("requests: Iterable<unknown> | AsyncIterable<unknown>,");
    expect(types).toContain("): Promise<unknown>;");
    expect(types).toContain("Chat(");
    expect(types).toContain("): GrpcReadableResult;");
  });

  it("marks bundled client package dependencies and installs production dependencies when requested", async () => {
    const npmLog = path.join(os.tmpdir(), `octobus-npm-install-${process.pid}-${Date.now()}.log`);
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-npm-install-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.appendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(' ') + '\\n');`,
      "fs.mkdirSync(path.join(process.cwd(), 'node_modules', '@chaitin-ai', 'octobus-sdk'), { recursive: true });",
      "fs.mkdirSync(path.join(process.cwd(), 'node_modules', '@grpc', 'grpc-js'), { recursive: true });",
      "process.exit(0);",
      "",
    ].join("\n"), { mode: 0o755 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bundled-client-"));
    const code = await runSdkCli({
      argv: [
        "client-package",
        "--transport",
        "grpc",
        "--name",
        "@acme/bundled-grpc-client",
        "--out",
        outDir,
        "--bundle-deps",
      ],
      cwd: fixturesDir,
      env: {
        ...process.env,
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    });

    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toMatchObject({
      bundledDependencies: [
        "@chaitin-ai/octobus-sdk",
        "@grpc/grpc-js",
      ],
    });
    expect(fs.readFileSync(npmLog, "utf8")).toContain("install --omit=dev");
    expect(fs.existsSync(path.join(outDir, "node_modules", "@chaitin-ai", "octobus-sdk"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "node_modules", "@grpc", "grpc-js"))).toBe(true);
  });

  it("runs npm publish only when --publish is explicit", async () => {
    const publishLog = path.join(os.tmpdir(), `octobus-npm-publish-${process.pid}-${Date.now()}.log`);
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-npm-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(publishLog)}, process.argv.slice(2).join(' ') + '\\n');`,
      "process.exit(0);",
      "",
    ].join("\n"), { mode: 0o755 });

    const baseEnv = {
      ...process.env,
      OCTOBUS_PACKAGE_DIR: fixturesDir,
      PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    };

    const noPublishDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-no-publish-client-"));
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "connect", "--name", "@acme/no-publish", "--out", noPublishDir],
      cwd: fixturesDir,
      env: baseEnv,
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(fs.existsSync(publishLog)).toBe(false);

    const publishDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-publish-client-"));
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "connect", "--name", "@acme/publish", "--out", publishDir, "--publish"],
      cwd: fixturesDir,
      env: baseEnv,
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    })).resolves.toBe(0);
    expect(fs.readFileSync(publishLog, "utf8")).toContain("publish");
  });

  it("installs bundled dependencies before publishing when both flags are set", async () => {
    const npmLog = path.join(os.tmpdir(), `octobus-npm-bundle-publish-${process.pid}-${Date.now()}.log`);
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-npm-bundle-publish-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(npmLog)}, args.join(' ') + '\\n');`,
      "if (args[0] === 'install') {",
      "  fs.mkdirSync(path.join(process.cwd(), 'node_modules', '@chaitin-ai', 'octobus-sdk'), { recursive: true });",
      "}",
      "process.exit(0);",
      "",
    ].join("\n"), { mode: 0o755 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-bundle-publish-client-"));
    await expect(runSdkCli({
      argv: [
        "client-package",
        "--transport",
        "connect",
        "--name",
        "@acme/bundle-publish",
        "--out",
        outDir,
        "--bundle-deps",
        "--publish",
      ],
      cwd: fixturesDir,
      env: {
        ...process.env,
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdout: writableBuffer(),
      stderr: writableBuffer(),
    })).resolves.toBe(0);

    expect(fs.readFileSync(npmLog, "utf8").trim().split("\n")).toEqual([
      "install --omit=dev",
      "publish",
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"))).toMatchObject({
      bundledDependencies: ["@chaitin-ai/octobus-sdk"],
    });
  });

  it("reports npm publish failures clearly", async () => {
    const npmBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-npm-fail-bin-"));
    const npmBin = path.join(npmBinDir, "npm");
    fs.writeFileSync(npmBin, [
      "#!/usr/bin/env node",
      "console.error('publish denied');",
      "process.exit(42);",
      "",
    ].join("\n"), { mode: 0o755 });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-publish-fail-client-"));
    const stderr = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "connect", "--name", "@acme/publish-fail", "--out", outDir, "--publish"],
      cwd: fixturesDir,
      env: {
        ...process.env,
        OCTOBUS_PACKAGE_DIR: fixturesDir,
        PATH: `${npmBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdout: writableBuffer(),
      stderr,
    })).resolves.toBe(1);
    expect(stderr.data()).toContain("npm publish failed");
    expect(stderr.data()).toContain("publish denied");
  });

  it("refuses a non-empty client package output directory without --force", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-nonempty-client-"));
    fs.writeFileSync(path.join(outDir, "keep.txt"), "keep", "utf8");
    const stderr = writableBuffer();

    const code = await runSdkCli({
      argv: [
        "client-package",
        "--transport",
        "connect",
        "--name",
        "@acme/calculator-client",
        "--out",
        outDir,
      ],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr,
    });

    expect(code).toBe(1);
    expect(stderr.data()).toContain("is not empty; pass --force");
    expect(fs.existsSync(path.join(outDir, "package.json"))).toBe(false);
  });

  it("validates client-package arguments and source package before writing", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-invalid-client-"));
    const invalidTransport = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "http", "--name", "@acme/client", "--out", outDir],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidTransport,
    })).resolves.toBe(1);
    expect(invalidTransport.data()).toContain("client-package --transport must be connect or grpc");

    const invalidName = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "connect", "--name", "Bad Name", "--out", outDir],
      cwd: fixturesDir,
      env: { OCTOBUS_PACKAGE_DIR: fixturesDir },
      stdout: writableBuffer(),
      stderr: invalidName,
    })).resolves.toBe(1);
    expect(invalidName.data()).toContain("is not a valid npm package name");

    const invalidPackageDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-invalid-source-"));
    fs.writeFileSync(path.join(invalidPackageDir, "package.json"), JSON.stringify({
      type: "module",
      bin: { bad: "handler.js" },
    }), "utf8");
    fs.writeFileSync(path.join(invalidPackageDir, "handler.js"), "", "utf8");
    fs.writeFileSync(path.join(invalidPackageDir, "service.json"), JSON.stringify({
      schema: "wrong",
      name: "bad",
      proto: { roots: ["proto"], files: ["bad.proto"] },
    }), "utf8");
    const sourceError = writableBuffer();
    await expect(runSdkCli({
      argv: ["client-package", "--transport", "connect", "--name", "@acme/client", "--out", outDir, "--force"],
      cwd: invalidPackageDir,
      env: { OCTOBUS_PACKAGE_DIR: invalidPackageDir },
      stdout: writableBuffer(),
      stderr: sourceError,
    })).resolves.toBe(1);
    expect(sourceError.data()).toContain("service package validation failed");
    expect(sourceError.data()).toContain("service.json schema must be chaitin.octobus.service.v1");
    expect(fs.existsSync(path.join(outDir, "package.json"))).toBe(false);
  });
});

function writableBuffer() {
  let data = "";
  return {
    write(chunk: string | Uint8Array): boolean {
      data += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    },
    data(): string {
      return data;
    },
  };
}
