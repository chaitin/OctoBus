import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BootstrapRuntimeMode = "on-demand" | "long-running";

export interface GenerateBootstrapPackageOptions {
  packageName: string;
  runtimeMode?: BootstrapRuntimeMode;
  bundleDeps?: boolean;
}

export interface BootstrapPackageFile {
  path: string;
  content: string;
  mode?: number;
}

export interface WriteBootstrapPackageOptions extends GenerateBootstrapPackageOptions {
  outDir: string;
  force?: boolean;
  npmEnv?: NodeJS.ProcessEnv;
}

export interface WriteBootstrapPackageResult {
  outDir: string;
  files: BootstrapPackageFile[];
  bundled: boolean;
}

interface BootstrapNames {
  packageName: string;
  derivedName: string;
  protoPackage: string;
  serviceClass: string;
  methodFullName: string;
  entryPath: string;
}

const SDK_PACKAGE_NAME = "@chaitin-ai/octobus-sdk";
let cachedSdkDependencyVersion: string | undefined;

export function generateBootstrapPackageFiles(options: GenerateBootstrapPackageOptions): BootstrapPackageFile[] {
  validateBootstrapOptions(options);
  const runtimeMode = options.runtimeMode ?? "on-demand";
  const names = bootstrapNames(options.packageName);
  return [
    {
      path: "package.json",
      content: `${JSON.stringify(packageJson(names, options.bundleDeps === true), null, 2)}\n`,
    },
    {
      path: "service.json",
      content: `${JSON.stringify(serviceJson(names, runtimeMode), null, 2)}\n`,
    },
    {
      path: "README.md",
      content: readme(names),
    },
    {
      path: "config.schema.json",
      content: `${JSON.stringify(configSchema(), null, 2)}\n`,
    },
    {
      path: "secret.schema.json",
      content: `${JSON.stringify(secretSchema(), null, 2)}\n`,
    },
    {
      path: path.join("proto", `${names.derivedName}.proto`),
      content: protoSource(names),
    },
    {
      path: names.entryPath,
      content: handlerSource(names),
      mode: 0o755,
    },
  ];
}

export function writeBootstrapPackage(options: WriteBootstrapPackageOptions): WriteBootstrapPackageResult {
  const files = generateBootstrapPackageFiles(options);
  const outDir = path.resolve(options.outDir);

  if (fs.existsSync(outDir) && !options.force && fs.readdirSync(outDir).length > 0) {
    throw new Error(`output directory ${outDir} is not empty; pass --force to overwrite generated files`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const destination = path.resolve(outDir, file.path);
    assertInside(outDir, destination, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content, { mode: file.mode ?? 0o644 });
    if (file.mode !== undefined) {
      fs.chmodSync(destination, file.mode);
    }
  }

  if (options.bundleDeps === true) {
    installBundledDependencies(outDir, options.npmEnv);
  }

  return { outDir, files, bundled: options.bundleDeps === true };
}

export function validateBootstrapRuntimeMode(value: string): asserts value is BootstrapRuntimeMode {
  if (value !== "on-demand" && value !== "long-running") {
    throw new Error("bootstrap --runtime-mode must be on-demand or long-running");
  }
}

function validateBootstrapOptions(options: GenerateBootstrapPackageOptions): void {
  validatePackageName(options.packageName, "bootstrap --name");
  if (options.runtimeMode !== undefined) {
    validateBootstrapRuntimeMode(options.runtimeMode);
  }
}

function bootstrapNames(packageName: string): BootstrapNames {
  const derivedName = packageName.includes("/") ? packageName.slice(packageName.lastIndexOf("/") + 1) : packageName;
  const tokens = derivedName.split(/[^a-z0-9]+/).filter(Boolean);
  const safeTokens = tokens.length > 0 ? tokens : ["service"];
  const serviceBase = safeTokens.map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`).join("");
  const serviceClass = safeTokens.at(-1) === "service" ? serviceBase : `${serviceBase}Service`;
  const protoPackage = `${safeTokens.join(".")}.v1`;
  return {
    packageName,
    derivedName,
    protoPackage,
    serviceClass,
    methodFullName: `${protoPackage}.${serviceClass}/Echo`,
    entryPath: path.join("bin", `${derivedName}.js`),
  };
}

function packageJson(names: BootstrapNames, bundleDeps: boolean): Record<string, unknown> {
  const base = {
    name: names.packageName,
    version: "0.1.0",
    private: true,
    type: "module",
    bin: {
      [names.derivedName]: names.entryPath,
    },
    dependencies: {
      [SDK_PACKAGE_NAME]: sdkDependencyVersion(),
    },
  };
  if (bundleDeps) {
    return {
      ...base,
      bundledDependencies: [SDK_PACKAGE_NAME],
    };
  }
  return base;
}

function serviceJson(names: BootstrapNames, runtimeMode: BootstrapRuntimeMode): Record<string, unknown> {
  return {
    schema: "chaitin.octobus.service.v1",
    name: names.derivedName,
    displayName: names.serviceClass,
    description: `Generated OctoBus JavaScript service package for ${names.packageName}.`,
    runtime: {
      mode: runtimeMode,
    },
    proto: {
      roots: ["proto"],
      files: [path.join("proto", `${names.derivedName}.proto`)],
    },
    configSchema: "config.schema.json",
    secretSchema: "secret.schema.json",
  };
}

function configSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: true,
    properties: {
      label: {
        type: "string",
        description: "Optional label returned by the generated Echo method.",
      },
    },
  };
}

function secretSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: true,
    properties: {
      apiToken: {
        type: "string",
        description: "Optional token returned by the generated Echo method.",
      },
    },
  };
}

function protoSource(names: BootstrapNames): string {
  return [
    'syntax = "proto3";',
    `package ${names.protoPackage};`,
    "",
    `service ${names.serviceClass} {`,
    "  rpc Echo(EchoRequest) returns (EchoResponse);",
    "}",
    "",
    "message EchoRequest {",
    "  string text = 1;",
    "}",
    "",
    "message EchoResponse {",
    "  string text = 1;",
    '  string service_id = 2 [json_name = "serviceId"];',
    '  string instance_id = 3 [json_name = "instanceId"];',
    "  string label = 4;",
    '  string business_request_id = 5 [json_name = "businessRequestId"];',
    '  string secret_token = 6 [json_name = "secretToken"];',
    "}",
    "",
  ].join("\n");
}

function handlerSource(names: BootstrapNames): string {
  return [
    "#!/usr/bin/env node",
    "",
    `import { defineService, runServiceMain } from ${JSON.stringify(SDK_PACKAGE_NAME)};`,
    "",
    "const service = defineService({",
    "  handlers: {",
    `    ${JSON.stringify(names.methodFullName)}: (ctx) => {`,
    "      const request = ctx.request ?? {};",
    "      const config = ctx.config ?? {};",
    "      const secret = ctx.secret ?? {};",
    `      const businessRequestId = ctx.getMetadata("x-octobus-ext-business-request-id") ?? "";`,
    "",
    "      return {",
    "        text: String(request.text ?? \"\"),",
    "        serviceId: ctx.serviceId,",
    "        instanceId: ctx.instanceId,",
    "        label: String(config.label ?? \"\"),",
    "        businessRequestId,",
    "        secretToken: String(secret.apiToken ?? \"\"),",
    "      };",
    "    },",
    "  },",
    "});",
    "",
    "runServiceMain(service);",
    "",
  ].join("\n");
}

function readme(names: BootstrapNames): string {
  return [
    `# ${names.packageName}`,
    "",
    "Generated OctoBus JavaScript service package.",
    "",
    "```bash",
    "npm install",
    "npx octobus-sdk validate --strict",
    `node ${names.entryPath} --runtime dev --port 50051 --config-json '{}' --secret-json '{}'`,
    "```",
    "",
  ].join("\n");
}

function validatePackageName(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  if (value.length > 214) {
    throw new Error(`${field} ${JSON.stringify(value)} is too long`);
  }
  const namePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
  if (!namePattern.test(value)) {
    throw new Error(`${field} ${JSON.stringify(value)} is not a valid npm package name`);
  }
}

function assertInside(root: string, target: string, relativePath: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`generated file path ${JSON.stringify(relativePath)} must stay inside the output directory`);
  }
}

function sdkDependencyVersion(): string {
  if (cachedSdkDependencyVersion !== undefined) {
    return cachedSdkDependencyVersion;
  }

  const packageJsonPath = findNearestPackageJson(path.dirname(fileURLToPath(import.meta.url)));
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error(`SDK package version is missing in ${packageJsonPath}`);
  }
  cachedSdkDependencyVersion = `^${packageJson.version.trim()}`;
  return cachedSdkDependencyVersion;
}

function findNearestPackageJson(startDir: string): string {
  let current = startDir;
  for (;;) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`cannot find SDK package.json from ${startDir}`);
    }
    current = parent;
  }
}

function installBundledDependencies(outDir: string, env: NodeJS.ProcessEnv | undefined): void {
  try {
    execFileSync("npm", ["install", "--omit=dev"], {
      cwd: outDir,
      env,
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`npm install --omit=dev failed in ${outDir}: ${commandErrorMessage(error)}`);
  }
}

function commandErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = bufferText(maybe.stderr);
    if (stderr) {
      return stderr;
    }
    const stdout = bufferText(maybe.stdout);
    if (stdout) {
      return stdout;
    }
    if (typeof maybe.message === "string") {
      return maybe.message;
    }
  }
  return String(error);
}

function bufferText(value: unknown): string | undefined {
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8").trim();
    return text || undefined;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  return undefined;
}
