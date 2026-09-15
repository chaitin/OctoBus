#!/usr/bin/env node

import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import * as grpc from "@grpc/grpc-js";
import { type DescMessage } from "@bufbuild/protobuf";
import { Command, CommanderError, type OutputConfiguration } from "commander";
import type { HandlerContext } from "./context.js";
import type { ServiceDefinition as OctobusServiceDefinition } from "./service.js";
import { GrpcError } from "./grpc-error.js";
import { INTERNAL, INVALID_ARGUMENT, UNIMPLEMENTED } from "./status.js";
import { addHealthService } from "./health.js";
import { findPackageRoot, inferPackageBinName, loadServicePackage, type GrpcServiceDefinition } from "./proto-loader.js";
import { decodeRequestJson, messageJsonSchema, protobufMessageToProtoJson } from "./protobuf-json.js";
import { inspectJson, inspectSchemaJson, inspectSchemaYaml, inspectYaml, type ServiceSchemaKind } from "./inspect.js";
import { formatValidationIssues, validateService } from "./validation.js";
import { writeClientPackage, type ClientPackageTransport } from "./client-package.js";
import { generateClientStubSource, validateClientStubTransport } from "./client-stub.js";
import { validateBootstrapRuntimeMode, writeBootstrapPackage, type BootstrapRuntimeMode } from "./bootstrap.js";

const SERVICE_CONTEXT_ENV = "OCTOBUS_SERVICE_CONTEXT";
const SERVICE_CONTEXT_ENV_DESCRIPTION = "JSON object with optional config and secret fields. Also read from .env in the current directory.";

export type CliCommand =
  | {
      command: "serve";
      host: string;
      port: number;
      config?: string;
      configJson?: string;
      secret?: string;
      secretJson?: string;
      secretFd?: string;
      workdir?: string;
      service?: string;
      instance?: string;
    }
  | {
      command: "invoke";
      method: string;
      config: string;
      secret?: string;
      secretFd?: string;
      metadata: string;
      workdir: string;
      service?: string;
      instance?: string;
    }
  | {
      command: "inspect";
      json: boolean;
      yaml: boolean;
      schema?: ServiceSchemaKind;
    }
  | {
      command: "dev";
      host: string;
      port: number;
      config?: string;
      configJson?: string;
      secret?: string;
      secretJson?: string;
      secretFd?: string;
      workdir?: string;
      service?: string;
      instance?: string;
    }
  | {
      command: "cli";
      args: string[];
    }
  | ClientGenerationCliCommand
  | {
      command: "help";
      help: string;
    };

export interface RunServiceOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  stdin?: NodeJS.ReadableStream;
  entryFile?: string;
}

export interface RunServiceMainOptions extends RunServiceOptions {
  exit?: (code: number) => never;
}

export interface ServeResult {
  command: "serve";
  server: grpc.Server;
  address: string;
  port: number;
}

export interface InspectResult {
  command: "inspect";
  manifest: unknown;
}

export interface InvokeResult {
  command: "invoke";
}

export interface ServiceCliResult {
  command: "cli";
  method?: string;
}

export interface HelpResult {
  command: "help";
  help: string;
}

export interface ClientStubResult {
  command: "client-stub";
  transport: ClientPackageTransport;
}

export interface ClientPackageResult {
  command: "client-package";
  transport: ClientPackageTransport;
  outDir: string;
  bundled: boolean;
  published: boolean;
}

export type RunServiceResult = ServeResult | InspectResult | InvokeResult | ServiceCliResult | ClientStubResult | ClientPackageResult | HelpResult;

export function parseCliArgs(argv: string[] = process.argv.slice(2), commandName = "octobus-service"): CliCommand {
  if (argv[0] !== "--runtime") {
    return { command: "cli", args: [...argv] };
  }
  argv = argv.slice(1);
  let parsed: CliCommand | undefined;
  const program = createRuntimeCliProgram(commandName, (command) => {
    parsed = command;
  });
  const help = parseCommanderProgram(program, argv);
  if (help !== undefined) {
    return { command: "help", help };
  }
  if (!parsed) {
    throw new Error("expected subcommand: serve, invoke, inspect, dev, cli, client-stub, or client-package");
  }
  return parsed;
}

type RuntimeCliCommand = Exclude<CliCommand, { command: "help" }>;

type RuntimeCommandHandler = (command: RuntimeCliCommand) => void;
type ClientGenerationCommandHandler = (command: ClientGenerationCliCommand) => void;

interface CommonRuntimeOptions {
  config?: string;
  configJson?: string;
  secret?: string;
  secretJson?: string;
  secretFd?: string;
  workdir?: string;
  service?: string;
  instance?: string;
}

interface ServeOptions extends CommonRuntimeOptions {
  host?: string;
  port?: string;
}

interface InvokeOptions {
  method?: string;
  config?: string;
  secret?: string;
  secretFd?: string;
  metadata?: string;
  workdir?: string;
  service?: string;
  instance?: string;
}

interface InspectOptions {
  json?: boolean;
  yaml?: boolean;
  configSchema?: boolean;
  secretSchema?: boolean;
}

type SdkCliCommand =
  | {
      command: "validate";
      strict: boolean;
    }
  | {
      command: "inspect";
      json: boolean;
      yaml: boolean;
      schema?: ServiceSchemaKind;
    }
  | {
      command: "bootstrap";
      packageName: string;
      outDir: string;
      runtimeMode: BootstrapRuntimeMode;
      force: boolean;
      bundleDeps: boolean;
    }
  | ClientGenerationCliCommand
  | {
      command: "help";
      help: string;
    };

type ClientGenerationCliCommand =
  | {
      command: "client-stub";
      transport: ClientPackageTransport;
      factoryName?: string;
    }
  | {
      command: "client-package";
      transport: ClientPackageTransport;
      packageName: string;
      outDir: string;
      factoryName?: string;
      force: boolean;
      bundleDeps: boolean;
      publish: boolean;
    };

interface ClientPackageCliOptions {
  transport?: string;
  name?: string;
  out?: string;
  factory?: string;
  force?: boolean;
  bundleDeps?: boolean;
  publish?: boolean;
}

interface BootstrapCliOptions {
  name?: string;
  out?: string;
  runtimeMode?: string;
  force?: boolean;
  bundleDeps?: boolean;
}

function createRuntimeCliProgram(commandName: string, onCommand: RuntimeCommandHandler): Command {
  const program = new Command();
  program
    .name(commandName)
    .description("Run an OctoBus JavaScript service package")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
    });

  program
    .command("serve")
    .description("Start a gRPC service instance for OctoBus")
    .option("--host <host>", "bind host")
    .option("--port <port>", "bind port")
    .option("--config <file>", "instance config JSON file")
    .option("--config-json <json>", "inline instance config JSON")
    .option("--secret <file>", "instance secret JSON file")
    .option("--secret-json <json>", "inline instance secret JSON")
    .option("--secret-fd <fd>", "instance secret JSON file descriptor")
    .option("--workdir <dir>", "instance working directory")
    .option("--service <id>", "service id")
    .option("--instance <id>", "instance id")
    .action((options: ServeOptions) => {
      requireOneOf(options.config, options.configJson, "serve requires --config or --config-json");
      rejectBoth(options.config, options.configJson, "--config and --config-json are mutually exclusive");
      rejectBoth(options.secret, options.secretJson, "--secret and --secret-json are mutually exclusive");
      rejectBoth(options.secret, options.secretFd, "--secret and --secret-fd are mutually exclusive");
      rejectBoth(options.secretJson, options.secretFd, "--secret-json and --secret-fd are mutually exclusive");
      onCommand({
        command: "serve",
        host: requiredString(options.host, "serve requires --host"),
        port: parsePort(requiredString(options.port, "serve requires --port")),
        config: options.config,
        configJson: options.configJson,
        secret: options.secret,
        secretJson: options.secretJson,
        secretFd: options.secretFd,
        workdir: options.workdir,
        service: options.service,
        instance: options.instance,
      });
    });

  program
    .command("invoke")
    .description("Invoke one unary handler with protobuf bytes on stdin/stdout")
    .option("--method <method>", "full method name, for example package.Service/Method")
    .option("--config <file>", "instance config JSON file")
    .option("--secret <file>", "instance secret JSON file")
    .option("--secret-fd <fd>", "instance secret JSON file descriptor")
    .option("--metadata <file>", "metadata JSON file")
    .option("--workdir <dir>", "instance working directory")
    .option("--service <id>", "service id")
    .option("--instance <id>", "instance id")
    .action((options: InvokeOptions) => {
      rejectBoth(options.secret, options.secretFd, "--secret and --secret-fd are mutually exclusive");
      onCommand({
        command: "invoke",
        method: requiredString(options.method, "invoke requires --method"),
        config: requiredString(options.config, "invoke requires --config"),
        secret: options.secret,
        secretFd: options.secretFd,
        metadata: requiredString(options.metadata, "invoke requires --metadata"),
        workdir: requiredString(options.workdir, "invoke requires --workdir"),
        service: options.service,
        instance: options.instance,
      });
    });

  program
    .command("inspect")
    .description("Print service package metadata")
    .option("--json", "print JSON output")
    .option("--yaml", "print YAML output")
    .option("--config-schema", "print the package config JSON Schema")
    .option("--secret-schema", "print the package secret JSON Schema")
    .action((options: InspectOptions) => {
      rejectBoth(options.json ? "true" : undefined, options.yaml ? "true" : undefined, "--json and --yaml are mutually exclusive");
      rejectBoth(options.configSchema ? "true" : undefined, options.secretSchema ? "true" : undefined, "--config-schema and --secret-schema are mutually exclusive");
      onCommand({
        command: "inspect",
        json: options.yaml !== true,
        yaml: options.yaml === true,
        schema: selectedSchemaKind(options),
      });
    });

  program
    .command("cli")
    .description("Invoke service methods as local CLI commands")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .argument("[args...]", "service CLI arguments")
    .action((args: string[]) => {
      onCommand({
        command: "cli",
        args,
      });
    });

  program
    .command("dev")
    .description("Start a local development gRPC server")
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--port <port>", "bind port", "50051")
    .option("--config <file>", "instance config JSON file")
    .option("--config-json <json>", "inline instance config JSON")
    .option("--secret <file>", "instance secret JSON file")
    .option("--secret-json <json>", "inline instance secret JSON")
    .option("--secret-fd <fd>", "instance secret JSON file descriptor")
    .option("--workdir <dir>", "instance working directory")
    .option("--service <id>", "service id")
    .option("--instance <id>", "instance id")
    .action((options: ServeOptions) => {
      rejectBoth(options.config, options.configJson, "--config and --config-json are mutually exclusive");
      rejectBoth(options.secret, options.secretJson, "--secret and --secret-json are mutually exclusive");
      rejectBoth(options.secret, options.secretFd, "--secret and --secret-fd are mutually exclusive");
      rejectBoth(options.secretJson, options.secretFd, "--secret-json and --secret-fd are mutually exclusive");
      onCommand({
        command: "dev",
        host: options.host ?? "127.0.0.1",
        port: parsePort(options.port ?? "50051"),
        config: options.config,
        configJson: options.configJson,
        secret: options.secret,
        secretJson: options.secretJson,
        secretFd: options.secretFd,
        workdir: options.workdir,
        service: options.service,
        instance: options.instance,
      });
    });

  addClientGenerationCommands(program, onCommand);

  return program;
}

function parseSdkCliArgs(argv: string[]): SdkCliCommand {
  let parsed: SdkCliCommand | undefined;
  const program = createSdkCliProgram((command) => {
    parsed = command;
  });
  const help = parseCommanderProgram(program, argv);
  if (help !== undefined) {
    return { command: "help", help };
  }
  if (!parsed) {
    throw new Error("expected subcommand: bootstrap, validate, inspect, client-stub, or client-package");
  }
  return parsed;
}

function createSdkCliProgram(onCommand: (command: Exclude<SdkCliCommand, { command: "help" }>) => void): Command {
  const program = new Command();
  program
    .name("octobus-sdk")
    .description("Inspect and validate OctoBus JavaScript service packages")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
    });

  program
    .command("bootstrap")
    .description("Initialize a JavaScript service package scaffold")
    .requiredOption("--name <name>", "service npm package name")
    .requiredOption("--out <directory>", "output directory")
    .option("--runtime-mode <mode>", "service runtime mode: on-demand or long-running", "on-demand")
    .option("--bundle-deps", "install production dependencies and mark them as bundled")
    .option("--force", "overwrite generated files when output directory is not empty")
    .action((options: BootstrapCliOptions) => {
      const runtimeMode = requiredString(options.runtimeMode, "bootstrap requires --runtime-mode");
      validateBootstrapRuntimeMode(runtimeMode);
      onCommand({
        command: "bootstrap",
        packageName: requiredString(options.name, "bootstrap requires --name"),
        outDir: requiredString(options.out, "bootstrap requires --out"),
        runtimeMode,
        force: options.force === true,
        bundleDeps: options.bundleDeps === true,
      });
    });

  program
    .command("validate")
    .description("Validate service.json, package.json bin, proto files, and handlers")
    .option("--strict", "fail when unary proto methods do not have handlers")
    .action((options: { strict?: boolean }) => {
      onCommand({
        command: "validate",
        strict: options.strict === true,
      });
    });

  program
    .command("inspect")
    .description("Print service package metadata")
    .option("--json", "print JSON output")
    .option("--yaml", "print YAML output")
    .option("--config-schema", "print the package config JSON Schema")
    .option("--secret-schema", "print the package secret JSON Schema")
    .action((options: InspectOptions) => {
      rejectBoth(options.json ? "true" : undefined, options.yaml ? "true" : undefined, "--json and --yaml are mutually exclusive");
      rejectBoth(options.configSchema ? "true" : undefined, options.secretSchema ? "true" : undefined, "--config-schema and --secret-schema are mutually exclusive");
      onCommand({
        command: "inspect",
        json: options.yaml !== true,
        yaml: options.yaml === true,
        schema: selectedSchemaKind(options),
      });
    });

  addClientGenerationCommands(program, onCommand);

  return program;
}

function addClientGenerationCommands(program: Command, onCommand: ClientGenerationCommandHandler): void {
  program
    .command("client-stub")
    .description("Print an ESM client stub for this service package")
    .requiredOption("--transport <transport>", "client transport: connect or grpc")
    .option("--factory <name>", "exported factory function name")
    .action((options: { transport?: string; factory?: string }) => {
      const transport = requiredString(options.transport, "client-stub requires --transport");
      validateClientStubTransport(transport);
      onCommand({
        command: "client-stub",
        transport,
        factoryName: options.factory,
      });
    });

  program
    .command("client-package")
    .description("Generate a descriptor-backed npm client package")
    .requiredOption("--transport <transport>", "client transport: connect or grpc")
    .requiredOption("--name <name>", "generated npm package name")
    .requiredOption("--out <directory>", "output directory")
    .option("--factory <name>", "exported factory function name")
    .option("--force", "overwrite generated files when output directory is not empty")
    .option("--bundle-deps", "install production dependencies and mark them as bundled")
    .option("--publish", "run npm publish in the generated package directory")
    .action((options: ClientPackageCliOptions) => {
      const transport = requiredString(options.transport, "client-package requires --transport");
      if (transport !== "connect" && transport !== "grpc") {
        throw new Error("client-package --transport must be connect or grpc");
      }
      onCommand({
        command: "client-package",
        transport,
        packageName: requiredString(options.name, "client-package requires --name"),
        outDir: requiredString(options.out, "client-package requires --out"),
        factoryName: options.factory,
        force: options.force === true,
        bundleDeps: options.bundleDeps === true,
        publish: options.publish === true,
      });
    });
}

function parseCommanderProgram(program: Command, argv: string[]): string | undefined {
  if (argv.length === 0) {
    return program.helpInformation();
  }

  let help = "";
  configureCommanderOutput(program, {
    writeOut: (value) => {
      help += value;
    },
    writeErr: () => undefined,
  });

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (
      error instanceof CommanderError
      && (error.code === "commander.helpDisplayed" || error.code === "commander.help")
    ) {
      return help || program.helpInformation();
    }
    if (error instanceof CommanderError) {
      throw new Error(error.message);
    }
    throw error;
  }

  return undefined;
}

function configureCommanderOutput(program: Command, output: OutputConfiguration): void {
  program.configureOutput(output);
  for (const command of program.commands) {
    configureCommanderOutput(command, output);
  }
}

function requireOneOf(left: string | undefined, right: string | undefined, message: string): void {
  if (!left && !right) {
    throw new Error(message);
  }
}

function rejectBoth(left: string | undefined, right: string | undefined, message: string): void {
  if (left && right) {
    throw new Error(message);
  }
}

function requiredString(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function selectedSchemaKind(options: InspectOptions): ServiceSchemaKind | undefined {
  if (options.configSchema === true) {
    return "config";
  }
  if (options.secretSchema === true) {
    return "secret";
  }
  return undefined;
}

function servicePackageRootOptions(options: RunServiceOptions): { cwd: string; env: NodeJS.ProcessEnv; fromFile?: string } {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fromFile: options.entryFile ?? process.argv[1],
  };
}

function sdkPackageRootOptions(options: RunServiceOptions): { cwd: string; env: NodeJS.ProcessEnv } {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  };
}

function runClientGenerationCommand(
  command: ClientGenerationCliCommand,
  options: RunServiceOptions,
): ClientStubResult | ClientPackageResult {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const packageRoot = servicePackageRootOptions(options);
  const code = executeClientGenerationCommand(command, {
    ...packageRoot,
    stdout,
    stderr,
    npmEnv: packageRoot.env,
  });
  if (code !== 0) {
    throw new SilentExitError();
  }
  if (command.command === "client-stub") {
    return {
      command: "client-stub",
      transport: command.transport,
    };
  }
  return {
    command: "client-package",
    transport: command.transport,
    outDir: path.resolve(packageRoot.cwd, command.outDir),
    bundled: command.bundleDeps,
    published: command.publish,
  };
}

function executeClientGenerationCommand(
  command: ClientGenerationCliCommand,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
    npmEnv?: NodeJS.ProcessEnv;
    fromFile?: string;
  },
): 0 | 1 {
  if (command.command === "client-stub") {
    options.stdout.write(generateClientStubSource({
      cwd: options.cwd,
      env: options.env,
      fromFile: options.fromFile,
      transport: command.transport,
      factoryName: command.factoryName,
    }));
    return 0;
  }

  const validation = validateService({
    cwd: options.cwd,
    env: options.env,
    fromFile: options.fromFile,
  });
  if (!validation.valid) {
    writeValidationResult(validation, options.stdout, options.stderr);
    return 1;
  }
  const written = writeClientPackage({
    cwd: options.cwd,
    env: options.env,
    fromFile: options.fromFile,
    transport: command.transport,
    packageName: command.packageName,
    outDir: path.resolve(options.cwd, command.outDir),
    factoryName: command.factoryName,
    force: command.force,
    bundleDeps: command.bundleDeps,
    publish: command.publish,
    npmEnv: options.npmEnv ?? options.env,
  });
  options.stdout.write(`generated ${command.transport} client package at ${written.outDir}\n`);
  if (written.bundled) {
    options.stdout.write("installed bundled production dependencies\n");
  }
  if (written.published) {
    options.stdout.write("published client package with npm publish\n");
  }
  return 0;
}

export async function runService(
  service: OctobusServiceDefinition,
  options: RunServiceOptions = {},
): Promise<RunServiceResult> {
  try {
    const argv = options.argv ?? process.argv.slice(2);
    const packageRoot = servicePackageRootOptions(options);
    const packageDir = findPackageRoot(packageRoot);
    const command = parseCliArgs(argv, inferPackageBinName(packageDir));

    if (command.command === "help") {
      (options.stdout ?? process.stdout).write(command.help);
      return {
        command: "help",
        help: command.help,
      };
    }

    if (command.command === "inspect") {
      const inspectOptions = {
        cwd: options.cwd,
        env: options.env,
        fromFile: options.entryFile ?? process.argv[1],
        stdout: options.stdout ?? process.stdout,
      };
      const manifest = command.schema
        ? command.yaml
          ? inspectSchemaYaml(command.schema, inspectOptions)
          : inspectSchemaJson(command.schema, inspectOptions)
        : command.yaml
          ? inspectYaml(inspectOptions)
          : inspectJson(inspectOptions);
      return {
        command: "inspect",
        manifest,
      };
    }

    if (command.command === "invoke") {
      await invokeService(service, command, options);
      return { command: "invoke" };
    }

    if (command.command === "cli") {
      const method = await runServiceCli(service, command.args, options);
      return { command: "cli", method };
    }

    if (command.command === "client-stub" || command.command === "client-package") {
      return runClientGenerationCommand(command, options);
    }

    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const workdir = path.resolve(command.workdir ?? cwd);
    let config = readJSONSource(command.config, command.configJson, workdir, {});
    let secret = readSecretSource(command.secret, command.secretJson, command.secretFd, workdir, {});
    if (command.command === "dev") {
      ({ config, secret } = applyServiceContextEnv({
        cwd,
        env,
        config,
        secret,
      }));
    }
    const loaded = loadServicePackage(packageDir, env);
    const server = new grpc.Server();

    registerServices(server, loaded.grpcServices, service, config, secret, {
      packageName: loaded.manifest.name,
      packageVersion: loaded.manifest.version,
      serviceId: command.service ?? env.OCTOBUS_SERVICE_ID,
      instanceId: command.instance ?? env.OCTOBUS_INSTANCE_ID,
      workdir,
      packageDir,
    });
    addHealthService(server);

    const port = await bindServer(server, command.host, command.port);
    if (command.command === "dev") {
      (options.stdout ?? process.stdout).write(`${command.host}:${port}\n`);
    }

    return {
      command: "serve",
      server,
      address: `${command.host}:${port}`,
      port,
    };
  } catch (error) {
    if (error instanceof CliInputError) {
      writeServiceCliError(options.stderr, error.code, error.message);
      throw new SilentExitError();
    }
    throw error;
  }
}

async function invokeService(
  service: OctobusServiceDefinition,
  command: Extract<CliCommand, { command: "invoke" }>,
  options: RunServiceOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  const workdir = path.resolve(command.workdir);
  const packageSearchCwd = path.resolve(options.cwd ?? process.cwd());
  const config = readJSONSource(command.config, undefined, workdir);
  const secret = readSecretSource(command.secret, undefined, command.secretFd, workdir, {});
  const metadata = readMetadata(command.metadata, workdir);
  const packageDir = findPackageRoot({ cwd: packageSearchCwd, env });
  const loaded = loadServicePackage(packageDir, env);
  const method = findUnaryMethodDefinition(loaded.grpcServices, command.method);
  if (!method) {
    writeOctobusError(options.stderr, UNIMPLEMENTED, formatUnimplementedMessage(command.method, {
      packageName: loaded.manifest.name,
      packageVersion: loaded.manifest.version,
    }));
    throw new SilentExitError();
  }
  const handler = findHandler(service.handlers, command.method);
  if (!handler) {
    writeOctobusError(options.stderr, UNIMPLEMENTED, formatUnimplementedMessage(command.method, {
      packageName: loaded.manifest.name,
      packageVersion: loaded.manifest.version,
    }));
    throw new SilentExitError();
  }

  const stdin = options.stdin ?? process.stdin;
  const requestBytes = await readAll(stdin);
  let request: unknown;
  try {
    request = method.requestDeserialize(requestBytes);
  } catch (error) {
    writeOctobusError(options.stderr, INTERNAL, error instanceof Error ? error.message : "request decode failed");
    throw new SilentExitError();
  }

  try {
    const response = await handler({
      request,
      metadata,
      config,
      secret,
      method: command.method,
      serviceId: command.service ?? env.OCTOBUS_SERVICE_ID ?? "",
      instanceId: command.instance ?? env.OCTOBUS_INSTANCE_ID ?? "",
      workdir,
      packageDir,
      getMetadata: (name) => firstMetadata(metadata, name),
      getMetadataAll: (name) => metadata.get(name).map(String),
    });
    const responseBytes = method.responseSerialize(response);
    writeBytes(options.stdout ?? process.stdout, responseBytes);
  } catch (error) {
    if (error instanceof GrpcError) {
      writeOctobusError(options.stderr, error.code, error.message);
      throw new SilentExitError();
    }
    const message = error instanceof Error ? error.message : "internal server error";
    writeOctobusError(options.stderr, INTERNAL, message);
    throw new SilentExitError();
  }
}

async function runServiceCli(
  service: OctobusServiceDefinition,
  args: string[],
  options: RunServiceOptions,
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const workdir = path.resolve(options.cwd ?? process.cwd());
  const packageSearchCwd = path.resolve(options.cwd ?? process.cwd());
  const packageDir = findPackageRoot({
    cwd: packageSearchCwd,
    env,
    fromFile: options.entryFile ?? process.argv[1],
  });
  const loaded = loadServicePackage(packageDir, env);
  const commands = buildServiceCliCommands(loaded.grpcServices, loaded.manifest.sdk?.cli?.commands, service.handlers);
  const stdout = options.stdout ?? process.stdout;

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    stdout.write(renderServiceCliHelp(loaded.manifest.name, commands));
    return undefined;
  }

  const commandName = args[0];
  const cliMethod = commands.find((item) => item.command === commandName);
  if (!cliMethod) {
    throw new Error(`unknown service CLI command: ${commandName}`);
  }
  const parsed = parseServiceCliMethodArgs(args.slice(1));
  if (parsed.help) {
    stdout.write(`${JSON.stringify(serviceCliMethodContract(cliMethod), null, 2)}\n`);
    return cliMethod.method;
  }

  const cliConfig = readJSONSource(parsed.config, parsed.configJson, workdir, {});
  const cliSecret = readJSONSource(parsed.secret, parsed.secretJson, workdir, {});
  const { config, secret } = applyServiceContextEnv({
    cwd: workdir,
    env,
    config: cliConfig,
    secret: cliSecret,
  });
  const metadata = parsed.metadata ? readMetadata(parsed.metadata, workdir) : new grpc.Metadata();
  const request = await readCliRequest(parsed.data, parsed.dataJson, workdir, options.stdin ?? process.stdin);
  const decodedRequest = decodeCliRequest(request, cliMethod.definition.requestType);
  const handler = findHandler(service.handlers, cliMethod.method);
  if (!handler) {
    throw new Error(formatUnimplementedMessage(cliMethod.method, {
      packageName: loaded.manifest.name,
      packageVersion: loaded.manifest.version,
    }));
  }
  try {
    const response = await handler({
      request: decodedRequest,
      metadata,
      config,
      secret,
      method: cliMethod.method,
      serviceId: "",
      instanceId: "",
      workdir,
      packageDir,
      getMetadata: (name) => firstMetadata(metadata, name),
      getMetadataAll: (name) => metadata.get(name).map(String),
    });
    const responseBytes = cliMethod.definition.responseSerialize(response);
    const decodedResponse = cliMethod.definition.responseDeserialize(responseBytes);
    stdout.write(`${JSON.stringify(protobufMessageToProtoJson(decodedResponse, cliMethod.definition.responseType), null, 2)}\n`);
    return cliMethod.method;
  } catch (error) {
    if (error instanceof GrpcError) {
      writeServiceCliError(options.stderr, error.code, error.message);
      throw new SilentExitError();
    }
    const message = error instanceof Error ? error.message : "internal server error";
    writeServiceCliError(options.stderr, INTERNAL, message);
    throw new SilentExitError();
  }
}

interface ServiceCliMethodCommand {
  command: string;
  method: string;
  description?: string;
  definition: UnaryMethodDefinition;
  requestTitle: string;
  responseTitle: string;
  examples?: ServiceCliExample[];
}

interface ServiceCliExample {
  argv: string[];
  description?: string;
}

interface ParsedServiceCliMethodArgs {
  help: boolean;
  data?: string;
  dataJson?: string;
  config?: string;
  configJson?: string;
  secret?: string;
  secretJson?: string;
  metadata?: string;
}

function buildServiceCliCommands(
  grpcServices: GrpcServiceDefinition[],
  metadata: Record<string, { name?: string; description?: string; examples?: unknown }> | undefined,
  handlers: OctobusServiceDefinition["handlers"],
): ServiceCliMethodCommand[] {
  const commands: ServiceCliMethodCommand[] = [];
  const byName = new Map<string, string>();

  for (const discovered of discoverGrpcServices(grpcServices)) {
    for (const [methodName, methodDefinition] of Object.entries(discovered.definition)) {
      if (methodDefinition.requestStream || methodDefinition.responseStream) {
        continue;
      }
      const fullMethod = `${discovered.name}/${methodName}`;
      if (!findHandler(handlers, fullMethod)) {
        continue;
      }
      const commandMetadata = metadata?.[fullMethod] ?? metadata?.[`/${fullMethod}`];
      const command = commandMetadata?.name?.trim() || kebabCase(methodName);
      const existing = byName.get(command);
      if (existing) {
        throw new Error(`service CLI command ${command} maps to both ${existing} and ${fullMethod}`);
      }
      byName.set(command, fullMethod);
      const definition = methodDefinition as unknown as UnaryMethodDefinition;
      commands.push({
        command,
        method: fullMethod,
        description: commandMetadata?.description,
        definition,
        requestTitle: definition.requestType.typeName,
        responseTitle: definition.responseType.typeName,
        examples: validServiceCliExamples(commandMetadata?.examples),
      });
    }
  }

  return commands.sort((left, right) => left.command.localeCompare(right.command));
}

function parseServiceCliMethodArgs(args: string[]): ParsedServiceCliMethodArgs {
  const parsed: ParsedServiceCliMethodArgs = { help: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    switch (arg) {
      case "--data":
        parsed.data = requiredArgValue(args, ++i, "--data");
        break;
      case "--data-json":
        parsed.dataJson = requiredArgValue(args, ++i, "--data-json");
        break;
      case "--config":
        parsed.config = requiredArgValue(args, ++i, "--config");
        break;
      case "--config-json":
        parsed.configJson = requiredArgValue(args, ++i, "--config-json");
        break;
      case "--secret":
        parsed.secret = requiredArgValue(args, ++i, "--secret");
        break;
      case "--secret-json":
        parsed.secretJson = requiredArgValue(args, ++i, "--secret-json");
        break;
      case "--metadata":
        parsed.metadata = requiredArgValue(args, ++i, "--metadata");
        break;
      default:
        throw new Error(`unknown service CLI option: ${arg}`);
    }
  }
  rejectBoth(parsed.data, parsed.dataJson, "--data and --data-json are mutually exclusive");
  rejectBoth(parsed.config, parsed.configJson, "--config and --config-json are mutually exclusive");
  rejectBoth(parsed.secret, parsed.secretJson, "--secret and --secret-json are mutually exclusive");
  return parsed;
}

function requiredArgValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readCliRequest(
  filePath: string | undefined,
  jsonValue: string | undefined,
  workdir: string,
  stdin: NodeJS.ReadableStream,
): Promise<unknown> {
  if (jsonValue !== undefined) {
    return parseCliJson(jsonValue, "--data-json");
  }
  if (filePath === "-") {
    const raw = await readAll(stdin);
    return parseCliJson(raw.toString("utf8"), "--data");
  }
  return readJSONSource(filePath, undefined, workdir, {});
}

function renderServiceCliHelp(packageName: string, commands: ServiceCliMethodCommand[]): string {
  const lines = [
    `Usage: ${packageName} cli <command> [options]`,
    "",
    "Commands:",
  ];
  if (commands.length === 0) {
    lines.push("  No implemented unary methods.");
  } else {
    const width = Math.max(...commands.map((command) => command.command.length));
    for (const command of commands) {
      const suffix = command.description ? `  ${command.description}` : `  ${command.method}`;
      lines.push(`  ${command.command.padEnd(width)}${suffix}`);
    }
  }
  lines.push(
    "",
    "Options:",
    "  --data <file>          request JSON file, or - for stdin",
    "  --data-json <json>     inline request JSON",
    "  --config <file>        config JSON file",
    "  --config-json <json>   inline config JSON",
    "  --secret <file>        secret JSON file",
    "  --secret-json <json>   inline secret JSON",
    "  --metadata <file>      metadata JSON file",
    "",
    "Environment:",
    `  ${SERVICE_CONTEXT_ENV}  JSON object with optional config and secret fields.`,
    "                           Also read from .env in the current directory.",
    `                           Example: {"config":{},"secret":{}}`,
    "                           Matching fields override --config* and --secret*.",
    "",
    "Use '<command> --help' to print that method's JSON contract.",
  );
  return `${lines.join("\n")}\n`;
}

function serviceCliMethodContract(command: ServiceCliMethodCommand): Record<string, unknown> {
  return {
    command: command.command,
    method: command.method,
    description: command.description ?? "",
    input: messageJsonSchema(command.definition.requestType, command.requestTitle),
    output: messageJsonSchema(command.definition.responseType, command.responseTitle),
    examples: command.examples && command.examples.length > 0
      ? command.examples
      : [{ argv: [command.command, "--data-json", "{}"] }],
    environment: serviceContextEnvironmentContract(),
  };
}

function serviceContextEnvironmentContract(): Record<string, unknown> {
  return {
    [SERVICE_CONTEXT_ENV]: {
      description: SERVICE_CONTEXT_ENV_DESCRIPTION,
      shape: {
        config: {},
        secret: {},
      },
      precedence: "environment value overrides matching --config* and --secret* CLI options",
    },
  };
}

function validServiceCliExamples(value: unknown): ServiceCliExample[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const examples = value.filter((item): item is ServiceCliExample => {
    if (!item || typeof item !== "object" || !Array.isArray((item as { argv?: unknown }).argv)) {
      return false;
    }
    return (item as { argv: unknown[] }).argv.every((arg) => typeof arg === "string");
  }).map((item) => {
    const example: ServiceCliExample = { argv: [...item.argv] };
    if (typeof item.description === "string") {
      example.description = item.description;
    }
    return example;
  });
  return examples.length > 0 ? examples : undefined;
}

function parseCliJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError(INVALID_ARGUMENT, `${source} is not valid JSON: ${message}`);
  }
}

function decodeCliRequest(value: unknown, message: DescMessage): unknown {
  try {
    // Aliased like a request decoded from the wire, so a handler reached through
    // the CLI sees the same field names as one reached through the daemon. See
    // decodeRequestJson.
    return decodeRequestJson(value, message);
  } catch (error) {
    throw new CliInputError(INVALID_ARGUMENT, error instanceof Error ? error.message : String(error));
  }
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s.]+/g, "-")
    .toLowerCase();
}

export function registerServices(
  server: grpc.Server,
  grpcServices: GrpcServiceDefinition[],
  service: OctobusServiceDefinition,
  config: unknown,
  secret: unknown = {},
  metadata: ServiceMetadata = {},
): void {
  for (const discovered of discoverGrpcServices(grpcServices)) {
    const implementation: grpc.UntypedServiceImplementation = {};

    for (const [methodName, methodDefinition] of Object.entries(discovered.definition)) {
      const method = `${discovered.name}/${methodName}`;
      const implementationName = methodDefinition.originalName || methodName;
      if (methodDefinition.requestStream && methodDefinition.responseStream) {
        implementation[implementationName] = createBidiStreamingHandler(service, config, secret, method, metadata);
      } else if (methodDefinition.requestStream) {
        implementation[implementationName] = createClientStreamingHandler(service, config, secret, method, metadata);
      } else if (methodDefinition.responseStream) {
        implementation[implementationName] = createServerStreamingHandler(service, config, secret, method, metadata);
      } else {
        implementation[implementationName] = createUnaryHandler(service, config, secret, method, metadata);
      }
    }

    server.addService(discovered.definition, implementation);
  }
}

interface ServiceMetadata {
  packageName?: string;
  packageVersion?: string;
  serviceId?: string;
  instanceId?: string;
  workdir?: string;
  packageDir?: string;
}

interface DiscoveredGrpcService {
  name: string;
  definition: grpc.ServiceDefinition<grpc.UntypedServiceImplementation>;
}

function discoverGrpcServices(services: GrpcServiceDefinition[]): DiscoveredGrpcService[] {
  return services.map((service) => ({
    name: service.descriptor.typeName,
    definition: service.definition,
  }));
}

function createUnaryHandler(
  service: OctobusServiceDefinition,
  config: unknown,
  secret: unknown,
  method: string,
  metadata: ServiceMetadata,
): grpc.UntypedHandleCall {
  return async (call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
    const handler = findHandler(service.handlers, method);

    if (!handler) {
      callback(toServiceError(UNIMPLEMENTED, formatUnimplementedMessage(method, metadata)), null);
      return;
    }

    try {
      const cleanMetadata = stripOctobusMetadata(call.metadata);
      const response = await handler({
        request: call.request,
        metadata: cleanMetadata,
        config,
        secret,
        method,
        serviceId: metadata.serviceId ?? "",
        instanceId: metadata.instanceId ?? "",
        workdir: metadata.workdir ?? process.cwd(),
        packageDir: metadata.packageDir ?? process.cwd(),
        getMetadata: (name) => firstMetadata(cleanMetadata, name),
        getMetadataAll: (name) => cleanMetadata.get(name).map(String),
      });
      callback(null, response);
    } catch (error) {
      if (error instanceof GrpcError) {
        callback(toServiceError(error.code, error.message), null);
        return;
      }

      const message = error instanceof Error ? error.message : "internal server error";
      callback(toServiceError(INTERNAL, message), null);
    }
  };
}

function createServerStreamingHandler(
  service: OctobusServiceDefinition,
  config: unknown,
  secret: unknown,
  method: string,
  metadata: ServiceMetadata,
): grpc.UntypedHandleCall {
  return async (call: grpc.ServerWritableStream<unknown, unknown>) => {
    const handler = findHandler(service.handlers, method);
    if (!handler) {
      call.destroy(toServiceError(UNIMPLEMENTED, formatUnimplementedMessage(method, metadata)));
      return;
    }
    const cleanMetadata = stripOctobusMetadata(call.metadata);
    try {
      const responses = await handler({
        request: call.request,
        metadata: cleanMetadata,
        config,
        secret,
        method,
        serviceId: metadata.serviceId ?? "",
        instanceId: metadata.instanceId ?? "",
        workdir: metadata.workdir ?? process.cwd(),
        packageDir: metadata.packageDir ?? process.cwd(),
        getMetadata: (name) => firstMetadata(cleanMetadata, name),
        getMetadataAll: (name) => cleanMetadata.get(name).map(String),
      });
      await writeIterableResponses(call, responses);
      endStream(call);
    } catch (error) {
      call.destroy(errorToServiceError(error));
    }
  };
}

function createClientStreamingHandler(
  service: OctobusServiceDefinition,
  config: unknown,
  secret: unknown,
  method: string,
  metadata: ServiceMetadata,
): grpc.UntypedHandleCall {
  return async (call: grpc.ServerReadableStream<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
    const handler = findHandler(service.handlers, method);
    if (!handler) {
      callback(toServiceError(UNIMPLEMENTED, formatUnimplementedMessage(method, metadata)), null);
      return;
    }
    const cleanMetadata = stripOctobusMetadata(call.metadata);
    try {
      const response = await handler({
        requests: readableToAsyncIterable(call),
        metadata: cleanMetadata,
        config,
        secret,
        method,
        serviceId: metadata.serviceId ?? "",
        instanceId: metadata.instanceId ?? "",
        workdir: metadata.workdir ?? process.cwd(),
        packageDir: metadata.packageDir ?? process.cwd(),
        getMetadata: (name) => firstMetadata(cleanMetadata, name),
        getMetadataAll: (name) => cleanMetadata.get(name).map(String),
      });
      callback(null, response);
    } catch (error) {
      callback(errorToServiceError(error), null);
    }
  };
}

function createBidiStreamingHandler(
  service: OctobusServiceDefinition,
  config: unknown,
  secret: unknown,
  method: string,
  metadata: ServiceMetadata,
): grpc.UntypedHandleCall {
  return async (call: grpc.ServerDuplexStream<unknown, unknown>) => {
    const handler = findHandler(service.handlers, method);
    if (!handler) {
      call.destroy(toServiceError(UNIMPLEMENTED, formatUnimplementedMessage(method, metadata)));
      return;
    }
    const cleanMetadata = stripOctobusMetadata(call.metadata);
    try {
      const responses = await handler({
        requests: readableToAsyncIterable(call),
        metadata: cleanMetadata,
        config,
        secret,
        method,
        serviceId: metadata.serviceId ?? "",
        instanceId: metadata.instanceId ?? "",
        workdir: metadata.workdir ?? process.cwd(),
        packageDir: metadata.packageDir ?? process.cwd(),
        getMetadata: (name) => firstMetadata(cleanMetadata, name),
        getMetadataAll: (name) => cleanMetadata.get(name).map(String),
      });
      await writeIterableResponses(call, responses);
      endStream(call);
    } catch (error) {
      call.destroy(errorToServiceError(error));
    }
  };
}

async function writeIterableResponses(call: grpc.ServerWritableStream<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>, responses: unknown): Promise<void> {
  if (!isIterable(responses) && !isAsyncIterable(responses)) {
    throw new Error("streaming handler must return an iterable response");
  }
  for await (const response of responses as AsyncIterable<unknown> | Iterable<unknown>) {
    await writeStreamMessage(call, response);
  }
}

function writeStreamMessage(call: grpc.ServerWritableStream<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>, response: unknown): Promise<void> {
  call.write(response);
  return Promise.resolve();
}

function endStream(call: grpc.ServerWritableStream<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>): void {
  call.end();
}

async function* readableToAsyncIterable<T>(call: NodeJS.ReadableStream): AsyncIterable<T> {
  const queue: T[] = [];
  let done = false;
  let error: Error | undefined;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };
  const finish = () => {
    done = true;
    wake();
  };
  const onData = (item: T) => {
    queue.push(item);
    wake();
  };
  const onError = (streamError: Error) => {
    error = streamError;
    finish();
  };
  call.on("data", onData);
  call.on("end", finish);
  call.on("close", finish);
  call.on("error", onError);
  call.resume?.();

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as T;
        continue;
      }
      if (error) {
        throw error;
      }
      if (done) {
        return;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    call.off("data", onData);
    call.off("end", finish);
    call.off("close", finish);
    call.off("error", onError);
  }
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function errorToServiceError(error: unknown): grpc.ServiceError {
  if (error instanceof GrpcError) {
    return toServiceError(error.code, error.message);
  }
  const message = error instanceof Error ? error.message : "internal server error";
  return toServiceError(INTERNAL, message);
}

function readJSONSource(filePath: string | undefined, jsonValue: string | undefined, workdir: string, fallback?: unknown): unknown {
  if (jsonValue !== undefined) {
    return parseJsonSource(jsonValue, "inline JSON");
  }
  if (!filePath) {
    return fallback;
  }
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workdir, filePath);
  return parseJsonSource(fs.readFileSync(resolved, "utf8"), filePath);
}

function readSecretSource(
  filePath: string | undefined,
  jsonValue: string | undefined,
  fdValue: string | undefined,
  workdir: string,
  fallback?: unknown,
): unknown {
  if (fdValue !== undefined) {
    if (filePath !== undefined || jsonValue !== undefined) {
      throw new CliInputError(INVALID_ARGUMENT, "--secret-fd is mutually exclusive with --secret and --secret-json");
    }
    const fd = Number(fdValue);
    if (!Number.isInteger(fd) || fd < 0) {
      throw new CliInputError(INVALID_ARGUMENT, "--secret-fd must be a non-negative integer");
    }
    try {
      const raw = fs.readFileSync(fd, "utf8");
      fs.closeSync(fd);
      return parseJsonSource(raw, `fd ${fd}`);
    } catch (error) {
      if (error instanceof CliInputError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CliInputError(INVALID_ARGUMENT, `fd ${fd} could not be read: ${message}`);
    }
  }
  return readJSONSource(filePath, jsonValue, workdir, fallback);
}

interface ServiceContextEnvValue {
  hasConfig: boolean;
  config?: unknown;
  hasSecret: boolean;
  secret?: unknown;
}

function applyServiceContextEnv(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  config: unknown;
  secret: unknown;
}): { config: unknown; secret: unknown } {
  const context = loadServiceContextEnv(options.cwd, options.env);
  return {
    config: context.hasConfig ? context.config : options.config,
    secret: context.hasSecret ? context.secret : options.secret,
  };
}

function loadServiceContextEnv(cwd: string, env: NodeJS.ProcessEnv): ServiceContextEnvValue {
  const envRaw = env[SERVICE_CONTEXT_ENV];
  const raw = envRaw !== undefined && envRaw.trim() !== ""
    ? envRaw
    : readServiceContextEnvFile(cwd);
  if (raw === undefined || raw.trim() === "") {
    return { hasConfig: false, hasSecret: false };
  }
  return parseServiceContextEnv(raw);
}

function readServiceContextEnvFile(cwd: string): string | undefined {
  const dotEnvPath = path.join(cwd, ".env");
  let dotEnvStat: fs.Stats;
  try {
    dotEnvStat = fs.statSync(dotEnvPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError(INVALID_ARGUMENT, `.env could not be read: ${message}`);
  }
  if (dotEnvStat.isDirectory()) {
    return undefined;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(dotEnvPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError(INVALID_ARGUMENT, `.env could not be read: ${message}`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    if (equals < 0) {
      continue;
    }
    const key = trimmed.slice(0, equals).trim();
    if (key !== SERVICE_CONTEXT_ENV) {
      continue;
    }
    let value = trimmed.slice(equals + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\"")))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function parseServiceContextEnv(raw: string): ServiceContextEnvValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError(INVALID_ARGUMENT, `${SERVICE_CONTEXT_ENV} is not valid JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliInputError(INVALID_ARGUMENT, `${SERVICE_CONTEXT_ENV} must be a JSON object`);
  }
  const object = parsed as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (key !== "config" && key !== "secret") {
      throw new CliInputError(INVALID_ARGUMENT, `${SERVICE_CONTEXT_ENV} contains unsupported field ${JSON.stringify(key)}`);
    }
  }
  return {
    hasConfig: Object.prototype.hasOwnProperty.call(object, "config"),
    config: object.config,
    hasSecret: Object.prototype.hasOwnProperty.call(object, "secret"),
    secret: object.secret,
  };
}

function parseJsonSource(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliInputError(INVALID_ARGUMENT, `${source} is not valid JSON: ${message}`);
  }
}

function readMetadata(filePath: string, workdir: string): grpc.Metadata {
  const raw = readJSONSource(filePath, undefined, workdir, {});
  const metadata = new grpc.Metadata();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return metadata;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        metadata.add(key, String(item));
      }
      continue;
    }
    metadata.add(key, String(value));
  }
  return stripOctobusMetadata(metadata);
}

export async function runServiceMain(
  service: OctobusServiceDefinition,
  options: RunServiceMainOptions = {},
): Promise<RunServiceResult> {
  try {
    return await runService(service, options);
  } catch (error) {
    if (error instanceof SilentExitError) {
      (options.exit ?? process.exit)(1);
    }
    (options.stderr ?? process.stderr).write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    (options.exit ?? process.exit)(1);
    throw error;
  }
}

export async function runSdkCli(options: RunServiceOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const { cwd, env } = sdkPackageRootOptions(options);

  try {
    const result = parseSdkCliArgs(argv);
    if (result.command === "help") {
      stdout.write(result.help);
      return 0;
    }
    if (result.command === "validate") {
      const validation = validateService({ cwd, env, strictHandlers: result.strict });
      writeValidationResult(validation, stdout, stderr);
      return validation.valid ? 0 : 1;
    }
    if (result.command === "bootstrap") {
      const written = writeBootstrapPackage({
        packageName: result.packageName,
        outDir: path.resolve(cwd, result.outDir),
        runtimeMode: result.runtimeMode,
        force: result.force,
        bundleDeps: result.bundleDeps,
        npmEnv: env,
      });
      stdout.write(`generated service package at ${written.outDir}\n`);
      if (written.bundled) {
        stdout.write("installed bundled production dependencies\n");
      }
      return 0;
    }
    if (result.command === "client-stub") {
      return executeClientGenerationCommand(result, { cwd, env, stdout, stderr, npmEnv: env });
    }
    if (result.command === "client-package") {
      return executeClientGenerationCommand(result, { cwd, env, stdout, stderr, npmEnv: env });
    }
    if (result.schema) {
      if (result.yaml) {
        inspectSchemaYaml(result.schema, { cwd, env, stdout });
        return 0;
      }
      inspectSchemaJson(result.schema, { cwd, env, stdout });
      return 0;
    }
    if (result.yaml) {
      inspectYaml({ cwd, env, stdout });
      return 0;
    }
    inspectJson({ cwd, env, stdout });
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

type RuntimeServiceHandler = (context: HandlerContext) => unknown;

function findHandler(handlers: OctobusServiceDefinition["handlers"], method: string): RuntimeServiceHandler | undefined {
  return (handlers[method] ?? handlers[`/${method}`]) as RuntimeServiceHandler | undefined;
}

function formatUnimplementedMessage(method: string, metadata: ServiceMetadata): string {
  if (metadata.packageName) {
    const packageIdentity = metadata.packageVersion
      ? `${metadata.packageName}@${metadata.packageVersion}`
      : metadata.packageName;
    return `method ${method} is not implemented by package ${packageIdentity}`;
  }
  return `method ${method} is not implemented`;
}

function stripOctobusMetadata(metadata: grpc.Metadata): grpc.Metadata {
  const stripped = new grpc.Metadata();
  for (const key of Object.keys(metadata.getMap())) {
    if (!isOctobusControlMetadata(key)) {
      for (const value of metadata.get(key)) {
        stripped.add(key, value);
      }
    }
  }
  return stripped;
}

function isOctobusControlMetadata(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith("x-octobus-") && !normalized.startsWith("x-octobus-ext-");
}

interface UnaryMethodDefinition {
  requestDeserialize(data: Buffer): unknown;
  requestSerialize(value: unknown): Buffer;
  responseSerialize(value: unknown): Buffer;
  responseDeserialize(data: Buffer): unknown;
  requestType: DescMessage;
  responseType: DescMessage;
}

function findUnaryMethodDefinition(grpcServices: GrpcServiceDefinition[], method: string): UnaryMethodDefinition | undefined {
  const normalized = method.replace(/^\//, "");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return undefined;
  }
  const serviceName = normalized.slice(0, slash);
  const methodName = normalized.slice(slash + 1);
  for (const discovered of discoverGrpcServices(grpcServices)) {
    if (discovered.name !== serviceName) {
      continue;
    }
    const definition = discovered.definition[methodName];
    if (!definition || definition.requestStream || definition.responseStream) {
      return undefined;
    }
    return definition as unknown as UnaryMethodDefinition;
  }
  return undefined;
}

async function readAll(input: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of input as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function writeBytes(output: Pick<NodeJS.WriteStream, "write">, data: Buffer): void {
  output.write(data);
}

function writeOctobusError(output: Pick<NodeJS.WriteStream, "write"> | undefined, code: number, message: string): void {
  const err = { code: grpcStatusName(code), message };
  (output ?? process.stderr).write(`OCTOBUS_ERROR:${JSON.stringify(err)}\n`);
}

function writeServiceCliError(output: Pick<NodeJS.WriteStream, "write"> | undefined, code: number, message: string): void {
  (output ?? process.stderr).write(`${grpcStatusName(code)}: ${message}\n`);
}

function firstMetadata(metadata: grpc.Metadata, name: string): string | undefined {
  const [value] = metadata.get(name);
  return value === undefined ? undefined : String(value);
}

function grpcStatusName(code: number): string {
  const name = grpc.status[code];
  if (typeof name === "string") {
    return name;
  }
  return "INTERNAL";
}

class SilentExitError extends Error {
  public constructor() {
    super("");
    this.name = "SilentExitError";
  }

  public [inspect.custom](): string {
    return "";
  }
}

class CliInputError extends Error {
  public constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "CliInputError";
  }
}

function toServiceError(code: number, message: string): grpc.ServiceError {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  return error;
}

function bindServer(server: grpc.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(boundPort);
    });
  });
}

function writeValidationResult(
  result: ReturnType<typeof validateService>,
  stdout: Pick<NodeJS.WriteStream, "write">,
  stderr: Pick<NodeJS.WriteStream, "write">,
): void {
  const output = result.valid ? stdout : stderr;
  output.write(result.valid ? "service package is valid\n" : "service package validation failed\n");
  if (result.packageDir) {
    output.write(`package: ${result.packageDir}\n`);
  }
  if (result.entry) {
    output.write(`entry: ${result.entry}\n`);
  }
  if (result.unaryMethods.length > 0) {
    output.write(`unary methods: ${result.unaryMethods.length}\n`);
  }
  if (result.streamingMethods.length > 0) {
    output.write(`streaming methods: ${result.streamingMethods.length}\n`);
  }
  if (result.issues.length > 0) {
    output.write(`${formatValidationIssues(result.issues)}\n`);
  }
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${raw}`);
  }
  return port;
}

export function sameExecutablePath(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

const isDirectRun = process.argv[1] !== undefined && sameExecutablePath(fileURLToPath(import.meta.url), process.argv[1]);
if (isDirectRun) {
  runSdkCli().then((code) => {
    process.exitCode = code;
  });
}
