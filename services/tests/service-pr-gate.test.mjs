import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyChanges, parseArgs, plannedCommands } from "../scripts/service-pr-gate.mjs";

function repoFixture(serviceDirs = ["vendor__product_v1"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-service-pr-gate-"));
  for (const serviceDir of serviceDirs) {
    fs.mkdirSync(path.join(root, "services", serviceDir), { recursive: true });
    fs.writeFileSync(path.join(root, "services", serviceDir, "service.json"), "{}\n");
  }
  return root;
}

test("classifies a focused service PR and allows generated registry files", () => {
  const root = repoFixture();
  const result = classifyChanges([
    "services/vendor__product_v1/src/client.js",
    "services/vendor__product_v1/test/client.test.js",
    "services/bin/vendor-product.js",
    "services/bin/octobus-tentacles.js",
    "services/package.json",
  ], root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.serviceDirs, ["vendor__product_v1"]);
});

test("rejects multi-service and mixed core changes", () => {
  const root = repoFixture(["vendor__one", "vendor__two"]);
  const result = classifyChanges([
    "services/vendor__one/src/one.js",
    "services/vendor__two/src/two.js",
    "internal/protocol/gateway.go",
  ], root);
  assert.match(result.errors.join("\n"), /exactly one service root/);
  assert.match(result.errors.join("\n"), /must not mix/);
});

test("rejects package pollution, infrastructure changes, and service removal", () => {
  const root = repoFixture();
  const result = classifyChanges([
    "services/vendor__product_v1/evidence.png",
    "services/scripts/custom-runtime.mjs",
    "services/vendor__deleted/src/client.js",
  ], root);
  assert.match(result.errors.join("\n"), /forbidden generated/);
  assert.match(result.errors.join("\n"), /non-whitelisted shared/);
  assert.match(result.errors.join("\n"), /deleted or has no service.json/);
});

test("does not apply L2 service checks to a core-only PR", () => {
  const root = repoFixture();
  const result = classifyChanges(["internal/store/store.go", "README.md"], root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.serviceDirs, []);
  assert.equal(result.touchesCore, true);
});

test("does not enforce service package pollution rules on a non-service PR", () => {
  const root = repoFixture();
  const result = classifyChanges(["docs/architecture.png", "artifacts/debug.log"], root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.serviceDirs, []);
});

test("plans focused validation, coverage, packaging, build, and smoke", () => {
  const commands = plannedCommands(["vendor__product_v1"]);
  assert.deepEqual(commands.map(([command, args]) => `${command} ${args.join(" ")}`), [
    "npm install --ignore-scripts --no-audit --no-fund",
    "node scripts/validate-service-package.mjs --service-dir vendor__product_v1",
    "node scripts/run-tests.mjs --service-dir vendor__product_v1 --coverage --coverage-threshold=80",
    "npm run pack:check",
    "bash ./scripts/build-octobus.sh bin/octobus",
    "node scripts/service-package-smoke.mjs --service-dir vendor__product_v1 --fail-fast",
  ]);
});

test("can reuse a prepared dependency pool", () => {
  const commands = plannedCommands(["vendor__product_v1"], { skipInstall: true, skipSmoke: true });
  assert.equal(commands.some(([command, args]) => command === "npm" && args[0] === "install"), false);
  assert.equal(commands.some(([command, args]) => command === "bash" && args[0] === "./scripts/build-octobus.sh"), false);
});

test("parses CI and local execution options", () => {
  assert.deepEqual(parseArgs(["--base", "origin/dev", "--head=abc", "--dry-run", "--skip-smoke", "--skip-install", "--changed-files=a,b"]), {
    base: "origin/dev",
    head: "abc",
    dryRun: true,
    skipSmoke: true,
    skipInstall: true,
    changedFiles: ["a", "b"],
  });
});
