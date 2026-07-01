#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const servicesRoot = path.join(repoRoot, "services");
const octobusBin = path.join(repoRoot, "bin", "octobus");

const options = parseArgs(process.argv.slice(2));
const selectedServiceDirs = options.serviceDirs.length > 0
  ? options.serviceDirs
  : fs.readdirSync(servicesRoot)
    .filter((dir) => fs.existsSync(path.join(servicesRoot, dir, "service.json")))
    .sort();

if (!fs.existsSync(octobusBin)) {
  throw new Error("bin/octobus is missing; run task build first");
}

const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "octobus-service-smoke."));
const mock = await startMockUpstream();
const addr = `127.0.0.1:${await freePort()}`;
const daemon = spawn(octobusBin, ["serve", "--addr", addr, "--data-dir", dataDir], {
  cwd: repoRoot,
  env: { ...process.env, OCTOBUS_ADDR: addr, OCTOBUS_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});

const daemonOutput = { stdout: "", stderr: "" };
daemon.stdout.on("data", (chunk) => {
  daemonOutput.stdout += chunk.toString();
});
daemon.stderr.on("data", (chunk) => {
  daemonOutput.stderr += chunk.toString();
});

const evidence = [];
let failed = false;

try {
  await waitForDaemon(addr, daemon);
  for (const [index, serviceDir] of selectedServiceDirs.entries()) {
    const result = await smokeService({ index, serviceDir, addr, mockBaseURL: mock.baseURL });
    evidence.push(result);
    const status = result.ok ? "ok" : "failed";
    console.error(`[${index + 1}/${selectedServiceDirs.length}] ${status} ${serviceDir} ${result.method ?? ""} http=${result.http_status ?? ""} mock_hits=${result.mock_hits}`);
    if (!result.ok) {
      failed = true;
      if (!options.continueOnError) {
        break;
      }
    }
  }
} finally {
  daemon.kill("SIGINT");
  await waitProcess(daemon).catch(() => undefined);
  await mock.close();
  if (!options.keepDataDir && !options.dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  data_dir: options.keepDataDir || options.dataDir ? dataDir : undefined,
  octobus_addr: addr,
  mock_upstream: mock.baseURL,
  service_count: evidence.length,
  ok_count: evidence.filter((item) => item.ok).length,
  failed_count: evidence.filter((item) => !item.ok).length,
  evidence,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (failed) {
  process.exitCode = 1;
}

async function smokeService({ index, serviceDir, addr, mockBaseURL }) {
  const manifest = readJSON(path.join(servicesRoot, serviceDir, "service.json"));
  const serviceID = manifest.name;
  const instanceID = `smoke-${String(index + 1).padStart(3, "0")}`;
  const capsetID = `smoke-cap-${String(index + 1).padStart(3, "0")}`;
  const beforeHits = mock.hitCount;
  const result = {
    service_dir: serviceDir,
    service_id: serviceID,
    source: `./services//${serviceDir}`,
    instance_id: instanceID,
    capset_id: capsetID,
    runtime_mode: manifest.runtime?.mode ?? "long-running",
    ok: false,
    mock_hits: 0,
  };

  try {
    await cli(addr, ["service", "import", serviceID, `./services//${serviceDir}`, "--build", "never"], { timeoutMs: options.importTimeoutMs });
    const config = synthesizeSchemaFile(path.join(servicesRoot, serviceDir, manifest.configSchema ?? "config.schema.json"), mockBaseURL, "config");
    const secret = synthesizeSchemaFile(path.join(servicesRoot, serviceDir, manifest.secretSchema ?? "secret.schema.json"), mockBaseURL, "secret");
    result.config_keys = Object.keys(config).sort();
    result.secret_keys = Object.keys(secret).sort();

    await cli(addr, ["instance", "create", instanceID, "--service", serviceID, "--config-json", JSON.stringify(config), "--secret-json", JSON.stringify(secret)], { timeoutMs: options.instanceTimeoutMs });
    await cli(addr, ["capset", "create", capsetID, "--name", capsetID], { timeoutMs: options.commandTimeoutMs });
    await cli(addr, ["capset", "add-instance", capsetID, instanceID], { timeoutMs: options.commandTimeoutMs });

    const catalog = await cliJSON(addr, ["catalog", capsetID, "--connect", "--json"], { timeoutMs: options.commandTimeoutMs });
    const connect = catalog.connect_rpc?.[0];
    if (!connect) {
      throw new Error("catalog did not expose any Connect RPC methods");
    }
    result.method = connect.method_full_name;
    result.connect_endpoint = connect.endpoint;

    const request = await sampleRequestFromOpenAPI(addr, capsetID, connect.endpoint);
    result.request_keys = Object.keys(request).sort();

    const response = await fetch(`http://${addr}${connect.endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-octobus-ext-smoke-id": serviceID,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(options.callTimeoutMs),
    });
    const body = await response.text();
    result.http_status = response.status;
    result.response_summary = summarizeBody(body);
    result.mock_hits = mock.hitCount - beforeHits;
    result.ok = isAcceptableConnectResult(response.status, body);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.mock_hits = mock.hitCount - beforeHits;
  } finally {
    await cli(addr, ["capset", "delete", capsetID], { timeoutMs: options.commandTimeoutMs, allowFailure: true }).catch(() => undefined);
    await cli(addr, ["instance", "delete", instanceID], { timeoutMs: options.commandTimeoutMs, allowFailure: true }).catch(() => undefined);
  }

  return result;
}

function parseArgs(args) {
  const parsed = {
    serviceDirs: [],
    commandTimeoutMs: 30_000,
    importTimeoutMs: 120_000,
    instanceTimeoutMs: 60_000,
    callTimeoutMs: 10_000,
    continueOnError: true,
    keepDataDir: false,
    dataDir: undefined,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--service-dir") {
      parsed.serviceDirs.push(requiredValue(args, ++i, arg));
    } else if (arg === "--data-dir") {
      parsed.dataDir = requiredValue(args, ++i, arg);
    } else if (arg === "--keep-data-dir") {
      parsed.keepDataDir = true;
    } else if (arg === "--fail-fast") {
      parsed.continueOnError = false;
    } else if (arg === "--call-timeout-ms") {
      parsed.callTimeoutMs = Number(requiredValue(args, ++i, arg));
    } else if (arg === "--import-timeout-ms") {
      parsed.importTimeoutMs = Number(requiredValue(args, ++i, arg));
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function startMockUpstream() {
  let hitCount = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    hitCount += 1;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method,
        url: req.url,
        headers: {
          authorization: req.headers.authorization ? "present" : undefined,
          contentType: req.headers["content-type"],
        },
        bodyLength: body.length,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        code: 0,
        msg: "ok",
        message: "ok",
        data: {},
        result: {},
        items: [],
        list: [],
        total: 0,
        request_id: "smoke-request",
        token: "mock-token",
        session: "mock-session",
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    get hitCount() {
      return hitCount;
    },
    get requests() {
      return requests;
    },
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForDaemon(addr, daemon) {
  const deadline = Date.now() + 15_000;
  let last = "";
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) {
      throw new Error(`octobus daemon exited early: ${daemon.exitCode}`);
    }
    try {
      const response = await fetch(`http://${addr}/admin/v1/status`, { signal: AbortSignal.timeout(1_000) });
      last = await response.text();
      if (response.ok) {
        return;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`octobus daemon did not become ready: ${last}`);
}

function cli(addr, args, { timeoutMs, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(octobusBin, args, {
      cwd: repoRoot,
      env: { ...process.env, OCTOBUS_ADDR: addr },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`octobus ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !allowFailure) {
        reject(new Error(`octobus ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

async function cliJSON(addr, args, options) {
  const result = await cli(addr, args, options);
  return JSON.parse(result.stdout);
}

async function sampleRequestFromOpenAPI(addr, capsetID, endpoint) {
  const response = await fetch(`http://${addr}/capsets/${capsetID}/openapi.json`, { signal: AbortSignal.timeout(options.commandTimeoutMs) });
  if (!response.ok) {
    return {};
  }
  const spec = await response.json();
  const operation = spec.paths?.[endpoint]?.post;
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) {
    return {};
  }
  return synthesizeSchema(resolveSchema(schema, spec), "", "request", spec);
}

function synthesizeSchemaFile(schemaPath, mockBaseURL, kind) {
  if (!fs.existsSync(schemaPath)) {
    return {};
  }
  return synthesizeSchema(readJSON(schemaPath), mockBaseURL, kind);
}

function synthesizeSchema(schema, mockBaseURL, kind, root = undefined, propertyName = "") {
  schema = resolveSchema(schema, root);
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.default !== undefined && !shouldPopulateOptional(propertyName, schema)) {
    return schema.default;
  }
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const object = {};
    const requiredNames = new Set(schema.required ?? []);
    for (const name of schema.oneOf?.[0]?.required ?? []) {
      requiredNames.add(name);
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const populateOptional = !schema.oneOf && shouldPopulateOptional(name, child);
      if (kind === "request" || requiredNames.has(name) || populateOptional) {
        object[name] = synthesizeSchema(child, mockBaseURL, kind, root, name);
      }
    }
    if (Object.keys(object).length === 0 && schema.oneOf?.length) {
      return synthesizeSchema(schema.oneOf[0], mockBaseURL, kind, root, propertyName);
    }
    return object;
  }
  if (schema.oneOf?.length) {
    return synthesizeSchema(schema.oneOf[0], mockBaseURL, kind, root, propertyName);
  }
  if (schema.anyOf?.length) {
    return synthesizeSchema(schema.anyOf[0], mockBaseURL, kind, root, propertyName);
  }
  if (type === "array") {
    const minItems = schema.minItems ?? (kind === "request" ? 1 : 0);
    return Array.from({ length: minItems }, () => synthesizeSchema(schema.items ?? { type: "string" }, mockBaseURL, kind, root, propertyName));
  }
  if (type === "integer" || type === "number") {
    return numberSample(propertyName, schema);
  }
  if (type === "boolean") {
    return booleanSample(propertyName);
  }
  return stringSample(propertyName, schema, mockBaseURL, kind);
}

function resolveSchema(schema, root) {
  if (!schema?.$ref || !root) {
    return schema ?? {};
  }
  if (!schema.$ref.startsWith("#/")) {
    return schema;
  }
  return schema.$ref.slice(2).split("/").reduce((current, part) => current?.[part], root) ?? schema;
}

function shouldPopulateOptional(name, schema) {
  const lower = name.toLowerCase();
  return lower.includes("url")
    || lower.includes("host")
    || lower.includes("endpoint")
    || lower.includes("token")
    || lower.includes("key")
    || lower.includes("secret")
    || lower.includes("password")
    || lower.includes("username")
    || lower.includes("timeout")
    || lower.includes("region")
    || lower.includes("tenant")
    || lower.includes("webhook")
    || schema?.format === "uri";
}

function stringSample(name, schema, mockBaseURL, kind) {
  const lower = name.toLowerCase();
  if (schema.format === "uri" || lower.includes("url") || lower.includes("endpoint") || lower.includes("webhook")) {
    return mockBaseURL || "http://127.0.0.1:1";
  }
  if (lower === "host" || lower.endsWith("host") || lower.includes("hostname") || lower.includes("server")) {
    return mockBaseURL ? new URL(mockBaseURL).host : "127.0.0.1";
  }
  if (lower.includes("ip")) {
    return "127.0.0.1";
  }
  if (lower.includes("cve")) {
    return "CVE-2024-0001";
  }
  if (lower.includes("domain")) {
    return "example.com";
  }
  if (lower.includes("url")) {
    return mockBaseURL ? `${mockBaseURL}/smoke` : "http://127.0.0.1:1/smoke";
  }
  if (lower.includes("port")) {
    return "443";
  }
  if (lower.includes("email")) {
    return "smoke@example.com";
  }
  if (lower.includes("method")) {
    return "GET";
  }
  if (lower.includes("path")) {
    return "/smoke";
  }
  if (lower.includes("region")) {
    return "cn-smoke";
  }
  if (lower.includes("username") || lower === "user") {
    return "smoke-user";
  }
  if (lower.includes("password")) {
    return "smoke-password";
  }
  if (lower.includes("token") || lower.includes("secret") || lower.includes("key") || lower.includes("ak") || lower.includes("sk")) {
    return "smoke-secret";
  }
  if (lower.includes("id")) {
    return "smoke-id";
  }
  if (lower.includes("time") || lower.includes("date")) {
    return "2026-06-30T00:00:00Z";
  }
  return kind === "request" ? "smoke" : "smoke-value";
}

function numberSample(name, schema) {
  const lower = name.toLowerCase();
  if (lower.includes("timeout")) {
    return 5000;
  }
  if (lower.includes("port")) {
    return 443;
  }
  const min = schema.minimum ?? schema.exclusiveMinimum;
  if (typeof min === "number") {
    return min + (schema.exclusiveMinimum !== undefined ? 1 : 0);
  }
  return 1;
}

function booleanSample(name) {
  const lower = name.toLowerCase();
  if (lower.includes("skip") || lower.includes("insecure")) {
    return false;
  }
  return true;
}

function isAcceptableConnectResult(status, body) {
  if (status >= 200 && status < 300) {
    return true;
  }
  const lower = body.toLowerCase();
  const infrastructureFailures = [
    "service.json not found",
    "runtime entry",
    "backend instance is not running",
    "method is not implemented",
    "on-demand response is not valid protobuf",
    "octobus_package_dir",
  ];
  return !infrastructureFailures.some((needle) => lower.includes(needle));
}

function summarizeBody(body) {
  if (!body) {
    return "";
  }
  return body.replace(/\s+/g, " ").slice(0, 300);
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitProcess(child) {
  return new Promise((resolve, reject) => {
    child.once("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`process exited with code ${code}`));
      }
    });
  });
}
