#!/usr/bin/env node

import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const executableMode = 0o755;

function parseJSON(contents, filePath) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function readJSON(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${filePath}: ${error.message}`);
  }
  return parseJSON(contents, filePath);
}

async function fileStatus(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function normalizeRelativePath(value, description) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${description} must stay inside its service directory: ${value}`);
  }
  return normalized;
}

async function discoverServices(servicesRoot) {
  const entries = await readdir(servicesRoot, { withFileTypes: true });
  const services = [];
  const names = new Map();
  const wrapperPaths = new Map();

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = entry.name;
    const serviceRoot = path.join(servicesRoot, directory);
    const serviceSpecPath = path.join(serviceRoot, "service.json");
    if (!(await fileStatus(serviceSpecPath))) {
      continue;
    }

    const serviceSpec = await readJSON(serviceSpecPath);
    const name = serviceSpec.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${directory}/service.json must declare a non-empty name`);
    }
    if (names.has(name)) {
      throw new Error(
        `duplicate service name "${name}" in ${names.get(name)} and ${directory}`,
      );
    }
    names.set(name, directory);

    const packagePath = path.join(serviceRoot, "package.json");
    const servicePackage = await readJSON(packagePath);
    const directEntry = `bin/${name}.js`;
    const declaredEntry = servicePackage.bin?.[name];
    let entryFile;
    if (declaredEntry !== undefined) {
      entryFile = normalizeRelativePath(declaredEntry, `${directory}/package.json bin.${name}`);
    } else if (await fileStatus(path.join(serviceRoot, directEntry))) {
      entryFile = directEntry;
    } else {
      throw new Error(
        `${directory}/package.json must declare bin.${name}, or ${directory}/${directEntry} must exist`,
      );
    }

    const entryPath = path.join(serviceRoot, entryFile);
    const entryStatus = await fileStatus(entryPath);
    if (!entryStatus) {
      throw new Error(`service entry does not exist: ${directory}/${entryFile}`);
    }
    if (!entryStatus.isFile()) {
      throw new Error(`service entry is not a regular file: ${directory}/${entryFile}`);
    }
    if ((entryStatus.mode & 0o111) === 0) {
      throw new Error(`service entry is not executable: ${directory}/${entryFile}`);
    }

    const serviceModule = "src/service.js";
    const serviceModuleStatus = await fileStatus(path.join(serviceRoot, serviceModule));
    if (!serviceModuleStatus) {
      throw new Error(`service module does not exist: ${directory}/${serviceModule}`);
    }
    if (!serviceModuleStatus.isFile()) {
      throw new Error(`service module is not a regular file: ${directory}/${serviceModule}`);
    }

    const wrapperFile = `bin/${path.posix.basename(entryFile)}`;
    if (wrapperPaths.has(wrapperFile)) {
      throw new Error(
        `duplicate root wrapper ${wrapperFile} for ${wrapperPaths.get(wrapperFile)} and ${directory}`,
      );
    }
    wrapperPaths.set(wrapperFile, directory);

    services.push({ directory, entryFile, name, serviceModule, wrapperFile });
  }

  return services.sort((a, b) => a.name.localeCompare(b.name));
}

function renderPackageJSON(currentPackage, services) {
  const bins = Object.fromEntries([
    ["octobus-tentacles", "bin/octobus-tentacles.js"],
    ...services.map((service) => [service.name, service.wrapperFile]),
  ]);
  const files = ["scripts", "bin/octobus-tentacles.js"];
  for (const service of services) {
    files.push(service.wrapperFile, service.directory);
  }

  return `${JSON.stringify({ ...currentPackage, bin: bins, files }, null, 2)}\n`;
}

function renderDispatcher(services) {
  const registrations = services
    .map(
      (service) => `  ${service.name === "__proto__" ? `[${JSON.stringify(service.name)}]` : JSON.stringify(service.name)}: {
    entryFile: ${JSON.stringify(`../${service.directory}/${service.entryFile}`)},
    serviceModule: ${JSON.stringify(`../${service.directory}/${service.serviceModule}`)},
  },`,
    )
    .join("\n");

  return `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { Command } from "commander";

const services = Object.assign(Object.create(null), {
${registrations}
});

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

function renderWrapper(service) {
  return `#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from ${JSON.stringify(`../${service.directory}/${service.serviceModule}`)};

runServiceMain(service, {
  entryFile: fileURLToPath(new URL(${JSON.stringify(`../${service.directory}/${service.entryFile}`)}, import.meta.url)),
});
`;
}

function isValidWrapperContents(contents, service) {
  return [
    "#!/usr/bin/env node",
    'import { fileURLToPath } from "node:url";',
    'import { runServiceMain } from "@chaitin-ai/octobus-sdk";',
    `import { service } from ${JSON.stringify(`../${service.directory}/${service.serviceModule}`)};`,
    "runServiceMain(service, {",
    `entryFile: fileURLToPath(new URL(${JSON.stringify(`../${service.directory}/${service.entryFile}`)}, import.meta.url))`,
  ].every((snippet) => contents.includes(snippet));
}

async function inspectGeneratedFile(filePath, expectedContents, executable, validateContents) {
  const currentStatus = await fileStatus(filePath);
  if (!currentStatus) {
    return "missing";
  }
  const currentContents = await readFile(filePath, "utf8");
  if (validateContents ? !validateContents(currentContents) : currentContents !== expectedContents) {
    return "content differs";
  }
  if (executable && (currentStatus.mode & 0o111) === 0) {
    return "not executable";
  }
  return undefined;
}

async function writeGeneratedFile(filePath, contents, executable, validateContents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const current = await fileStatus(filePath);
  const currentContents = current ? await readFile(filePath, "utf8") : undefined;
  const contentsValid = currentContents !== undefined && (
    validateContents ? validateContents(currentContents) : currentContents === contents
  );
  if (!contentsValid) {
    await writeFile(filePath, contents);
  }
  if (executable) {
    await chmod(filePath, executableMode);
  }
}

async function findUnexpectedRootWrappers(root, generatedFiles) {
  const binPath = path.join(root, "bin");
  if (!(await fileStatus(binPath))) {
    return [];
  }
  const expectedNames = new Set(
    generatedFiles
      .filter((generated) => path.dirname(generated.path) === binPath)
      .map((generated) => path.basename(generated.path)),
  );
  const entries = await readdir(binPath, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".js") && !expectedNames.has(entry.name),
    )
    .map((entry) => path.join(binPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function generateServiceRegistry({ servicesRoot, check = false } = {}) {
  const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const root = path.resolve(servicesRoot ?? defaultRoot);
  const packagePath = path.join(root, "package.json");
  const currentPackage = await readJSON(packagePath);
  const services = await discoverServices(root);
  if (services.length === 0) {
    throw new Error(`no service packages found under ${root}`);
  }

  const generatedFiles = [
    {
      contents: renderPackageJSON(currentPackage, services),
      executable: false,
      path: packagePath,
    },
    {
      contents: renderDispatcher(services),
      executable: true,
      path: path.join(root, "bin", "octobus-tentacles.js"),
    },
    ...services.map((service) => ({
      contents: renderWrapper(service),
      executable: true,
      path: path.join(root, service.wrapperFile),
      validateContents: (contents) => isValidWrapperContents(contents, service),
    })),
  ];
  const unexpectedRootWrappers = await findUnexpectedRootWrappers(root, generatedFiles);

  if (check) {
    const stale = [];
    for (const generated of generatedFiles) {
      const reason = await inspectGeneratedFile(
        generated.path,
        generated.contents,
        generated.executable,
        generated.validateContents,
      );
      if (reason) {
        stale.push(`${path.relative(root, generated.path)} (${reason})`);
      }
    }
    for (const unexpected of unexpectedRootWrappers) {
      stale.push(`${path.relative(root, unexpected)} (unexpected generated file)`);
    }
    if (stale.length > 0) {
      throw new Error(`service registry is out of date:\n- ${stale.join("\n- ")}`);
    }
    return { checked: generatedFiles.length, services: services.length };
  }

  for (const generated of generatedFiles) {
    await writeGeneratedFile(
      generated.path,
      generated.contents,
      generated.executable,
      generated.validateContents,
    );
  }
  for (const unexpected of unexpectedRootWrappers) {
    await unlink(unexpected);
  }
  return { generated: generatedFiles.length, services: services.length };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const args = process.argv.slice(2);
  const unknown = args.filter((argument) => argument !== "--check");
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument: ${unknown[0]}\n`);
    process.exitCode = 2;
  } else {
    try {
      const result = await generateServiceRegistry({ check: args.includes("--check") });
      const action = args.includes("--check") ? "checked" : "generated";
      process.stdout.write(
        `${action} registry for ${result.services} services (${result.checked ?? result.generated} files)\n`,
      );
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
