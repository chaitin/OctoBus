#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_COVERAGE_THRESHOLD = 90;

function parseArgs(argv) {
  const opts = {
    coverage: false,
    coverageBranches: DEFAULT_COVERAGE_THRESHOLD,
    coverageFunctions: DEFAULT_COVERAGE_THRESHOLD,
    coverageLines: DEFAULT_COVERAGE_THRESHOLD,
    serviceDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--coverage") {
      opts.coverage = true;
      continue;
    }
    if (arg === "--coverage-threshold") {
      if (i + 1 >= argv.length || argv[i + 1] === "") {
        throw new Error("--coverage-threshold must be a number from 0 to 100");
      }
      const threshold = parseCoverageThreshold(argv[++i], "--coverage-threshold");
      opts.coverageBranches = threshold;
      opts.coverageFunctions = threshold;
      opts.coverageLines = threshold;
      continue;
    }
    if (arg.startsWith("--coverage-threshold=")) {
      const threshold = parseCoverageThreshold(arg.slice("--coverage-threshold=".length), "--coverage-threshold");
      opts.coverageBranches = threshold;
      opts.coverageFunctions = threshold;
      opts.coverageLines = threshold;
      continue;
    }
    if (arg === "--service-dir") {
      if (i + 1 >= argv.length || argv[i + 1] === "") {
        throw new Error("--service-dir must not be empty");
      }
      opts.serviceDir = argv[++i];
      continue;
    }
    if (arg.startsWith("--service-dir=")) {
      opts.serviceDir = arg.slice("--service-dir=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (opts.serviceDir === "") {
    throw new Error("--service-dir must not be empty");
  }
  return opts;
}

function parseCoverageThreshold(value, label) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`${label} must be a number from 0 to 100`);
  }
  return threshold;
}

function existingTestFiles(root, patterns) {
  const files = [];
  for (const pattern of patterns) {
    const dir = path.join(root, pattern.dir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && pattern.re.test(entry.name)) {
        files.push(path.join(pattern.dir, entry.name));
      }
    }
  }
  return files.sort();
}

export function buildNodeTestArgs(root, opts) {
  const tests = existingTestFiles(root, [
    { dir: "tests", re: /\.test\.mjs$/ },
  ]);

  if (opts.serviceDir != null) {
    tests.push(...existingTestFiles(root, [
      { dir: path.join(opts.serviceDir, "test"), re: /\.test\.[cm]?js$/ },
    ]));
  }

  if (tests.length === 0) {
    throw new Error("no test files found");
  }

  const args = ["--test"];
  if (opts.coverage) {
    args.push("--experimental-test-coverage");
    args.push(`--test-coverage-branches=${opts.coverageBranches ?? DEFAULT_COVERAGE_THRESHOLD}`);
    args.push(`--test-coverage-functions=${opts.coverageFunctions ?? DEFAULT_COVERAGE_THRESHOLD}`);
    args.push(`--test-coverage-lines=${opts.coverageLines ?? DEFAULT_COVERAGE_THRESHOLD}`);
    if (opts.serviceDir != null) {
      const serviceDir = opts.serviceDir.replaceAll(path.win32.sep, path.posix.sep);
      args.push(`--test-coverage-include=${serviceDir}/**/*.js`);
      args.push(`--test-coverage-exclude=${serviceDir}/node_modules/**`);
    }
  }
  args.push(...tests);
  return args;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const opts = parseArgs(argv);
  const args = buildNodeTestArgs(root, opts);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
