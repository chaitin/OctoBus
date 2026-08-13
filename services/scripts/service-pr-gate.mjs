#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SERVICE_DIR_RE = /^[a-z0-9][a-z0-9-]*__[a-z0-9][a-z0-9._-]*$/;
const SHARED_SERVICE_FILES = new Set([
  "services/package.json",
  "services/bin/octobus-tentacles.js",
]);
const SHARED_WRAPPER_RE = /^services\/bin\/[^/]+\.js$/;
const FORBIDDEN_FILE_RE = /(?:^|\/)(?:node_modules|coverage|\.env)(?:\/|$)|\.(?:tgz|tar\.gz|zip|log|png|jpe?g|gif|webp)$/i;
const CORE_PREFIXES = ["cmd/", "internal/", "sdk/", "tests/", "examples/", "npm/", "docker/"];

export function parseArgs(argv) {
  const options = {
    base: process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main",
    head: "HEAD",
    dryRun: false,
    skipSmoke: false,
    skipInstall: false,
    changedFiles: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") options.base = requiredValue(argv, ++index, arg);
    else if (arg.startsWith("--base=")) options.base = arg.slice(7);
    else if (arg === "--head") options.head = requiredValue(argv, ++index, arg);
    else if (arg.startsWith("--head=")) options.head = arg.slice(7);
    else if (arg === "--changed-files") options.changedFiles = requiredValue(argv, ++index, arg).split(",").filter(Boolean);
    else if (arg.startsWith("--changed-files=")) options.changedFiles = arg.slice(16).split(",").filter(Boolean);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-smoke") options.skipSmoke = true;
    else if (arg === "--skip-install") options.skipInstall = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  if (!argv[index]) throw new Error(`${flag} requires a value`);
  return argv[index];
}

export function classifyChanges(files, repoRoot) {
  const errors = [];
  const forbiddenFiles = [];
  const serviceDirs = new Set();
  let touchesCore = false;
  let touchesServiceInfrastructure = false;

  for (const file of files) {
    const normalized = file.replaceAll(path.win32.sep, "/");
    if (FORBIDDEN_FILE_RE.test(normalized)) {
      forbiddenFiles.push(normalized);
    }
    if (CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) touchesCore = true;
    if (!normalized.startsWith("services/")) continue;

    const relative = normalized.slice("services/".length);
    const first = relative.split("/", 1)[0];
    if (SERVICE_DIR_RE.test(first)) {
      serviceDirs.add(first);
      continue;
    }
    if (SHARED_SERVICE_FILES.has(normalized) || SHARED_WRAPPER_RE.test(normalized)) continue;
    touchesServiceInfrastructure = true;
  }

  if (serviceDirs.size > 1) {
    errors.push(`service PR must change exactly one service root; found: ${[...serviceDirs].sort().join(", ")}`);
  }
  if (serviceDirs.size > 0) {
    for (const file of forbiddenFiles) {
      errors.push(`forbidden generated, binary, evidence, or secret-like file: ${file}`);
    }
  }
  if (serviceDirs.size > 0 && touchesCore) {
    errors.push("service PR must not mix a service implementation with runtime, SDK, examples, tests, npm, or Docker changes");
  }
  if (serviceDirs.size > 0 && touchesServiceInfrastructure) {
    errors.push("service PR contains non-whitelisted shared services infrastructure changes; split them into a prerequisite PR");
  }
  for (const serviceDir of serviceDirs) {
    if (!fs.existsSync(path.join(repoRoot, "services", serviceDir, "service.json"))) {
      errors.push(`changed service ${serviceDir} is deleted or has no service.json; removals require an infrastructure review`);
    }
  }
  return { errors, serviceDirs: [...serviceDirs].sort(), touchesCore, touchesServiceInfrastructure };
}

export function plannedCommands(serviceDirs, { skipSmoke = false, skipInstall = false } = {}) {
  const commands = [];
  if (!skipInstall) commands.push(["npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], "services"]);
  for (const serviceDir of serviceDirs) {
    commands.push(["node", ["scripts/validate-service-package.mjs", "--service-dir", serviceDir], "services"]);
    commands.push(["node", ["scripts/run-tests.mjs", "--service-dir", serviceDir, "--coverage", "--coverage-threshold=80"], "services"]);
  }
  commands.push(["npm", ["run", "pack:check"], "services"]);
  if (!skipSmoke) {
    commands.push(["bash", ["./scripts/build-octobus.sh", "bin/octobus"], "."]);
    for (const serviceDir of serviceDirs) {
      commands.push(["node", ["scripts/service-package-smoke.mjs", "--service-dir", serviceDir, "--fail-fast"], "."]);
    }
  }
  return commands;
}

function gitChangedFiles(repoRoot, base, head) {
  const mergeBase = runCapture("git", ["merge-base", base, head], repoRoot).trim();
  return runCapture("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${mergeBase}...${head}`], repoRoot)
    .split(/\r?\n/).filter(Boolean);
}

function runCapture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function runCommand(command, args, cwd) {
  console.error(`+ (cd ${cwd} && ${command} ${args.join(" ")})`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if ((result.status ?? 1) !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? 1}`);
}

export function main(argv = process.argv.slice(2), repoRoot = path.resolve(import.meta.dirname, "../..")) {
  const options = parseArgs(argv);
  const files = options.changedFiles ?? gitChangedFiles(repoRoot, options.base, options.head);
  const classification = classifyChanges(files, repoRoot);
  console.error(`service gate changed files: ${files.length}`);
  if (classification.errors.length) {
    for (const error of classification.errors) console.error(`error: ${error}`);
    return 1;
  }
  if (classification.serviceDirs.length === 0) {
    console.error("service gate: no service implementation changed; L2 service checks are not applicable");
    return 0;
  }
  console.error(`service gate L2 candidates: ${classification.serviceDirs.join(", ")}`);
  const commands = plannedCommands(classification.serviceDirs, options);
  if (options.dryRun) {
    for (const [command, args, cwd] of commands) console.log(`(cd ${cwd} && ${command} ${args.join(" ")})`);
    return 0;
  }
  for (const [command, args, cwd] of commands) runCommand(command, args, path.resolve(repoRoot, cwd));
  console.error("service gate: L2 automated checks passed (device verification remains a human review item)");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`error: ${error.message}`); process.exitCode = 1; }
}
