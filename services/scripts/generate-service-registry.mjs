#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_BIN_NAME = "octobus-tentacles";
const ROOT_BIN_TARGET = "bin/octobus-tentacles.js";
const SERVICE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXECUTABLE_MODE = 0o755;

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath}: failed to read JSON: ${error.message}`);
  }
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function filepathFromPackagePath(packagePath) {
  return packagePath.split("/").join(path.sep);
}

function parseArgs(argv) {
  const opts = {
    check: false,
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      opts.check = true;
      continue;
    }
    if (arg === "--root") {
      if (i + 1 >= argv.length || argv[i + 1] === "") {
        throw new Error("--root must not be empty");
      }
      opts.root = argv[++i];
      continue;
    }
    if (arg.startsWith("--root=")) {
      opts.root = arg.slice("--root=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (opts.root === "") {
    throw new Error("--root must not be empty");
  }

  return {
    ...opts,
    root: path.resolve(opts.root),
  };
}

function isServiceDir(root, entry) {
  if (!entry.isDirectory()) {
    return false;
  }
  if (entry.name === "bin" || entry.name === "scripts" || entry.name === "tests" || entry.name === "node_modules") {
    return false;
  }
  if (entry.name.startsWith(".")) {
    return false;
  }
  return fs.existsSync(path.join(root, entry.name, "service.json"));
}

export function discoverServices(root) {
  const services = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => isServiceDir(root, entry))
    .map((entry) => {
      const dir = entry.name;
      const manifest = readJSON(path.join(root, dir, "service.json"));
      if (!SERVICE_NAME_RE.test(manifest.name ?? "")) {
        throw new Error(`${dir}/service.json name "${manifest.name ?? ""}" must match ${SERVICE_NAME_RE}`);
      }
      return {
        dir,
        name: manifest.name,
        rootBinTarget: `bin/${manifest.name}.js`,
        serviceEntry: `${dir}/bin/${manifest.name}.js`,
        serviceModule: `${dir}/src/service.js`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const seen = new Map();
  for (const service of services) {
    const previous = seen.get(service.name);
    if (previous != null) {
      throw new Error(`duplicate service name "${service.name}" in ${previous} and ${service.dir}`);
    }
    seen.set(service.name, service.dir);
  }

  return services;
}

function assertServiceFiles(root, services) {
  const errors = [];
  for (const service of services) {
    for (const [label, relativePath] of [
      ["service entry", service.serviceEntry],
      ["service module", service.serviceModule],
    ]) {
      const fullPath = path.join(root, filepathFromPackagePath(relativePath));
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        errors.push(`${service.dir} ${label} "${relativePath}" must exist`);
        continue;
      }
      if (!stat.isFile()) {
        errors.push(`${service.dir} ${label} "${relativePath}" must be a file`);
        continue;
      }
      if (label === "service entry" && (stat.mode & 0o111) === 0) {
        errors.push(`${service.dir} ${label} "${relativePath}" must be executable`);
      }
    }
  }
  return errors;
}

function makeServiceEntriesExecutable(root, services) {
  for (const service of services) {
    const entryPath = path.join(root, filepathFromPackagePath(service.serviceEntry));
    if (!fs.existsSync(entryPath)) {
      continue;
    }
    const stat = fs.statSync(entryPath);
    if (stat.isFile() && (stat.mode & 0o111) === 0) {
      fs.chmodSync(entryPath, EXECUTABLE_MODE);
    }
  }
}

function desiredPackage(pkg, services) {
  const next = {
    ...pkg,
    bin: {
      [ROOT_BIN_NAME]: ROOT_BIN_TARGET,
    },
  };

  for (const service of services) {
    next.bin[service.name] = service.rootBinTarget;
  }

  next.files = [
    ...services.map((service) => service.rootBinTarget),
    ...services.map((service) => service.dir),
    "scripts",
    ROOT_BIN_TARGET,
  ];

  return next;
}

function desiredDispatcher(services) {
  const serviceMap = services.map((service) => `  "${service.name}": {
    entryFile: "../${service.serviceEntry}",
    serviceModule: "../${service.serviceModule}",
  },`).join("\n");

  return `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = {
${serviceMap}
};

const serviceNames = Object.keys(services);

const program = new Command();

program
  .name("octobus-tentacles")
  .usage("<service> [args]")
  .description("Run a service from this package")
  .argument("[service]", "service name")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .passThroughOptions()
  .addHelpText("after", \`
Services:
\${serviceNames.map((name) => \`  \${name.padEnd(37)}\`).join("\\n")}

Use 'octobus-tentacles <service> --help' to print service help.\`)
  .action(async (serviceName) => {
    if (!serviceName) {
      program.outputHelp();
      return;
    }

    const selected = services[serviceName];
    if (!selected) {
      process.stderr.write(\`Unknown service: \${serviceName}\\n\\n\`);
      program.outputHelp({ error: true });
      process.exitCode = 1;
      return;
    }

    const { service } = await import(new URL(selected.serviceModule, import.meta.url));

    await runServiceMain(service, {
      argv: program.args.slice(1),
      entryFile: fileURLToPath(new URL(selected.entryFile, import.meta.url)),
    });
  });

await program.parseAsync();
`;
}

function desiredWrapper(service) {
  return `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../${service.serviceModule}";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../${service.serviceEntry}", import.meta.url)),
});
`;
}

function isValidCustomWrapper(source, service) {
  return source.includes("import { fileURLToPath } from \"node:url\";")
    && source.includes("runServiceMain(service, {")
    && source.includes(`../${service.serviceModule}`)
    && source.includes(`entryFile: fileURLToPath(new URL("../${service.serviceEntry}", import.meta.url))`);
}

function compareText(errors, label, actualPath, expected) {
  if (!fs.existsSync(actualPath)) {
    errors.push(`${label} must exist`);
    return;
  }
  if (fs.readFileSync(actualPath, "utf8") !== expected) {
    errors.push(`${label} is not up to date`);
  }
}

function compareJSON(errors, label, actualPath, expected) {
  if (!fs.existsSync(actualPath)) {
    errors.push(`${label} must exist`);
    return;
  }
  const actual = readJSON(actualPath);
  if (`${JSON.stringify(actual, null, 2)}\n` !== `${JSON.stringify(expected, null, 2)}\n`) {
    errors.push(`${label} is not up to date`);
  }
}

function checkDuplicateFiles(errors, pkg) {
  if (!Array.isArray(pkg.files)) {
    errors.push("package.json files must be an array");
    return;
  }
  const seen = new Set();
  for (const entry of pkg.files) {
    if (seen.has(entry)) {
      errors.push(`package.json files contains duplicate entry "${entry}"`);
    }
    seen.add(entry);
  }
}

function checkExecutable(errors, filePath, label) {
  if (!fs.existsSync(filePath)) {
    errors.push(`${label} must exist`);
    return;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    errors.push(`${label} must be a file`);
    return;
  }
  if ((stat.mode & 0o111) === 0) {
    errors.push(`${label} must be executable`);
  }
}

function checkWrappers(errors, root, services) {
  for (const service of services) {
    const wrapperPath = path.join(root, filepathFromPackagePath(service.rootBinTarget));
    const expected = desiredWrapper(service);
    if (!fs.existsSync(wrapperPath)) {
      errors.push(`${service.rootBinTarget} must exist`);
      continue;
    }
    checkExecutable(errors, wrapperPath, service.rootBinTarget);
    const actual = fs.readFileSync(wrapperPath, "utf8");
    if (actual !== expected && !isValidCustomWrapper(actual, service)) {
      errors.push(`${service.rootBinTarget} must point to ${service.dir}`);
    }
  }
}

function updateWrapper(root, service) {
  const wrapperPath = path.join(root, filepathFromPackagePath(service.rootBinTarget));
  const expected = desiredWrapper(service);
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  if (fs.existsSync(wrapperPath)) {
    const actual = fs.readFileSync(wrapperPath, "utf8");
    if (actual !== expected && isValidCustomWrapper(actual, service)) {
      fs.chmodSync(wrapperPath, EXECUTABLE_MODE);
      return false;
    }
  }
  fs.writeFileSync(wrapperPath, expected);
  fs.chmodSync(wrapperPath, EXECUTABLE_MODE);
  return true;
}

export function checkRegistry(root) {
  const services = discoverServices(root);
  const errors = assertServiceFiles(root, services);
  const packagePath = path.join(root, "package.json");
  const dispatcherPath = path.join(root, filepathFromPackagePath(ROOT_BIN_TARGET));
  const pkg = fs.existsSync(packagePath) ? readJSON(packagePath) : {};

  compareJSON(errors, "package.json", packagePath, desiredPackage(pkg, services));
  checkDuplicateFiles(errors, pkg);
  compareText(errors, ROOT_BIN_TARGET, dispatcherPath, desiredDispatcher(services));
  checkExecutable(errors, dispatcherPath, ROOT_BIN_TARGET);
  checkWrappers(errors, root, services);

  return { errors };
}

export function generateRegistry(root) {
  const services = discoverServices(root);
  makeServiceEntriesExecutable(root, services);
  const serviceFileErrors = assertServiceFiles(root, services);
  if (serviceFileErrors.length > 0) {
    throw new Error(serviceFileErrors.join("\n"));
  }

  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error(`${packagePath}: missing package.json`);
  }
  const pkg = readJSON(packagePath);
  writeJSON(packagePath, desiredPackage(pkg, services));

  const dispatcherPath = path.join(root, filepathFromPackagePath(ROOT_BIN_TARGET));
  fs.mkdirSync(path.dirname(dispatcherPath), { recursive: true });
  fs.writeFileSync(dispatcherPath, desiredDispatcher(services));
  fs.chmodSync(dispatcherPath, EXECUTABLE_MODE);

  let writtenWrappers = 0;
  for (const service of services) {
    if (updateWrapper(root, service)) {
      writtenWrappers += 1;
    }
  }

  return {
    services: services.length,
    writtenWrappers,
  };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.check) {
    const { errors } = checkRegistry(opts.root);
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`error: ${error}`);
      }
      return 1;
    }
    console.log("service registry is up to date");
    return 0;
  }

  const result = generateRegistry(opts.root);
  console.log(`generated service registry for ${result.services} services`);
  if (result.writtenWrappers > 0) {
    console.log(`updated ${result.writtenWrappers} root wrappers`);
  }
  return 0;
}

const entrypoint = fileURLToPath(import.meta.url);
if (process.argv[1] != null && path.resolve(process.argv[1]) === entrypoint) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
