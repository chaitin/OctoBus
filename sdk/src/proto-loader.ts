import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { create, createFileRegistry, fromBinary, fromJson, toBinary, type DescMethod, type DescMessage, type DescService, type FileRegistry, type Message } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema, type FileDescriptorSet } from "@bufbuild/protobuf/wkt";
import { withProtoNameAliases } from "./protobuf-json.js";

export interface ServiceManifest {
  schema: string;
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  runtime?: unknown;
  sdk?: {
    cli?: {
      commands?: Record<string, {
        name?: string;
        description?: string;
        examples?: Array<{
          argv: string[];
          description?: string;
        }>;
      }>;
    };
    [key: string]: unknown;
  };
  proto: {
    roots: string[];
    files: string[];
  };
  configSchema?: string;
  secretSchema?: string;
  [key: string]: unknown;
}

export interface LoadedServicePackage {
  packageDir: string;
  manifest: ServiceManifest;
  entry: string;
  descriptorSet: FileDescriptorSet;
  registry: FileRegistry;
  services: DescService[];
  grpcServices: GrpcServiceDefinition[];
}

export interface LoadServiceDescriptorOptions {
  descriptorPath: string;
  manifestPath?: string;
  packageDir?: string;
}

export interface GrpcServiceDefinition {
  descriptor: DescService;
  definition: grpc.ServiceDefinition<grpc.UntypedServiceImplementation>;
}

export interface FindPackageRootOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fromFile?: string;
}

export function findPackageRoot(options: FindPackageRootOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = path.resolve(options.cwd ?? process.cwd());

  if (env.OCTOBUS_PACKAGE_DIR) {
    const packageDir = path.resolve(env.OCTOBUS_PACKAGE_DIR);
    assertServiceJsonExists(packageDir);
    return packageDir;
  }

  const roots = options.fromFile
    ? [path.dirname(fs.realpathSync(path.resolve(options.fromFile))), cwd]
    : [cwd];

  for (const root of roots) {
    const found = findPackageRootFrom(root);
    if (found) {
      return found;
    }
  }

  throw new Error(`service.json not found from ${cwd}`);
}

function findPackageRootFrom(root: string): string | undefined {
  let current = root;
  while (true) {
    if (fs.existsSync(path.join(current, "service.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

export function readServiceManifest(packageDir: string): ServiceManifest {
  const manifestPath = path.join(packageDir, "service.json");
  return readServiceManifestFile(manifestPath, packageDir);
}

function readServiceManifestFile(manifestPath: string, packageDir: string): ServiceManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as ServiceManifest & { id?: unknown };

  validateServiceManifest(packageDir, manifest);

  if (!manifest.version) {
    manifest.version = readPackageJson(packageDir)?.version;
  }

  return manifest;
}

export function loadServicePackage(packageDir: string, env: NodeJS.ProcessEnv = process.env): LoadedServicePackage {
  const manifest = readServiceManifest(packageDir);
  const entry = inferPackageBin(packageDir);
  const includeDirs = [
    packageDir,
    ...manifest.proto.roots.map((root) => path.resolve(packageDir, root)),
  ];
  const files = resolveProtoFiles(packageDir, manifest);
  const descriptorSet = loadDescriptorSet(files, includeDirs, env);
  const registry = createFileRegistry(descriptorSet);
  const services = [...registry.files].flatMap((file) => file.services);

  return {
    packageDir,
    manifest,
    entry,
    descriptorSet,
    registry,
    services,
    grpcServices: services.map((service) => ({
      descriptor: service,
      definition: createGrpcServiceDefinition(service),
    })),
  };
}

export function loadServiceDescriptor(options: LoadServiceDescriptorOptions): LoadedServicePackage {
  const descriptorPath = path.resolve(options.descriptorPath);
  const manifestPath = options.manifestPath ? path.resolve(options.manifestPath) : undefined;
  const packageDir = path.resolve(options.packageDir ?? (manifestPath ? path.dirname(manifestPath) : path.dirname(descriptorPath)));
  const manifest = manifestPath
    ? readServiceDescriptorManifest(manifestPath, path.dirname(manifestPath))
    : createDescriptorOnlyManifest(descriptorPath);
  const descriptorSet = readDescriptorSet(descriptorPath);
  const registry = createFileRegistry(descriptorSet);
  const services = [...registry.files].flatMap((file) => file.services);

  return {
    packageDir,
    manifest,
    entry: "",
    descriptorSet,
    registry,
    services,
    grpcServices: services.map((service) => ({
      descriptor: service,
      definition: createGrpcServiceDefinition(service),
    })),
  };
}

function readServiceDescriptorManifest(manifestPath: string, packageDir: string): ServiceManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as ServiceManifest & { id?: unknown };

  validateServiceManifest(packageDir, manifest, { validatePackageReferences: false });

  if (!manifest.version) {
    manifest.version = readPackageJson(packageDir)?.version;
  }

  return manifest;
}

export function loadServiceRuntime(options: LoadServiceDescriptorOptions | { packageDir: string; env?: NodeJS.ProcessEnv }): LoadedServicePackage {
  if ("descriptorPath" in options && options.descriptorPath) {
    return loadServiceDescriptor(options);
  }
  if (!("packageDir" in options) || !options.packageDir) {
    throw new Error("loadServiceRuntime requires descriptorPath or packageDir");
  }
  const packageOptions = options as { packageDir: string; env?: NodeJS.ProcessEnv };
  return loadServicePackage(packageOptions.packageDir, packageOptions.env);
}

function createDescriptorOnlyManifest(descriptorPath: string): ServiceManifest {
  return {
    schema: "chaitin.octobus.service.v1",
    name: path.basename(descriptorPath, path.extname(descriptorPath)) || "service",
    proto: {
      roots: [],
      files: [],
    },
  };
}

function resolveProtoFiles(packageDir: string, manifest: ServiceManifest): string[] {
  return manifest.proto.files.map((file) => {
    if (path.isAbsolute(file)) {
      return file;
    }

    const fromPackageRoot = path.resolve(packageDir, file);
    if (fs.existsSync(fromPackageRoot)) {
      return fromPackageRoot;
    }

    return file;
  });
}

function loadDescriptorSet(files: string[], includeDirs: string[], env: NodeJS.ProcessEnv): FileDescriptorSet {
  if (env.OCTOBUS_DESCRIPTOR_PATH) {
    const descriptorPath = path.resolve(env.OCTOBUS_DESCRIPTOR_PATH);
    return readDescriptorSet(descriptorPath);
  }

  const descriptorPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "octobus-descriptor-")), "descriptor.pb");
  try {
    execFileSync("protoc", [
      ...includeDirs.flatMap((includeDir) => ["-I", includeDir]),
      "--include_imports",
      `--descriptor_set_out=${descriptorPath}`,
      ...files,
    ]);
    return readDescriptorSet(descriptorPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`protoc failed to load proto files ${files.join(", ")}: ${message}`);
  } finally {
    try {
      fs.rmSync(path.dirname(descriptorPath), { force: true, recursive: true });
    } catch {
      // Best-effort cleanup for temporary descriptor sets.
    }
  }
}

function readDescriptorSet(filePath: string): FileDescriptorSet {
  try {
    return fromBinary(FileDescriptorSetSchema, fs.readFileSync(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read protobuf descriptor set ${filePath}: ${message}`);
  }
}

export function createGrpcServiceDefinition(service: DescService): grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
  const definition: Record<string, grpc.MethodDefinition<unknown, unknown>> = {};
  for (const method of service.methods) {
    definition[method.name] = {
      path: `/${service.typeName}/${method.name}`,
      requestStream: method.methodKind === "client_streaming" || method.methodKind === "bidi_streaming",
      responseStream: method.methodKind === "server_streaming" || method.methodKind === "bidi_streaming",
      requestSerialize: (value: unknown) => serializeMessage(method.input, value),
      // Aliased so a handler can read the request by the field names its .proto
      // declares — the same names OctoBus advertises — and not only by the
      // camelCase property protobuf-es creates. See withProtoNameAliases.
      requestDeserialize: (data: Buffer) => withProtoNameAliases(fromBinary(method.input, data), method.input),
      responseSerialize: (value: unknown) => serializeMessage(method.output, value),
      responseDeserialize: (data: Buffer) => fromBinary(method.output, data),
      originalName: method.localName,
      requestType: method.input,
      responseType: method.output,
    } as grpc.MethodDefinition<unknown, unknown> & {
      requestType: DescMethod["input"];
      responseType: DescMethod["output"];
    };
  }
  return definition as grpc.ServiceDefinition<grpc.UntypedServiceImplementation>;
}

function serializeMessage(schema: DescMethod["input"], value: unknown): Buffer {
  const message = messageFromRuntimeValue(schema, value);
  return Buffer.from(toBinary(schema, message));
}

function messageFromRuntimeValue(schema: DescMessage, value: unknown): Message {
  if (isMessage(value)) {
    return value;
  }
  if (isPlainObject(value)) {
    try {
      return fromJson(schema, value as never);
    } catch {
      return create(schema, value);
    }
  }
  return create(schema);
}

function isMessage(value: unknown): value is Message {
  return value !== null
    && typeof value === "object"
    && "$typeName" in value
    && typeof (value as { $typeName?: unknown }).$typeName === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PackageJson {
  name?: string;
  version?: string;
  bin?: string | Record<string, unknown>;
}

export function readPackageJson(packageDir: string): PackageJson | undefined {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

export function inferPackageBin(packageDir: string): string {
  const packageJson = readPackageJson(packageDir);
  if (!packageJson) {
    throw new Error("package.json cannot be read");
  }
  if (typeof packageJson.bin === "string") {
    return validatePackageBinTarget(packageJson.bin);
  }
  if (packageJson.bin && typeof packageJson.bin === "object") {
    const entries = Object.entries(packageJson.bin);
    if (entries.length !== 1) {
      throw new Error(`package.json bin must contain exactly one entry, got ${entries.length}`);
    }
    const [name, target] = entries[0];
    if (typeof target !== "string") {
      throw new Error(`package.json bin ${JSON.stringify(name)} target must be a string`);
    }
    return validatePackageBinTarget(target);
  }
  throw new Error("package.json bin is required");
}

export function inferPackageBinName(packageDir: string): string {
  const packageJson = readPackageJson(packageDir);
  if (!packageJson) {
    throw new Error("package.json cannot be read");
  }
  if (typeof packageJson.bin === "string") {
    return packageJsonCommandName(packageJson.name);
  }
  if (packageJson.bin && typeof packageJson.bin === "object") {
    const entries = Object.entries(packageJson.bin);
    if (entries.length !== 1) {
      throw new Error(`package.json bin must contain exactly one entry, got ${entries.length}`);
    }
    const [name, target] = entries[0];
    if (typeof target !== "string") {
      throw new Error(`package.json bin ${JSON.stringify(name)} target must be a string`);
    }
    return name;
  }
  throw new Error("package.json bin is required");
}

function packageJsonCommandName(packageName: string | undefined): string {
  if (!packageName) {
    throw new Error("package.json name is required when bin is a string");
  }
  return packageName.includes("/") ? packageName.slice(packageName.lastIndexOf("/") + 1) : packageName;
}

export function validatePackageFile(packageDir: string, relativePath: string, field: string): string {
  validateRelativePackagePath(packageDir, relativePath, field);
  const fullPath = path.resolve(packageDir, relativePath);
  const packageRoot = path.resolve(packageDir);
  const relative = path.relative(packageRoot, fullPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} ${JSON.stringify(relativePath)} must stay inside the package`);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch (error) {
    throw new Error(`${field} ${JSON.stringify(relativePath)} does not exist: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${field} ${JSON.stringify(relativePath)} must be a regular file`);
  }
  return fullPath;
}

function assertServiceJsonExists(packageDir: string): void {
  if (!fs.existsSync(path.join(packageDir, "service.json"))) {
    throw new Error(`service.json not found in ${packageDir}`);
  }
}

function validateServiceManifest(
  packageDir: string,
  manifest: ServiceManifest & { id?: unknown; entry?: unknown },
  options: { validatePackageReferences?: boolean } = {},
): void {
  const validatePackageReferences = options.validatePackageReferences ?? true;
  if (manifest.schema !== "chaitin.octobus.service.v1") {
    throw new Error("service.json schema must be chaitin.octobus.service.v1");
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    throw new Error("service.json name must be a non-empty string");
  }
  if (Object.prototype.hasOwnProperty.call(manifest, "id")) {
    throw new Error("service.json must not define top-level id");
  }
  if (Object.prototype.hasOwnProperty.call(manifest, "entry")) {
    throw new Error("service.json must not define entry; use package.json bin");
  }
  if (!manifest.proto || typeof manifest.proto !== "object") {
    throw new Error("service.json proto is required");
  }
  validateStringArray(manifest.proto.roots, "service.json proto.roots");
  validateStringArray(manifest.proto.files, "service.json proto.files");
  if (validatePackageReferences && manifest.configSchema) {
    validatePackageFile(packageDir, manifest.configSchema, "service.json configSchema");
  }
  if (validatePackageReferences && manifest.secretSchema) {
    validatePackageFile(packageDir, manifest.secretSchema, "service.json secretSchema");
  }
}

function validateStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`${field} must be a non-empty string array`);
  }
}

function validatePackageBinTarget(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("package.json bin must be a non-empty string");
  }
  if (path.isAbsolute(value)) {
    throw new Error("package.json bin must be relative");
  }
  validateRelativePackagePath("", value, "package.json bin");
  return value;
}

function validateRelativePackagePath(packageDir: string, relativePath: string, field: string): void {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${field} must be a relative path inside the package`);
  }
  const resolved = path.resolve(packageDir || ".", relativePath);
  const root = path.resolve(packageDir || ".");
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay inside the package`);
  }
}
