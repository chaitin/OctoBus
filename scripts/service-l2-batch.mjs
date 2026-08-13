#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LABELS = {
  passed: { name: "l2:passed", color: "1f883d", description: "Service L2 自动门禁通过" },
  failed: { name: "l2:failed", color: "d1242f", description: "Service L2 自动门禁未通过" },
  blocked: { name: "l2:blocked", color: "bf8700", description: "Service L2 检查被 Draft、冲突或基础条件阻塞" },
  "not-applicable": { name: "l2:not-applicable", color: "6e7781", description: "不适用 Service L2 门禁" },
};
const MARKER = "<!-- octobus-service-l2-batch -->";
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 35 * 60 * 1000;

function parseArgs(argv) {
  const options = {
    repo: "chaitin/OctoBus", exclude: new Set([494]), concurrency: 3,
    publish: false, dryRun: false, keepWorktrees: false, force: false,
    prNumbers: [], stateDir: path.join(os.tmpdir(), "octobus-service-l2-batch"),
    gateRef: "origin/ci/service-l2-gate",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") options.repo = required(argv, ++i, arg);
    else if (arg === "--gate-ref") options.gateRef = required(argv, ++i, arg);
    else if (arg === "--state-dir") options.stateDir = path.resolve(required(argv, ++i, arg));
    else if (arg === "--concurrency") options.concurrency = positiveInteger(required(argv, ++i, arg), arg);
    else if (arg === "--pr") options.prNumbers.push(positiveInteger(required(argv, ++i, arg), arg));
    else if (arg === "--exclude") options.exclude.add(positiveInteger(required(argv, ++i, arg), arg));
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--keep-worktrees") options.keepWorktrees = true;
    else if (arg === "--force") options.force = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function required(argv, index, flag) { if (!argv[index]) throw new Error(`${flag} requires a value`); return argv[index]; }
function positiveInteger(value, flag) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} requires a positive integer`); return n; }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: "utf8", stdio: options.stdio ?? "pipe" });
  if ((result.status ?? 1) !== 0 && !options.allowFailure) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result;
}
function git(args, cwd, options = {}) { return run("git", args, { cwd, ...options }); }
function gh(args, cwd, options = {}) { return run("gh", args, { cwd, ...options }); }

function listPRs(options, repoRoot) {
  if (options.prNumbers.length) return options.prNumbers.map((number) => JSON.parse(gh(["pr", "view", String(number), "-R", options.repo, "--json", "number,title,url,isDraft,headRefOid,mergeable,mergeStateStatus"], repoRoot).stdout));
  return JSON.parse(gh(["pr", "list", "-R", options.repo, "--state", "open", "--limit", "1000", "--json", "number,title,url,isDraft,headRefOid,mergeable,mergeStateStatus"], repoRoot).stdout);
}

function resultPath(options, number) { return path.join(options.stateDir, "results", `${number}.json`); }
export function readCached(options, pr, gateSHA) {
  if (options.dryRun || options.force || !fs.existsSync(resultPath(options, pr.number))) return null;
  const cached = JSON.parse(fs.readFileSync(resultPath(options, pr.number), "utf8"));
  if (cached.status === "blocked") return null;
  return cached.headSHA === pr.headRefOid && cached.gateSHA === gateSHA ? cached : null;
}

function writeResult(options, result) {
  fs.mkdirSync(path.dirname(resultPath(options, result.number)), { recursive: true });
  fs.writeFileSync(resultPath(options, result.number), `${JSON.stringify(result, null, 2)}\n`);
}

function fetchMergeRef(repoRoot, options, pr) {
  const ref = `refs/l2-audit/pr-${pr.number}`;
  const fetched = git(["fetch", "--force", "origin", `pull/${pr.number}/merge:${ref}`], repoRoot, { allowFailure: true });
  return fetched.status === 0 ? ref : null;
}

function prepareWorktree(repoRoot, options, pr, mergeRef) {
  const worktree = path.join(options.stateDir, "worktrees", `pr-${pr.number}`);
  if (fs.existsSync(worktree)) git(["worktree", "remove", "--force", worktree], repoRoot, { allowFailure: true });
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(["worktree", "add", "--detach", worktree, mergeRef], repoRoot);
  return worktree;
}

export function overlayGate(repoRoot, worktree, gateSHA) {
  for (const file of [
    "services/scripts/service-pr-gate.mjs", "services/scripts/run-tests.mjs",
    "services/scripts/validate-service-package.mjs", "scripts/service-package-smoke.mjs",
  ]) {
    const shown = git(["show", `${gateSHA}:${file}`], repoRoot, { allowFailure: true });
    if (shown.status !== 0) throw new Error(`gate file is missing at ${gateSHA}: ${file}`);
    const content = shown.stdout;
    const target = path.join(worktree, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function dependencyFingerprint(worktree) {
  const files = ["services/package.json", "services/package-lock.json", "services/npm-shrinkwrap.json"]
    .map((file) => path.join(worktree, file)).filter(fs.existsSync);
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest("hex").slice(0, 20);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function lockIsStale(lockPath, staleMs, now) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return now - lock.createdAt > staleMs || !processIsAlive(lock.pid);
  } catch {
    return now - fs.statSync(lockPath).mtimeMs > staleMs;
  }
}

export function withLock(lockPath, action, { staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (lockIsStale(lockPath, staleMs, Date.now())) {
        try { fs.unlinkSync(lockPath); } catch (unlinkError) { if (unlinkError.code !== "ENOENT") throw unlinkError; }
        continue;
      }
      if (Date.now() - startedAt >= waitMs) throw new Error(`timed out waiting for dependency lock: ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  const owner = { pid: process.pid, createdAt: Date.now(), token: crypto.randomUUID() };
  fs.writeFileSync(fd, JSON.stringify(owner));
  try { return action(); } finally {
    fs.closeSync(fd);
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (current.token === owner.token) fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function attachDependencyPool(worktree, options, env) {
  const fingerprint = dependencyFingerprint(worktree);
  const pool = path.join(options.stateDir, "dependency-pool", fingerprint);
  const modules = path.join(pool, "node_modules");
  const complete = path.join(pool, ".install-complete");
  withLock(`${pool}.lock`, () => {
    if (!fs.existsSync(modules) || !fs.existsSync(complete)) {
      fs.rmSync(modules, { recursive: true, force: true });
      fs.rmSync(complete, { force: true });
      fs.mkdirSync(pool, { recursive: true });
      for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json"]) {
        const source = path.join(worktree, "services", file);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(pool, file));
      }
      run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: pool, env });
      fs.writeFileSync(complete, `${fingerprint}\n`);
    }
  });
  const target = path.join(worktree, "services", "node_modules");
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(modules, target, "dir");
  return fingerprint;
}

async function execute(command, args, options) {
  return await new Promise((resolve) => {
    const output = fs.openSync(options.logPath, "w");
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", output, output] });
    let closed = false;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      fs.closeSync(output);
      resolve(code);
    };
    child.on("error", (error) => {
      fs.appendFileSync(options.logPath, `error: failed to start ${command}: ${error.message}\n`);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

function preflightGate(worktree) {
  const result = run("node", ["services/scripts/service-pr-gate.mjs", "--base", "HEAD^1", "--head", "HEAD", "--dry-run", "--skip-install", "--skip-smoke"], { cwd: worktree, allowFailure: true });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return { code: result.status ?? 1, output, noService: output.includes("no service implementation changed") };
}

function summarizeLog(logPath) {
  const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const lines = text.split(/\r?\n/).filter((line) => /^(error:|✖|ℹ Error:|service gate:|service gate L2 candidates:)/.test(line));
  return (lines.length ? lines : text.split(/\r?\n/).filter(Boolean).slice(-20)).slice(-30).join("\n").slice(0, 6000);
}

async function auditPR(repoRoot, options, pr, gateSHA) {
  const cached = readCached(options, pr, gateSHA);
  if (cached) return cached;
  const startedAt = new Date().toISOString();
  if (pr.isDraft) return finish({ number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA, status: "blocked", reason: "PR 当前为 Draft，未执行 L2。", startedAt }, options);
  const mergeRef = fetchMergeRef(repoRoot, options, pr);
  if (!mergeRef) return finish({ number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA, status: "blocked", reason: "GitHub 未生成 merge ref；PR 与当前 main 冲突或暂不可合并。", startedAt }, options);
  const worktree = prepareWorktree(repoRoot, options, pr, mergeRef);
  const logPath = path.join(options.stateDir, "logs", `pr-${pr.number}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const env = { ...process.env,
    npm_config_cache: path.join(options.stateDir, "cache", "npm"),
    GOMODCACHE: path.join(options.stateDir, "cache", "gomod"),
    GOCACHE: path.join(options.stateDir, "cache", "gobuild"),
  };
  let result;
  try {
    overlayGate(repoRoot, worktree, gateSHA);
    const preflight = preflightGate(worktree);
    if (options.dryRun) {
      return {
        number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA,
        status: preflight.code === 0 ? "not-applicable" : "failed",
        reason: preflight.code === 0 ? "dry-run：静态范围分类通过，未执行完整 L2。" : "dry-run：静态范围分类失败，未执行完整 L2。",
        summary: preflight.output.trim().slice(-6000), startedAt, finishedAt: new Date().toISOString(), executed: false,
      };
    }
    if (preflight.noService) {
      result = { number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA,
        status: "not-applicable", reason: "该 PR 不包含单 Service 实现改动，L2 不适用。",
        summary: "service gate: no service implementation changed; L2 service checks are not applicable", startedAt };
      return finish(result, options);
    }
    const fingerprint = attachDependencyPool(worktree, options, env);
    const code = await execute("node", ["services/scripts/service-pr-gate.mjs", "--base", "HEAD^1", "--head", "HEAD", "--skip-install"], { cwd: worktree, env, logPath });
    const summary = summarizeLog(logPath);
    const noService = summary.includes("no service implementation changed");
    result = { number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA, dependencyFingerprint: fingerprint,
      status: code === 0 ? (noService ? "not-applicable" : "passed") : "failed",
      reason: code === 0 ? (noService ? "该 PR 不包含单 Service 实现改动，L2 不适用。" : "完整 L2 自动门禁通过。") : "L2 自动门禁执行失败。",
      summary, logPath, startedAt };
  } catch (error) {
    result = { number: pr.number, title: pr.title, headSHA: pr.headRefOid, gateSHA, status: "failed", reason: `审计器异常：${error.message}`, summary: summarizeLog(logPath), logPath, startedAt };
  } finally {
    if (!options.keepWorktrees) git(["worktree", "remove", "--force", worktree], repoRoot, { allowFailure: true });
  }
  return finish(result, options);
}

function finish(result, options) { result.finishedAt = new Date().toISOString(); writeResult(options, result); return result; }

function commentBody(result) {
  const label = LABELS[result.status].name;
  return `${MARKER}\n## Service L2 自动检查结果：${label}\n\n- 状态：**${result.status}**\n- PR head：\`${result.headSHA}\`\n- 门禁版本：\`${result.gateSHA}\`\n- 结论：${result.reason}\n\n${result.summary ? `### 关键输出\n\n\`\`\`text\n${result.summary}\n\`\`\`\n\n` : ""}L2 只验证包结构、mock 测试、80% line/branch/function coverage、打包、构建和 OctoBus smoke 链路；真实设备兼容性仍需人工检查作者提供的脱敏证据。`;
}

function ensureLabels(repoRoot, options) {
  for (const label of Object.values(LABELS)) gh(["label", "create", label.name, "-R", options.repo, "--color", label.color, "--description", label.description, "--force"], repoRoot);
}

function publishResult(repoRoot, options, result) {
  const comments = JSON.parse(gh(["api", `repos/${options.repo}/issues/${result.number}/comments`, "--paginate"], repoRoot).stdout);
  const existing = comments.find((comment) => comment.body?.includes(MARKER));
  const body = commentBody(result);
  if (existing) gh(["api", "--method", "PATCH", `repos/${options.repo}/issues/comments/${existing.id}`, "--field", `body=${body}`], repoRoot);
  else gh(["pr", "comment", String(result.number), "-R", options.repo, "--body", body], repoRoot);
  const remove = Object.values(LABELS).map((label) => label.name).filter((name) => name !== LABELS[result.status].name);
  const args = ["pr", "edit", String(result.number), "-R", options.repo, "--add-label", LABELS[result.status].name];
  for (const label of remove) args.push("--remove-label", label);
  gh(args, repoRoot);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length); let next = 0;
  async function runWorker() { for (;;) { const index = next++; if (index >= items.length) return; results[index] = await worker(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker)); return results;
}

export async function main(argv = process.argv.slice(2), repoRoot = path.resolve(import.meta.dirname, "..")) {
  const options = parseArgs(argv);
  fs.mkdirSync(options.stateDir, { recursive: true });
  git(["fetch", "origin", "main", "ci/service-l2-gate"], repoRoot);
  const gateSHA = git(["rev-parse", options.gateRef], repoRoot).stdout.trim();
  const prs = listPRs(options, repoRoot).filter((pr) => !options.exclude.has(pr.number));
  console.error(`L2 batch: ${prs.length} PRs, concurrency=${options.concurrency}, publish=${options.publish}`);
  const results = await mapLimit(prs, options.concurrency, async (pr) => {
    const result = await auditPR(repoRoot, options, pr, gateSHA);
    console.error(`#${pr.number} ${result.status}: ${result.reason}`);
    return result;
  });
  if (options.publish) { ensureLabels(repoRoot, options); for (const result of results) publishResult(repoRoot, options, result); }
  const counts = Object.fromEntries(Object.keys(LABELS).map((status) => [status, results.filter((r) => r.status === status).length]));
  fs.writeFileSync(path.join(options.stateDir, "summary.json"), `${JSON.stringify({ gateSHA, counts, results }, null, 2)}\n`);
  console.log(JSON.stringify({ gateSHA, counts, stateDir: options.stateDir }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
