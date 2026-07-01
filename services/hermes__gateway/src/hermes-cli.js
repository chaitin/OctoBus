import { spawn } from "node:child_process";

import { HermesClientError, timeoutMs } from "./hermes-client.js";

const DEFAULT_CLI_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_SIGNATURE = "From XY@Agent";
const LOG_NAMES = new Set(["agent", "errors", "gateway", "gui", "desktop", "list"]);
const LEVELS = new Set(["DEBUG", "INFO", "WARNING", "ERROR"]);
const SKILL_SOURCES = new Set(["all", "hub", "builtin", "local"]);

function maxOutputBytes(config = {}) {
  const raw = Number(config.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_OUTPUT_BYTES;
  return Math.max(4096, Math.min(raw, 5 * 1024 * 1024));
}

function truncateOutput(value, limit) {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  return `${text.slice(0, limit)}\n... truncated ...`;
}

function redactText(value, redactions = []) {
  let text = String(value || "");
  for (const item of redactions) {
    const secret = String(item || "");
    if (secret) text = text.replaceAll(secret, "******");
  }
  return text;
}

function validatePlainToken(value, field, pattern) {
  const raw = String(value || "").trim();
  if (!raw || !pattern.test(raw)) {
    throw new HermesClientError("INVALID_ARGUMENT", `${field} contains unsupported characters`);
  }
  return raw;
}

function validateOptionalPlainToken(value, field, pattern) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return validatePlainToken(raw, field, pattern);
}

function validateName(value, field = "name") {
  return validatePlainToken(value, field, /^[A-Za-z0-9_.:@/-]{1,128}$/);
}

function validatePlatform(value) {
  return validateOptionalPlainToken(value || "cli", "platform", /^[A-Za-z0-9_.-]{1,64}$/) || "cli";
}

function validateCommaList(value, field) {
  return validateOptionalPlainToken(value, field, /^[A-Za-z0-9_.:@,/-]{1,512}$/);
}

function validateDeliver(value) {
  return validateOptionalPlainToken(value, "deliver", /^[A-Za-z0-9_.:@#=+/-]{1,256}$/);
}

function validateJsonString(value, field) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    JSON.parse(raw);
  } catch (error) {
    throw new HermesClientError("INVALID_ARGUMENT", `${field} must be valid JSON: ${error.message}`);
  }
  return raw;
}

function validateWorkdir(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("/") || raw.includes("..") || raw.length > 512) {
    throw new HermesClientError("INVALID_ARGUMENT", "workdir must be an absolute path without '..'");
  }
  return raw;
}

function resolveNamedSecret(secret, name, field) {
  const secretName = String(name || "").trim();
  if (!secretName) return "";
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(secretName)) {
    throw new HermesClientError("INVALID_ARGUMENT", `${field} contains unsupported characters`);
  }
  const secrets = secret?.webhookHmacSecrets || {};
  const value = typeof secrets === "object" && secrets !== null ? secrets[secretName] : "";
  if (!value) {
    throw new HermesClientError("FAILED_PRECONDITION", `webhook HMAC secret '${secretName}' is not configured`);
  }
  return String(value);
}

function validateCliMode(config = {}) {
  const mode = String(config.cliMode || "disabled").trim();
  if (!["disabled", "local", "ssh"].includes(mode)) {
    throw new HermesClientError("INVALID_ARGUMENT", "config.cliMode must be disabled, local, or ssh");
  }
  if (mode === "disabled") {
    throw new HermesClientError("FAILED_PRECONDITION", "Hermes CLI methods require config.cliMode to be local or ssh");
  }
  return mode;
}

function shellQuote(arg) {
  return `'${String(arg).replaceAll("'", "'\\''")}'`;
}

function commandForEvidence(mode, config, args) {
  const cli = String(config.cliBinary || "hermes");
  if (mode === "ssh") {
    const target = String(config.sshTarget || "");
    return `ssh ${target} ${[cli, ...args].map(shellQuote).join(" ")}`;
  }
  return [cli, ...args].map(shellQuote).join(" ");
}

function spawnSpec(mode, config, args) {
  const cli = String(config.cliBinary || "hermes");
  if (mode === "ssh") {
    const target = String(config.sshTarget || "").trim();
    if (!target) throw new HermesClientError("INVALID_ARGUMENT", "config.sshTarget is required when cliMode is ssh");
    const sshOptions = Array.isArray(config.sshOptions) ? config.sshOptions.map(String) : [];
    return {
      command: "ssh",
      args: [...sshOptions, target, [cli, ...args].map(shellQuote).join(" ")],
    };
  }
  return { command: cli, args };
}

export function buildEvidence({ command, stdin, exitCode, stdout, stderr }) {
  return [
    "# Command",
    command,
    "",
    "# Stdin",
    stdin ? "<provided via stdin>" : "<empty>",
    "",
    "# Response",
    `exit_code=${exitCode}`,
    "",
    "## Stdout",
    stdout || "<empty>",
    "",
    "## Stderr",
    stderr || "<empty>",
  ].join("\n");
}

export async function runHermesCli(ctx, args, options = {}) {
  const config = ctx?.config || {};
  const mode = validateCliMode(config);
  const { command, args: spawnArgs } = spawnSpec(mode, config, args);
  const evidenceCommand = commandForEvidence(mode, config, args);
  const limit = maxOutputBytes(config);
  const timeout = timeoutMs({ timeoutMs: DEFAULT_CLI_TIMEOUT_MS }, options.timeoutMs || ctx?.request?.timeoutMs);

  const child = spawn(command, spawnArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(config.env || {}) },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = truncateOutput(stdout + chunk, limit);
  });
  child.stderr.on("data", (chunk) => {
    stderr = truncateOutput(stderr + chunk, limit);
  });

  const stdin = options.stdin || "";
  if (stdin) child.stdin.end(stdin);
  else child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new HermesClientError("DEADLINE_EXCEEDED", "Hermes CLI command timed out"));
    }, timeout);
    timer.unref?.();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new HermesClientError("UNAVAILABLE", error.message || "Hermes CLI command failed to start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  const result = {
    ok: exitCode === 0,
    exitCode,
    command: redactText(evidenceCommand, options.redactValues),
    stdout: redactText(stdout, options.redactValues),
    stderr: redactText(stderr, options.redactValues),
    evidence: buildEvidence({
      command: redactText(evidenceCommand, options.redactValues),
      stdin,
      exitCode,
      stdout: redactText(stdout, options.redactValues),
      stderr: redactText(stderr, options.redactValues),
    }),
  };
  if (exitCode !== 0) {
    throw new HermesClientError("FAILED_PRECONDITION", stderr || stdout || "Hermes CLI command failed", result);
  }
  return result;
}

export function getGatewayStatus(ctx) {
  return runHermesCli(ctx, ["gateway", "status"]);
}

export function getComponentStatus(ctx) {
  return runHermesCli(ctx, ["status", "--all"]);
}

export function listSendTargets(ctx) {
  return runHermesCli(ctx, ["send", "--list", "--json"]);
}

export function listWebhookSubscriptions(ctx) {
  return runHermesCli(ctx, ["webhook", "list"]);
}

export function listCronJobs(ctx) {
  return runHermesCli(ctx, ["cron", "list"]);
}

export function listPlugins(ctx) {
  return runHermesCli(ctx, ["plugins", "list", "--plain", "--no-bundled"]);
}

export function listMcpServers(ctx) {
  return runHermesCli(ctx, ["mcp", "list"]);
}

export function testMcpServer(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["mcp", "test", validateName(request.name)], { timeoutMs: request.timeoutMs });
}

export function listSkills(ctx) {
  const request = ctx?.request || {};
  const args = ["skills", "list"];
  if (request.source) {
    const source = String(request.source).trim();
    if (!SKILL_SOURCES.has(source)) throw new HermesClientError("INVALID_ARGUMENT", "source must be all, hub, builtin, or local");
    args.push("--source", source);
  }
  if (request.enabledOnly) args.push("--enabled-only");
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs });
}

export function listTools(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["tools", "list", "--platform", validatePlatform(request.platform)], { timeoutMs: request.timeoutMs });
}

function toolsMutation(ctx, action) {
  const request = ctx?.request || {};
  const names = Array.isArray(request.names) ? request.names.map((name) => validateName(name, "names")) : [];
  if (names.length === 0) throw new HermesClientError("INVALID_ARGUMENT", "names must contain at least one tool name");
  return runHermesCli(ctx, ["tools", action, "--platform", validatePlatform(request.platform), ...names], { timeoutMs: request.timeoutMs });
}

export function enableTools(ctx) {
  return toolsMutation(ctx, "enable");
}

export function disableTools(ctx) {
  return toolsMutation(ctx, "disable");
}

export function getMemoryStatus(ctx) {
  return runHermesCli(ctx, ["memory", "status"]);
}

export function configCheck(ctx) {
  return runHermesCli(ctx, ["config", "check"]);
}

export function doctor(ctx) {
  const request = ctx?.request || {};
  const args = ["doctor"];
  if (request.fix) args.push("--fix");
  if (request.ack) args.push("--ack", validateName(request.ack, "ack"));
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs || 120000 });
}

export function securityAudit(ctx) {
  return runHermesCli(ctx, ["security", "audit"], { timeoutMs: ctx?.request?.timeoutMs || 120000 });
}

export function createWebhookSubscription(ctx) {
  const request = ctx?.request || {};
  const args = ["webhook", "subscribe", validateName(request.name)];
  if (request.prompt) args.push("--prompt", String(request.prompt).slice(0, 12000));
  if (request.events) args.push("--events", validateCommaList(request.events, "events"));
  if (request.description) args.push("--description", String(request.description).slice(0, 1000));
  if (request.skills) args.push("--skills", validateCommaList(request.skills, "skills"));
  if (request.deliver) args.push("--deliver", validateDeliver(request.deliver));
  if (request.deliverChatId) args.push("--deliver-chat-id", validateDeliver(request.deliverChatId));
  const webhookSecret = resolveNamedSecret(ctx?.secret || {}, request.secretName, "secretName") || (request.secret ? String(request.secret) : "");
  if (webhookSecret) args.push("--secret", webhookSecret.slice(0, 512));
  if (request.deliverOnly) args.push("--deliver-only");
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs, redactValues: [webhookSecret] });
}

export function testWebhookSubscription(ctx) {
  const request = ctx?.request || {};
  const args = ["webhook", "test", validateName(request.name)];
  const payload = validateJsonString(request.payloadJson, "payloadJson");
  if (payload) args.push("--payload", payload);
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs });
}

export function removeWebhookSubscription(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["webhook", "remove", validateName(request.name)], { timeoutMs: request.timeoutMs });
}

export function createCronJob(ctx) {
  const request = ctx?.request || {};
  const schedule = String(request.schedule || "").trim();
  if (!schedule || schedule.length > 128 || !/^[A-Za-z0-9_ */,@.-]+$/.test(schedule)) {
    throw new HermesClientError("INVALID_ARGUMENT", "schedule is required and contains unsupported characters");
  }
  const args = ["cron", "create", schedule];
  if (request.prompt) args.push(String(request.prompt).slice(0, 12000));
  if (request.name) args.push("--name", String(request.name).slice(0, 200));
  if (request.deliver) args.push("--deliver", validateDeliver(request.deliver));
  if (request.repeat) {
    const repeat = Number(request.repeat);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10000) throw new HermesClientError("INVALID_ARGUMENT", "repeat must be between 1 and 10000");
    args.push("--repeat", String(repeat));
  }
  for (const skill of Array.isArray(request.skills) ? request.skills : []) args.push("--skill", validateName(skill, "skills"));
  if (request.script) args.push("--script", validateName(request.script, "script"));
  if (request.noAgent) args.push("--no-agent");
  if (request.workdir) args.push("--workdir", validateWorkdir(request.workdir));
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs });
}

export function pauseCronJob(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["cron", "pause", validateName(request.name, "job_id")], { timeoutMs: request.timeoutMs });
}

export function resumeCronJob(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["cron", "resume", validateName(request.name, "job_id")], { timeoutMs: request.timeoutMs });
}

export function runCronJob(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["cron", "run", validateName(request.name, "job_id")], { timeoutMs: request.timeoutMs || 120000 });
}

export function removeCronJob(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["cron", "remove", validateName(request.name, "job_id")], { timeoutMs: request.timeoutMs });
}

export function enablePlugin(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["plugins", "enable", validateName(request.name)], { timeoutMs: request.timeoutMs });
}

export function disablePlugin(ctx) {
  const request = ctx?.request || {};
  return runHermesCli(ctx, ["plugins", "disable", validateName(request.name)], { timeoutMs: request.timeoutMs });
}

export function listSessions(ctx) {
  const request = ctx?.request || {};
  const args = ["sessions", "list"];
  if (request.source) args.push("--source", validatePlatform(request.source));
  if (request.limit) {
    const limit = Number(request.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new HermesClientError("INVALID_ARGUMENT", "limit must be between 1 and 500");
    args.push("--limit", String(limit));
  }
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs });
}

export function getSessionsStats(ctx) {
  return runHermesCli(ctx, ["sessions", "stats"]);
}

export function getLogs(ctx) {
  const request = ctx?.request || {};
  const logName = request.logName ? String(request.logName).trim() : "agent";
  if (!LOG_NAMES.has(logName)) {
    throw new HermesClientError("INVALID_ARGUMENT", "logName must be one of agent, errors, gateway, gui, desktop, list");
  }
  const lines = Number(request.lines || 50);
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000) {
    throw new HermesClientError("INVALID_ARGUMENT", "lines must be an integer between 1 and 1000");
  }
  const args = ["logs", logName, "--lines", String(lines)];
  if (request.since) args.push("--since", validatePlainToken(request.since, "since", /^[0-9]+[mhd]$/));
  if (request.level) {
    const level = String(request.level).trim().toUpperCase();
    if (!LEVELS.has(level)) throw new HermesClientError("INVALID_ARGUMENT", "level must be DEBUG, INFO, WARNING, or ERROR");
    args.push("--level", level);
  }
  if (request.component) {
    args.push("--component", validatePlainToken(request.component, "component", /^[A-Za-z0-9_.-]{1,64}$/));
  }
  return runHermesCli(ctx, args, { timeoutMs: request.timeoutMs });
}

function normalizeMessageTarget(target) {
  const raw = String(target || "").trim();
  if (!raw || raw.length > 256 || !/^[A-Za-z0-9_+@:#=./-]+$/.test(raw)) {
    throw new HermesClientError("INVALID_ARGUMENT", "target is required and contains unsupported characters");
  }
  return raw;
}

function ensureSignature(target, message, config = {}) {
  const text = String(message || "");
  const signature = String(config.messageSignature || DEFAULT_SIGNATURE).trim();
  if (!target.startsWith("dingtalk") || !signature) return text;
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(signature)) return text;

  const finalSuffix = signature.split(/\r?\n/).at(-1)?.trim();
  if (finalSuffix && finalSuffix !== signature && trimmed.endsWith(finalSuffix)) {
    return `${trimmed.slice(0, -finalSuffix.length).trimEnd()}\n${signature}`;
  }
  return `${trimmed}\n${signature}`;
}

export function sendMessage(ctx) {
  const request = ctx?.request || {};
  const target = normalizeMessageTarget(request.target);
  const message = ensureSignature(target, request.message, ctx?.config || {});
  if (!message.trim()) throw new HermesClientError("INVALID_ARGUMENT", "message is required");

  const allowedTargets = Array.isArray(ctx?.config?.allowedTargets) ? ctx.config.allowedTargets.map(String) : [];
  if (allowedTargets.length > 0 && !allowedTargets.includes(target)) {
    throw new HermesClientError("PERMISSION_DENIED", `target ${target} is not in config.allowedTargets`);
  }

  const args = ["send", "--to", target, "--json", "--file", "-"];
  if (request.subject) args.push("--subject", String(request.subject).slice(0, 200));
  return runHermesCli(ctx, args, { stdin: message, timeoutMs: request.timeoutMs });
}
