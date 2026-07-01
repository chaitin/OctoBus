import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverServices, main as importCheckMain } from "../scripts/import-check-all.mjs";
import { main as runCoverageAllMain } from "../scripts/run-coverage-all.mjs";
import { main as runTestsMain, buildNodeTestArgs } from "../scripts/run-tests.mjs";
import { main as validateMain, validateRepository } from "../scripts/validate-service-package.mjs";

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value = "fixture\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
  if (value.startsWith("#!")) {
    fs.chmodSync(filePath, 0o755);
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-validate-"));
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    dependencies: {
      "@chaitin-ai/octobus-sdk": "^0.6.0",
      commander: "^12.1.0",
    },
    bundledDependencies: [
      "@chaitin-ai/octobus-sdk",
      "commander",
    ],
    bin: {
      "octobus-tentacles": "bin/octobus-tentacles.js",
      "safeline-waf": "bin/safeline-waf.js",
    },
    files: [
      "bin/octobus-tentacles.js",
      "bin/safeline-waf.js",
      "chaitin__safeline-waf",
    ],
  });
  writeText(path.join(root, "bin", "octobus-tentacles.js"), `#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
  "safeline-waf": {
    entryFile: "../chaitin__safeline-waf/bin/safeline-waf.js",
    serviceModule: "../chaitin__safeline-waf/src/service.js",
  },
};

const program = new Command();
program
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .action(async () => {
    const selected = services["safeline-waf"];
    const { service } = await import(new URL(selected.serviceModule, import.meta.url));
    await runServiceMain(service, {
      argv: program.args.slice(1),
      entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url)),
    });
  });
`);
  writeText(path.join(root, "bin", "safeline-waf.js"), `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__safeline-waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__safeline-waf/bin/safeline-waf.js", import.meta.url)),
});
`);
  writeText(path.join(root, "chaitin__safeline-waf", "README.md"));
  writeText(path.join(root, "chaitin__safeline-waf", "bin", "safeline-waf.js"), "#!/usr/bin/env node\n");
  writeText(path.join(root, "chaitin__safeline-waf", "config.schema.json"), "{}\n");
  writeText(path.join(root, "chaitin__safeline-waf", "secret.schema.json"), "{}\n");
  writeText(path.join(root, "chaitin__safeline-waf", "proto", "safeline_waf.proto"), 'syntax = "proto3";\n');
  writeText(path.join(root, "chaitin__safeline-waf", "src", "safeline-waf.js"), "export const handlers = {};\n");
  writeText(path.join(root, "chaitin__safeline-waf", "src", "service.js"), `import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./safeline-waf.js";

export { handlers } from "./safeline-waf.js";
export const service = defineService({ handlers });
`);
  writeJSON(path.join(root, "chaitin__safeline-waf", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "safeline-waf",
    proto: {
      roots: ["proto"],
      files: ["proto/safeline_waf.proto"],
    },
    configSchema: "config.schema.json",
    secretSchema: "secret.schema.json",
  });
  return root;
}

test("validates a migrated external service package root", () => {
  const root = fixture();
  const result = validateRepository(root, { serviceDir: "chaitin__safeline-waf" });
  assert.deepEqual(result.errors, []);
});

test("requires executable root wrappers and service entries", () => {
  const root = fixture();
  fs.chmodSync(path.join(root, "bin", "safeline-waf.js"), 0o644);
  fs.chmodSync(path.join(root, "chaitin__safeline-waf", "bin", "safeline-waf.js"), 0o644);

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /package\.json bin safeline-waf target "bin\/safeline-waf\.js" must be executable/);
  assert.match(errors, /service entry "bin\/safeline-waf\.js" must be executable/);
});

test("allows numeric service package names", () => {
  const root = fixture();
  fs.renameSync(path.join(root, "chaitin__safeline-waf"), path.join(root, "vendor__fw_v1-2-3"));
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    dependencies: {
      "@chaitin-ai/octobus-sdk": "^0.6.0",
      commander: "^12.1.0",
    },
    bundledDependencies: [
      "@chaitin-ai/octobus-sdk",
      "commander",
    ],
    bin: {
      "octobus-tentacles": "bin/octobus-tentacles.js",
      "vendor-fw-v1-2-3": "bin/vendor-fw-v1-2-3.js",
    },
    files: [
      "bin/octobus-tentacles.js",
      "bin/vendor-fw-v1-2-3.js",
      "vendor__fw_v1-2-3",
    ],
  });
  writeJSON(path.join(root, "vendor__fw_v1-2-3", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "vendor-fw-v1-2-3",
    proto: {
      roots: ["proto"],
      files: ["proto/safeline_waf.proto"],
    },
    configSchema: "config.schema.json",
    secretSchema: "secret.schema.json",
  });
  fs.renameSync(path.join(root, "bin", "safeline-waf.js"), path.join(root, "bin", "vendor-fw-v1-2-3.js"));
  fs.writeFileSync(path.join(root, "bin", "vendor-fw-v1-2-3.js"), `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../vendor__fw_v1-2-3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../vendor__fw_v1-2-3/bin/vendor-fw-v1-2-3.js", import.meta.url)),
});
`);
  fs.renameSync(path.join(root, "vendor__fw_v1-2-3", "bin", "safeline-waf.js"), path.join(root, "vendor__fw_v1-2-3", "bin", "vendor-fw-v1-2-3.js"));
  fs.writeFileSync(path.join(root, "vendor__fw_v1-2-3", "src", "service.js"), `import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./safeline-waf.js";

export { handlers } from "./safeline-waf.js";
export const service = defineService({ handlers });
`);
  fs.writeFileSync(path.join(root, "bin", "octobus-tentacles.js"), `#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
  "vendor-fw-v1-2-3": {
    entryFile: "../vendor__fw_v1-2-3/bin/vendor-fw-v1-2-3.js",
    serviceModule: "../vendor__fw_v1-2-3/src/service.js",
  },
};

const program = new Command();
program
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .action(async () => {
    const selected = services["vendor-fw-v1-2-3"];
    const { service } = await import(new URL(selected.serviceModule, import.meta.url));
    await runServiceMain(service, {
      argv: program.args.slice(1),
      entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url)),
    });
  });
`);

  const result = validateRepository(root, { serviceDir: "vendor__fw_v1-2-3" });
  assert.deepEqual(result.errors, []);
});

test("validates repository input and package path rules", () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-missing-"));
  assert.match(validateRepository(missing).errors.join("\n"), /missing root package\.json/);

  const invalidJSON = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-json-"));
  fs.writeFileSync(path.join(invalidJSON, "package.json"), "{");
  assert.throws(() => validateRepository(invalidJSON), /failed to read JSON/);

  const root = fixture();
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    bin: {
      "safeline-waf": "../bin/safeline-waf.js",
    },
  });
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /must stay inside the package root/);

  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    bin: "bin/safeline-waf.js",
  });
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /must contain an entry for service "safeline-waf"/);

  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    bin: 42,
  });
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /package\.json bin must be an object/);

  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    bin: {
      "safeline-waf": "",
    },
  });
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /must be a non-empty string/);
});

test("reports root package, service dir, service name, and bin mismatches", () => {
  const root = fixture();
  writeJSON(path.join(root, "package.json"), {
    name: "wrong",
    bin: {
      "Safeline_WAF": "/bin/safeline-waf.js",
    },
  });
  writeJSON(path.join(root, "Chaitin_WAF_SAFELINE", "service.json"), {
    schema: "legacy",
    name: "safeline-waf",
  });

  const result = validateRepository(root, { serviceDir: "Chaitin_WAF_SAFELINE" });
  assert.match(result.errors.join("\n"), /package\.json name must be @chaitin-ai\/octobus-tentacles/);
  assert.match(result.errors.join("\n"), /package\.json bin key "Safeline_WAF"/);
  assert.match(result.errors.join("\n"), /package\.json bin Safeline_WAF target must be a relative package path/);
  assert.match(result.errors.join("\n"), /service root "Chaitin_WAF_SAFELINE"/);
  assert.match(result.errors.join("\n"), /schema must be chaitin\.octobus\.service\.v1/);
  assert.match(result.errors.join("\n"), /package\.json bin must contain an entry for service "safeline-waf"/);
});

test("reports missing root dispatcher metadata and wrapper entryFile handling", () => {
  const root = fixture();
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    dependencies: {
      "@chaitin-ai/octobus-sdk": "^0.6.0",
    },
    bundledDependencies: [
      "@chaitin-ai/octobus-sdk",
    ],
    bin: {
      "safeline-waf": "bin/safeline-waf.js",
    },
    files: [
      "bin/safeline-waf.js",
    ],
  });
  fs.writeFileSync(path.join(root, "bin", "safeline-waf.js"), `#!/usr/bin/env node
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../chaitin__safeline-waf/src/service.js";
runServiceMain(service);
`);

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /direct dependency "commander"/);
  assert.match(errors, /bundledDependencies must include "commander"/);
  assert.match(errors, /default dispatcher "octobus-tentacles"/);
  assert.match(errors, /must import fileURLToPath/);
  assert.match(errors, /must pass runServiceMain options/);
  assert.match(errors, /must set entryFile to "\.\.\/chaitin__safeline-waf\/bin\/safeline-waf\.js"/);
});

test("reports package files omissions for service roots and wrappers", () => {
  const root = fixture();
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    dependencies: {
      "@chaitin-ai/octobus-sdk": "^0.6.0",
      commander: "^12.1.0",
    },
    bundledDependencies: [
      "@chaitin-ai/octobus-sdk",
      "commander",
    ],
    bin: {
      "octobus-tentacles": "bin/octobus-tentacles.js",
      "safeline-waf": "bin/safeline-waf.js",
    },
    files: [
      "bin/octobus-tentacles.js",
    ],
  });

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /files must include root wrapper "bin\/safeline-waf\.js"/);
  assert.match(errors, /files must include service root "chaitin__safeline-waf"/);
});

test("reports invalid service imports and high-risk service content", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "chaitin__safeline-waf", "src", "service.js"), `import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./missing.js";
export const service = defineService({ handlers });
`);
  fs.writeFileSync(path.join(root, "chaitin__safeline-waf", "src", "safeline-waf.js"), `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const proxy = globalThis.proxy;
export const handlers = {
  ["/pkg.Service/Method"]: (req, ctx = {}) => ({ ok: true }),
};
`);
  writeText(path.join(root, "chaitin__safeline-waf", "debug.log"), "debug\n");
  writeText(path.join(root, "chaitin__safeline-waf", "sdk", "sdk.tgz"), "artifact\n");
  writeText(path.join(root, "chaitin__safeline-waf", ".env"), "TOKEN=x\n");
  fs.mkdirSync(path.join(root, "chaitin__safeline-waf", "node_modules"), { recursive: true });

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /src\/service\.js import target "src\/missing\.js" must exist/);
  assert.match(errors, /must not modify NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.match(errors, /must not depend on globalThis\.proxy/);
  assert.match(errors, /must not export handler entries with \(req, ctx\) signature/);
  assert.match(errors, /forbidden package artifact "debug\.log"/);
  assert.match(errors, /forbidden package artifact "sdk\/sdk\.tgz"/);
  assert.match(errors, /forbidden package artifact "\.env"/);
  assert.match(errors, /forbidden package artifact "node_modules"/);
});

test("reports incomplete root dispatcher implementation", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "bin", "octobus-tentacles.js"), "#!/usr/bin/env node\n");

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /dispatcher behavior: import \{ Command \} from "commander";/);
  assert.match(errors, /dispatcher behavior: \.allowUnknownOption\(true\)/);
  assert.match(errors, /dispatcher behavior: argv: program\.args\.slice\(1\)/);
  assert.match(errors, /must include safeline-waf mapping snippet/);
});

test("discovers service directories when --service-dir is omitted", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(root, ".hidden"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  writeJSON(path.join(root, "bad_name", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "bad-name",
  });
  fs.mkdirSync(path.join(root, "plain-dir"), { recursive: true });

  const result = validateRepository(root);
  assert.match(result.errors.join("\n"), /service root "bad_name"/);
});

test("reports missing service package files and invalid service names", () => {
  const root = fixture();
  fs.rmSync(path.join(root, "chaitin__safeline-waf", "service.json"));
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /service\.json is required/);

  writeJSON(path.join(root, "chaitin__safeline-waf", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "safeline_waf",
  });
  const invalidNameErrors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(invalidNameErrors, /service\.json name "safeline_waf"/);
  assert.match(invalidNameErrors, /proto\.roots must be a non-empty array/);

  writeJSON(path.join(root, "chaitin__safeline-waf", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "safeline.waf",
  });
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /service\.json name "safeline\.waf"/);

  writeJSON(path.join(root, "chaitin__safeline-waf", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "safeline-waf",
    proto: {
      roots: ["proto"],
      files: ["proto/safeline_waf.proto"],
    },
    configSchema: "config.schema.json",
    secretSchema: "secret.schema.json",
  });
  fs.rmSync(path.join(root, "chaitin__safeline-waf", "README.md"));
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /README\.md "README\.md" must exist/);

  writeText(path.join(root, "chaitin__safeline-waf", "README.md"));
  fs.rmSync(path.join(root, "bin", "safeline-waf.js"));
  assert.match(validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n"), /package\.json bin safeline-waf target "bin\/safeline-waf\.js" must exist/);
});

test("reports missing manifest-referenced proto, schema, and service entry files", () => {
  const root = fixture();
  writeJSON(path.join(root, "chaitin__safeline-waf", "service.json"), {
    schema: "chaitin.octobus.service.v1",
    name: "safeline-waf",
    proto: {
      roots: ["missing-proto"],
      files: ["proto/missing.txt"],
    },
    configSchema: "missing-config.schema.json",
    secretSchema: "missing-secret.schema.json",
  });
  fs.rmSync(path.join(root, "chaitin__safeline-waf", "bin", "safeline-waf.js"));

  const errors = validateRepository(root, { serviceDir: "chaitin__safeline-waf" }).errors.join("\n");
  assert.match(errors, /service entry "bin\/safeline-waf\.js" must exist/);
  assert.match(errors, /configSchema "missing-config\.schema\.json" must exist/);
  assert.match(errors, /secretSchema "missing-secret\.schema\.json" must exist/);
  assert.match(errors, /proto root "missing-proto" must exist/);
  assert.match(errors, /proto file "proto\/missing\.txt" must exist/);
  assert.match(errors, /proto file "proto\/missing\.txt" must end with \.proto/);
});

test("allows an empty repository before services are migrated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-empty-"));
  writeJSON(path.join(root, "package.json"), {
    name: "@chaitin-ai/octobus-tentacles",
    bin: {},
  });

  const result = validateRepository(root);
  assert.deepEqual(result.errors, []);
});

test("builds test runner args for root and service tests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-run-tests-"));
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "tests", "root.test.mjs"), "import 'node:test';\n");
  fs.mkdirSync(path.join(root, "vendor__svc", "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "vendor__svc", "test", "svc.test.js"), "import 'node:test';\n");

  const args = buildNodeTestArgs(root, {
    coverage: true,
    serviceDir: "vendor__svc",
  });

  assert.deepEqual(args, [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-branches=90",
    "--test-coverage-functions=90",
    "--test-coverage-lines=90",
    "--test-coverage-include=vendor__svc/**/*.js",
    "--test-coverage-exclude=vendor__svc/node_modules/**",
    path.join("tests", "root.test.mjs"),
    path.join("vendor__svc", "test", "svc.test.js"),
  ]);

  assert.deepEqual(buildNodeTestArgs(root, {
    coverage: true,
    coverageBranches: 75,
    coverageFunctions: 75,
    coverageLines: 75,
    serviceDir: null,
  }).slice(0, 5), [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-branches=75",
    "--test-coverage-functions=75",
    "--test-coverage-lines=75",
  ]);
});

test("builds test runner args without coverage and reports missing tests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-run-tests-"));
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "tests", "root.test.mjs"), "import 'node:test';\n");

  assert.deepEqual(buildNodeTestArgs(root, { coverage: false, serviceDir: null }), [
    "--test",
    path.join("tests", "root.test.mjs"),
  ]);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-run-tests-empty-"));
  assert.throws(() => buildNodeTestArgs(empty, { coverage: false, serviceDir: null }), /no test files found/);
});

test("CLI main functions parse supported arguments", () => {
  const validateRoot = fixture();
  assert.equal(validateMain(["--root", validateRoot, "--service-dir", "chaitin__safeline-waf"]), 0);
  assert.equal(validateMain([`--root=${validateRoot}`, "--service-dir=chaitin__safeline-waf"]), 0);
  assert.throws(() => validateMain(["--root", ""]), /--root must not be empty/);
  assert.throws(() => validateMain(["--root"]), /--root must not be empty/);
  assert.throws(() => validateMain(["--service-dir", ""]), /--service-dir must not be empty/);
  assert.throws(() => validateMain(["--service-dir"]), /--service-dir must not be empty/);
  assert.throws(() => validateMain(["--bad"]), /unknown argument/);

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-services-run-main-"));
  fs.mkdirSync(path.join(testRoot, "tests"), { recursive: true });
  fs.writeFileSync(path.join(testRoot, "tests", "root.test.mjs"), "import test from 'node:test';\ntest('ok', () => {});\n");
  assert.equal(runTestsMain(["--coverage"], testRoot), 0);
  assert.throws(() => runTestsMain(["--coverage-threshold=bad"], testRoot), /--coverage-threshold must be a number from 0 to 100/);
  assert.throws(() => runTestsMain(["--coverage-threshold", "101"], testRoot), /--coverage-threshold must be a number from 0 to 100/);
  assert.throws(() => runTestsMain(["--coverage-threshold"], testRoot), /--coverage-threshold must be a number from 0 to 100/);
  assert.throws(() => runTestsMain(["--service-dir="], testRoot), /--service-dir must not be empty/);
  assert.throws(() => runTestsMain(["--service-dir", ""], testRoot), /--service-dir must not be empty/);
  assert.throws(() => runTestsMain(["--service-dir"], testRoot), /--service-dir must not be empty/);
  assert.throws(() => runTestsMain(["--unknown"], testRoot), /unknown argument/);
});

test("CLI main functions return failure statuses", () => {
  const validateRoot = fixture();
  writeJSON(path.join(validateRoot, "package.json"), {
    name: "wrong",
    bin: {},
  });
  assert.equal(validateMain(["--root", validateRoot]), 1);
});

test("coverage-all CLI rejects unsupported arguments", () => {
  assert.throws(() => runCoverageAllMain(["--unknown"], process.cwd()), /unknown argument/);
});

test("import check discovers services and validates CLI arguments", () => {
  const root = fixture();
  assert.deepEqual(discoverServices(root), [{
    dir: "chaitin__safeline-waf",
    id: "safeline-waf",
    nodeEntry: "bin/safeline-waf.js",
  }]);
  assert.throws(() => importCheckMain(["--unknown"], root), /unknown argument/);
  assert.throws(() => importCheckMain(["--octobus", ""], root), /--octobus must not be empty/);
  const script = fs.readFileSync(new URL("../scripts/import-check-all.mjs", import.meta.url), "utf8");
  assert.match(script, /"service", "import", "--recursive"/);
  assert.doesNotMatch(script, /"service", "import", "--id"/);
});
