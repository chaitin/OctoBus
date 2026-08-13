import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readCached, withLock } from "./service-l2-batch.mjs";

test("dry-run never reuses or accepts the formal result cache", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-l2-cache-"));
  const options = { stateDir, dryRun: false, force: false };
  const pr = { number: 1, headRefOid: "head" };
  const resultDir = path.join(stateDir, "results");
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, "1.json"), JSON.stringify({ headSHA: "head", gateSHA: "gate", executed: false }));
  assert.deepEqual(readCached(options, pr, "gate"), { headSHA: "head", gateSHA: "gate", executed: false });
  assert.equal(readCached({ ...options, dryRun: true }, pr, "gate"), null);
});

test("blocked results are retried because draft and mergeability can change", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-l2-cache-"));
  const options = { stateDir, dryRun: false, force: false };
  const pr = { number: 1, headRefOid: "head" };
  const resultDir = path.join(stateDir, "results");
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, "1.json"), JSON.stringify({
    headSHA: "head", gateSHA: "gate", status: "blocked",
  }));
  assert.equal(readCached(options, pr, "gate"), null);
});

test("dependency lock reclaims a lock owned by a dead process", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-l2-lock-"));
  const lockPath = path.join(dir, "pool.lock");
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, createdAt: Date.now(), token: "dead" }));
  let called = false;
  withLock(lockPath, () => { called = true; }, { staleMs: 60_000, waitMs: 100 });
  assert.equal(called, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test("dependency lock has a bounded wait", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-l2-lock-"));
  const lockPath = path.join(dir, "pool.lock");
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: "live" }));
  assert.throws(() => withLock(lockPath, () => {}, { staleMs: 60_000, waitMs: 1 }), /timed out waiting/);
});

test("dependency lock propagates action errors and releases the lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-l2-lock-"));
  const lockPath = path.join(dir, "pool.lock");
  const error = Object.assign(new Error("action failed"), { code: "EEXIST" });
  assert.throws(() => withLock(lockPath, () => { throw error; }), /action failed/);
  assert.equal(fs.existsSync(lockPath), false);
});
