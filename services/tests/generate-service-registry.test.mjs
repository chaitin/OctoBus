import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateServiceRegistry } from "../scripts/generate-service-registry.mjs";

async function createServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "octobus-service-registry-"));
  await mkdir(path.join(root, "bin"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/services",
        version: "0.0.0",
        type: "module",
        scripts: { test: "node --test" },
        dependencies: { commander: "^12.1.0" },
        bin: { stale: "bin/stale.js" },
        files: ["stale"],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

async function addService(root, directory, name, entryFile = `bin/${name}.js`) {
  const serviceRoot = path.join(root, directory);
  await mkdir(path.join(serviceRoot, "bin"), { recursive: true });
  await mkdir(path.join(serviceRoot, "src"), { recursive: true });
  await writeFile(
    path.join(serviceRoot, "service.json"),
    `${JSON.stringify({ schema: "chaitin.octobus.service.v1", name }, null, 2)}\n`,
  );
  await writeFile(
    path.join(serviceRoot, "package.json"),
    `${JSON.stringify({ name, type: "module", bin: { [name]: entryFile } }, null, 2)}\n`,
  );
  await writeFile(path.join(serviceRoot, "src", "service.js"), "export const service = {};\n");
  const entryPath = path.join(serviceRoot, entryFile);
  await mkdir(path.dirname(entryPath), { recursive: true });
  await writeFile(entryPath, "#!/usr/bin/env node\n");
  await chmod(entryPath, 0o755);
}

test("generates a deterministic aggregate registry from service packages", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__zeta", "zeta");
  await addService(root, "vendor__alpha", "alpha", "bin/vendor-alpha.js");

  await generateServiceRegistry({ servicesRoot: root });

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(packageJson.bin, {
    "octobus-tentacles": "bin/octobus-tentacles.js",
    alpha: "bin/vendor-alpha.js",
    zeta: "bin/zeta.js",
  });
  assert.deepEqual(packageJson.files, [
    "scripts",
    "bin/octobus-tentacles.js",
    "bin/vendor-alpha.js",
    "vendor__alpha",
    "bin/zeta.js",
    "vendor__zeta",
  ]);

  const dispatcher = await readFile(path.join(root, "bin", "octobus-tentacles.js"), "utf8");
  assert.ok(dispatcher.indexOf('"alpha"') < dispatcher.indexOf('"zeta"'));
  assert.match(dispatcher, /\.\.\/vendor__alpha\/bin\/vendor-alpha\.js/);
  assert.match(dispatcher, /\.\.\/vendor__alpha\/src\/service\.js/);

  const wrapper = await readFile(path.join(root, "bin", "vendor-alpha.js"), "utf8");
  assert.match(wrapper, /\.\.\/vendor__alpha\/src\/service\.js/);
  assert.match(wrapper, /\.\.\/vendor__alpha\/bin\/vendor-alpha\.js/);
  assert.equal((await stat(path.join(root, "bin", "vendor-alpha.js"))).mode & 0o111, 0o111);
  assert.equal((await stat(path.join(root, "bin", "octobus-tentacles.js"))).mode & 0o111, 0o111);

  const firstPackageJson = await readFile(path.join(root, "package.json"), "utf8");
  const firstDispatcher = await readFile(path.join(root, "bin", "octobus-tentacles.js"), "utf8");
  await generateServiceRegistry({ servicesRoot: root });
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), firstPackageJson);
  assert.equal(
    await readFile(path.join(root, "bin", "octobus-tentacles.js"), "utf8"),
    firstDispatcher,
  );
});

test("generate mode creates the root bin directory when it is missing", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await rm(path.join(root, "bin"), { recursive: true });

  await generateServiceRegistry({ servicesRoot: root });

  assert.match(
    await readFile(path.join(root, "bin", "alpha.js"), "utf8"),
    /\.\.\/vendor__alpha\/src\/service\.js/,
  );
});

test("check mode reports stale generated files without modifying them", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const packagePath = path.join(root, "package.json");
  const stalePackage = await readFile(packagePath, "utf8");

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root, check: true }),
    /service registry is out of date.*package\.json/s,
  );
  assert.equal(await readFile(packagePath, "utf8"), stalePackage);

  await generateServiceRegistry({ servicesRoot: root });
  await generateServiceRegistry({ servicesRoot: root, check: true });
});

test("check mode reports a stale generated wrapper without removing it", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await addService(root, "vendor__removed", "removed-service");
  await generateServiceRegistry({ servicesRoot: root });
  const staleWrapperPath = path.join(root, "bin", "removed-service.js");
  const staleWrapper = (await readFile(staleWrapperPath, "utf8")).replace(
    "runServiceMain(service, {",
    'await Promise.resolve("custom setup");\n\nrunServiceMain(service, {',
  );
  await writeFile(staleWrapperPath, staleWrapper);
  await rm(path.join(root, "vendor__removed"), { recursive: true });

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root, check: true }),
    /service registry is out of date.*bin\/removed-service\.js \(stale generated wrapper\)/s,
  );
  assert.equal(await readFile(staleWrapperPath, "utf8"), staleWrapper);
});

test("generate mode removes stale generated wrappers", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await addService(root, "vendor__removed", "removed-service");
  await generateServiceRegistry({ servicesRoot: root });
  const staleWrapperPath = path.join(root, "bin", "removed-service.js");
  await rm(path.join(root, "vendor__removed"), { recursive: true });

  await generateServiceRegistry({ servicesRoot: root });

  await assert.rejects(readFile(staleWrapperPath, "utf8"), { code: "ENOENT" });
});

test("reports a stale wrapper when its service root is replaced by a file", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await addService(root, "vendor__removed", "removed-service");
  await generateServiceRegistry({ servicesRoot: root });
  const staleWrapperPath = path.join(root, "bin", "removed-service.js");
  await rm(path.join(root, "vendor__removed"), { recursive: true });
  await writeFile(path.join(root, "vendor__removed"), "not a service directory\n");

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root, check: true }),
    /service registry is out of date.*bin\/removed-service\.js \(stale generated wrapper\)/s,
  );
  assert.equal((await stat(staleWrapperPath)).isFile(), true);
});

test("generate mode preserves non-JavaScript files in the root bin directory", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const helperPath = path.join(root, "bin", "manual-helper.sh");
  const helper = "#!/bin/sh\nexit 0\n";
  await writeFile(helperPath, helper);

  await generateServiceRegistry({ servicesRoot: root });

  assert.equal(await readFile(helperPath, "utf8"), helper);
});

test("preserves an unrecognized manual JavaScript file in check and generate modes", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const helperPath = path.join(root, "bin", "manual-helper.js");
  const helper = "#!/usr/bin/env node\nconsole.log(\"manual helper\");\n";
  await writeFile(helperPath, helper);

  await generateServiceRegistry({ servicesRoot: root });
  const result = await generateServiceRegistry({ servicesRoot: root, check: true });
  assert.equal(result.services, 1);

  await generateServiceRegistry({ servicesRoot: root });
  assert.equal(await readFile(helperPath, "utf8"), helper);
});

test("preserves a JavaScript file that uses runServiceMain without the generated wrapper shape", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const helperPath = path.join(root, "bin", "manual-runner.js");
  const helper = [
    "#!/usr/bin/env node",
    "",
    'import { fileURLToPath } from "node:url";',
    'import { runServiceMain } from "@chaitin-ai/octobus-sdk";',
    "",
    'import { service } from "../vendor__alpha/src/service.js";',
    "",
    "runServiceMain({}, { entryFile: process.argv[1] });",
    "",
  ].join("\n");
  await writeFile(helperPath, helper);

  await generateServiceRegistry({ servicesRoot: root });
  await generateServiceRegistry({ servicesRoot: root, check: true });
  await generateServiceRegistry({ servicesRoot: root });

  assert.equal(await readFile(helperPath, "utf8"), helper);
});

test("preserves a generated-shaped JavaScript file with a mismatched wrapper filename", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await addService(root, "vendor__removed", "removed-service");
  await generateServiceRegistry({ servicesRoot: root });
  const generatedWrapper = await readFile(path.join(root, "bin", "removed-service.js"), "utf8");
  const helperPath = path.join(root, "bin", "manual-helper.js");
  await writeFile(helperPath, generatedWrapper);
  await rm(path.join(root, "vendor__removed"), { recursive: true });

  await generateServiceRegistry({ servicesRoot: root });

  assert.equal(await readFile(helperPath, "utf8"), generatedWrapper);
});

test("rejects duplicate service names", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__first", "duplicate");
  await addService(root, "vendor__second", "duplicate");

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root }),
    /duplicate service name "duplicate".*vendor__first.*vendor__second/s,
  );
});

test("rejects a missing service entry file", async () => {
  const missingRoot = await createServicesRoot();
  await addService(missingRoot, "vendor__missing", "missing");
  await rm(path.join(missingRoot, "vendor__missing", "bin", "missing.js"));
  await writeFile(
    path.join(missingRoot, "vendor__missing", "package.json"),
    `${JSON.stringify(
      { name: "missing", type: "module", bin: { missing: "bin/not-there.js" } },
      null,
      2,
    )}\n`,
  );

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: missingRoot }),
    /service entry does not exist.*vendor__missing\/bin\/not-there\.js/s,
  );
});

test("rejects a non-executable service entry file", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await chmod(path.join(root, "vendor__alpha", "bin", "alpha.js"), 0o644);

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root }),
    /service entry is not executable.*vendor__alpha\/bin\/alpha\.js/s,
  );
});

test("uses the package bin declaration when a conventional entry also exists", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha", "commands/start.js");
  const conventionalEntry = path.join(root, "vendor__alpha", "bin", "alpha.js");
  await writeFile(conventionalEntry, "#!/usr/bin/env node\n");
  await chmod(conventionalEntry, 0o755);

  await generateServiceRegistry({ servicesRoot: root });

  const wrapper = await readFile(path.join(root, "bin", "start.js"), "utf8");
  assert.match(wrapper, /\.\.\/vendor__alpha\/commands\/start\.js/);
});

test("rejects service entries that are not regular files", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const entryPath = path.join(root, "vendor__alpha", "bin", "alpha.js");
  await rm(entryPath);
  await mkdir(entryPath);

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root }),
    /service entry is not a regular file.*vendor__alpha\/bin\/alpha\.js/s,
  );
});

test("rejects service modules that are not regular files", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  const serviceModulePath = path.join(root, "vendor__alpha", "src", "service.js");
  await rm(serviceModulePath);
  await mkdir(serviceModulePath);

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root }),
    /service module is not a regular file.*vendor__alpha\/src\/service\.js/s,
  );
});

test("rejects services that generate the same root wrapper path", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha", "alpha-bin/shared.js");
  await addService(root, "vendor__beta", "beta", "beta-bin/shared.js");

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root }),
    /duplicate root wrapper bin\/shared\.js.*vendor__alpha.*vendor__beta/s,
  );
});

test("check mode reports a generated wrapper that is not executable", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await generateServiceRegistry({ servicesRoot: root });
  await chmod(path.join(root, "bin", "alpha.js"), 0o644);

  await assert.rejects(
    generateServiceRegistry({ servicesRoot: root, check: true }),
    /service registry is out of date.*bin\/alpha\.js \(not executable\)/s,
  );
});

test("preserves valid wrapper extensions while checking their registry references", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__alpha", "alpha");
  await generateServiceRegistry({ servicesRoot: root });
  const wrapperPath = path.join(root, "bin", "alpha.js");
  const customWrapper = (await readFile(wrapperPath, "utf8")).replace(
    'import { service } from "../vendor__alpha/src/service.js";',
    'import { service } from "../vendor__alpha/src/service.js";\nawait Promise.resolve("custom setup");',
  );
  await writeFile(wrapperPath, customWrapper);

  await generateServiceRegistry({ servicesRoot: root });
  assert.equal(await readFile(wrapperPath, "utf8"), customWrapper);
  await generateServiceRegistry({ servicesRoot: root, check: true });
});

test("supports service names that match JavaScript object prototype keys", async () => {
  const root = await createServicesRoot();
  await addService(root, "vendor__prototype", "__proto__");

  await generateServiceRegistry({ servicesRoot: root });

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.bin.__proto__, "bin/__proto__.js");

  const dispatcher = await readFile(path.join(root, "bin", "octobus-tentacles.js"), "utf8");
  assert.match(dispatcher, /Object\.assign\(Object\.create\(null\), \{/);
  assert.match(dispatcher, /\["__proto__"\]: \{/);
});
