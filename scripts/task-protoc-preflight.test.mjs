import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taskBin = execFileSync("sh", ["-c", "command -v task"], { encoding: "utf8" }).trim();

test("task test fails early with a protoc installation hint", () => {
  const fixture = makeFixture();
  try {
    const result = runTask(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /protoc.*(required|install|PATH)/i);
    assert.equal(fs.existsSync(fixture.downstreamMarker), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("task test accepts an executable protoc and reaches downstream commands", () => {
  const fixture = makeFixture({ protoc: true });
  try {
    const result = runTask(fixture);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.readFileSync(fixture.downstreamMarker, "utf8"), "started\n");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("task test rejects a non-executable protoc", () => {
  const fixture = makeFixture({ protoc: "non-executable" });
  try {
    const result = runTask(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /protoc.*(required|install|PATH)/i);
    assert.equal(fs.existsSync(fixture.downstreamMarker), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function makeFixture({ protoc = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-protoc-preflight-"));
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.cpSync(path.join(repoRoot, "Taskfile.yml"), path.join(root, "Taskfile.yml"));
  fs.mkdirSync(path.join(root, "sdk"), { recursive: true });
  for (const file of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(repoRoot, "sdk", file), path.join(root, "sdk", file));
  }
  const downstreamMarker = path.join(root, "downstream.started");
  // The npm sentinel proves ordering without installing dependencies or running
  // the real suite; its nonzero exit is intentional once the preflight passes.
  writeExecutable(path.join(binDir, "npm"), `#!/bin/sh
printf 'started\\n' > "$DOWNSTREAM_MARKER"
exit 23
`);
  if (protoc) {
    writeExecutable(path.join(binDir, "protoc"), "#!/bin/sh\nexit 0\n");
    if (protoc === "non-executable") fs.chmodSync(path.join(binDir, "protoc"), 0o644);
  }
  return { root, binDir, downstreamMarker };
}

function runTask(fixture) {
  try {
    const stdout = execFileSync(taskBin, ["--dir", fixture.root, "test"], {
      cwd: fixture.root,
      env: { ...process.env, PATH: fixture.binDir, DOWNSTREAM_MARKER: fixture.downstreamMarker },
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (error.status === null || error.status === undefined) throw error;
    return {
      status: error.status,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
    };
  }
}

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}
