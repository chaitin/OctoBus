import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findPackageRoot, inferPackageBin, inferPackageBinName, loadServiceDescriptor, loadServicePackage, readServiceManifest, validatePackageFile } from "../src/proto-loader.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("proto-loader", () => {
  it("finds package root from OCTOBUS_PACKAGE_DIR", () => {
    expect(findPackageRoot({ cwd: "/", env: { OCTOBUS_PACKAGE_DIR: fixturesDir } })).toBe(fixturesDir);
  });

  it("reads service.json", () => {
    const manifest = readServiceManifest(fixturesDir);

    expect(manifest).toMatchObject({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      version: "0.1.0",
      proto: {
        roots: ["proto"],
        files: ["calculator.proto"],
      },
    });
  });

  it("loads proto services", () => {
    const loaded = loadServicePackage(fixturesDir);
    const calculator = loaded.grpcServices.find((service) => service.descriptor.typeName === "calculator.v1.CalculatorService");

    expect(loaded.entry).toBe("calculator-handler.js");
    expect(calculator?.definition.Add.path).toBe("/calculator.v1.CalculatorService/Add");
    expect(calculator?.definition.Subtract.path).toBe("/calculator.v1.CalculatorService/Subtract");
    expect(loaded.registry.getMessage("calculator.v1.ContractResponse")?.typeName).toBe("calculator.v1.ContractResponse");
  });

  it("loads protobuf-es descriptors with methods, json names, and well-known dependencies", () => {
    const loaded = loadServicePackage(fixturesDir);
    const calculator = loaded.services.find((service) => service.typeName === "calculator.v1.CalculatorService");
    if (!calculator) {
      throw new Error("missing calculator service descriptor");
    }

    expect(loaded.descriptorSet.file.map((file) => file.name)).toEqual(expect.arrayContaining([
      "calculator.proto",
      "google/protobuf/timestamp.proto",
      "google/protobuf/wrappers.proto",
    ]));
    expect(calculator.methods.map((method) => `${method.name}:${method.methodKind}`)).toEqual([
      "Add:unary",
      "Subtract:unary",
      "EchoContract:unary",
      "JsonShape:unary",
      "Sum:client_streaming",
      "Watch:server_streaming",
      "Chat:bidi_streaming",
    ]);

    const shape = loaded.registry.getMessage("calculator.v1.JsonShapeResponse");
    if (!shape) {
      throw new Error("missing JsonShapeResponse descriptor");
    }
    expect(shape.field.createdAt.message?.typeName).toBe("google.protobuf.Timestamp");
    expect(shape.field.total.message?.typeName).toBe("google.protobuf.Int64Value");
    expect(shape.field.raw.scalar).toBe(12);
    expect(shape.field.status.enum?.typeName).toBe("calculator.v1.JsonShapeStatus");
    expect(shape.field.status.enum?.values.map((value) => value.name)).toEqual([
      "JSON_SHAPE_STATUS_UNSPECIFIED",
      "JSON_SHAPE_STATUS_READY",
    ]);
    expect(shape.field.childMap.fieldKind).toBe("map");
    expect(shape.field.childMap.jsonName).toBe("childMapAlias");
    expect(shape.field.customField.jsonName).toBe("customAlias");
  });

  it("serializes and deserializes binary messages with generated gRPC method definitions", () => {
    const loaded = loadServicePackage(fixturesDir);
    const calculator = loaded.grpcServices.find((service) => service.descriptor.typeName === "calculator.v1.CalculatorService");
    const add = calculator?.definition.Add;
    if (!add) {
      throw new Error("missing Add method definition");
    }

    const requestBytes = add.requestSerialize({ left: 10, right: 4 });
    expect(Buffer.isBuffer(requestBytes)).toBe(true);
    expect(add.requestDeserialize(requestBytes)).toMatchObject({
      $typeName: "calculator.v1.BinaryOperationRequest",
      left: 10,
      right: 4,
    });

    const responseBytes = add.responseSerialize({ result: 14 });
    expect(add.responseDeserialize(responseBytes)).toMatchObject({
      $typeName: "calculator.v1.CalculatorResponse",
      result: 14,
    });
  });

  it("deserializes a request so a handler can read the field names its .proto declares", () => {
    const loaded = loadServicePackage(fixturesDir);
    const calculator = loaded.grpcServices.find((service) => service.descriptor.typeName === "calculator.v1.CalculatorService");
    const shape = calculator?.definition.JsonShape;
    if (!shape) {
      throw new Error("missing JsonShape method definition");
    }

    // Serialized with the proto names, which is what a caller sends: OctoBus
    // builds the tool schema from the field names in the descriptor. The decoded
    // object used to carry only protobuf-es's camelCase property, so a handler
    // reading `request_id` — the name in the .proto, in the schema, and in the
    // service's own tests — got undefined and reported the field as missing.
    const requestBytes = shape.requestSerialize({
      request_id: "r-1",
      nested: { child_name: "child" },
    });
    const request = shape.requestDeserialize(requestBytes) as Record<string, unknown>;

    expect(request.request_id).toBe("r-1");
    expect(request.requestId).toBe("r-1");
    expect((request.nested as Record<string, unknown>).child_name).toBe("child");
  });

  it("loads the daemon-provided descriptor set from OCTOBUS_DESCRIPTOR_PATH", () => {
    const descriptorDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-descriptor-"));
    const descriptorPath = path.join(descriptorDir, "descriptor.protoset");
    execFileSync("protoc", [
      "-I", path.join(fixturesDir, "proto"),
      "--include_imports",
      `--descriptor_set_out=${descriptorPath}`,
      path.join(fixturesDir, "proto", "calculator.proto"),
    ]);

    const dir = writeManifest(
      {
        schema: "chaitin.octobus.service.v1",
        name: "calculator",
        proto: { roots: ["proto"], files: ["missing.proto"] },
      },
      { packageJson: { name: "calculator", bin: "bin/calculator.js" } },
    );
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "calculator.js"), "#!/usr/bin/env node\n", "utf8");

    const loaded = loadServicePackage(dir, { OCTOBUS_DESCRIPTOR_PATH: descriptorPath });

    expect(loaded.services.map((service) => service.typeName)).toContain("calculator.v1.CalculatorService");
    expect(loaded.registry.getMessage("calculator.v1.BinaryOperationRequest")?.typeName).toBe("calculator.v1.BinaryOperationRequest");
  });

  it("loads services directly from descriptor.pb and service.json without proto files or protoc", () => {
    const descriptorDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-client-descriptor-"));
    const descriptorPath = path.join(descriptorDir, "descriptor.pb");
    const manifestPath = path.join(descriptorDir, "service.json");
    execFileSync("protoc", [
      "-I", path.join(fixturesDir, "proto"),
      "--include_imports",
      `--descriptor_set_out=${descriptorPath}`,
      path.join(fixturesDir, "proto", "calculator.proto"),
    ]);
    fs.copyFileSync(path.join(fixturesDir, "service.json"), manifestPath);

    const loaded = loadServiceDescriptor({ descriptorPath, manifestPath });

    expect(loaded.packageDir).toBe(descriptorDir);
    expect(loaded.entry).toBe("");
    expect(loaded.manifest.name).toBe("calculator");
    expect(loaded.services.map((service) => service.typeName)).toContain("calculator.v1.CalculatorService");
    expect(loaded.grpcServices[0]?.definition.Add.path).toBe("/calculator.v1.CalculatorService/Add");
  });

  it("loads descriptor.pb without a service manifest", () => {
    const descriptorDir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-client-descriptor-"));
    const descriptorPath = path.join(descriptorDir, "descriptor.pb");
    execFileSync("protoc", [
      "-I", path.join(fixturesDir, "proto"),
      "--include_imports",
      `--descriptor_set_out=${descriptorPath}`,
      path.join(fixturesDir, "proto", "calculator.proto"),
    ]);

    const loaded = loadServiceDescriptor({ descriptorPath });

    expect(loaded.manifest.name).toBe("descriptor");
    expect(loaded.services.map((service) => service.typeName)).toContain("calculator.v1.CalculatorService");
  });

  it("rejects missing schema", () => {
    const dir = writeManifest({ name: "calculator", proto: validProto() });

    expect(() => readServiceManifest(dir)).toThrow("service.json schema must be chaitin.octobus.service.v1");
  });

  it("rejects wrong schema", () => {
    const dir = writeManifest({
      schema: "wrong",
      name: "calculator",
      proto: validProto(),
    });

    expect(() => readServiceManifest(dir)).toThrow("service.json schema must be chaitin.octobus.service.v1");
  });

  it("rejects missing name", () => {
    const dir = writeManifest({ schema: "chaitin.octobus.service.v1", proto: validProto() });

    expect(() => readServiceManifest(dir)).toThrow("service.json name must be a non-empty string");
  });

  it("rejects top-level id", () => {
    const dir = writeManifest({
      schema: "chaitin.octobus.service.v1",
      id: "calculator",
      name: "calculator",
      proto: validProto(),
    });

    expect(() => readServiceManifest(dir)).toThrow("service.json must not define top-level id");
  });

  it("rejects service.json entry", () => {
    const dir = writeManifest({ schema: "chaitin.octobus.service.v1", name: "calculator", entry: "calculator", proto: validProto() });

    expect(() => readServiceManifest(dir)).toThrow("service.json must not define entry; use package.json bin");
  });

  it("infers package bin target", () => {
    const dir = writeManifest(
      { schema: "chaitin.octobus.service.v1", name: "calculator", proto: validProto() },
      { packageJson: { name: "calculator", version: "1.2.3", bin: { calculator: "bin/calculator.js" } } },
    );
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin/calculator.js"), "#!/usr/bin/env node\n", "utf8");

    expect(readServiceManifest(dir)).toMatchObject({
      version: "1.2.3",
    });
    expect(inferPackageBin(dir)).toBe(path.join("bin", "calculator.js"));
    expect(inferPackageBinName(dir)).toBe("calculator");
    expect(validatePackageFile(dir, inferPackageBin(dir), "package.json bin")).toBe(path.join(dir, "bin/calculator.js"));
  });

  it("infers package bin name from package name for string bin packages", () => {
    const dir = writeManifest(
      { schema: "chaitin.octobus.service.v1", name: "calculator", proto: validProto() },
      { packageJson: { name: "@acme/calculator-service", version: "1.2.3", bin: "bin/calculator.js" } },
    );

    expect(inferPackageBinName(dir)).toBe("calculator-service");
  });

  it("rejects invalid package bin", () => {
    const multi = writeManifest(
      { schema: "chaitin.octobus.service.v1", name: "calculator", proto: validProto() },
      { packageJson: { name: "calculator", bin: { first: "bin/first.js", second: "bin/second.js" } } },
    );
    const absolute = writeManifest(
      { schema: "chaitin.octobus.service.v1", name: "calculator", proto: validProto() },
      { packageJson: { name: "calculator", bin: "/bin/calculator.js" } },
    );

    expect(() => inferPackageBin(multi)).toThrow("package.json bin must contain exactly one entry");
    expect(() => inferPackageBinName(multi)).toThrow("package.json bin must contain exactly one entry");
    expect(() => inferPackageBin(absolute)).toThrow("package.json bin must be relative");
  });

  it("rejects invalid proto arrays", () => {
    const missingRoots = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: { roots: [], files: ["calculator.proto"] },
    });
    const emptyFile = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: { roots: ["proto"], files: [""] },
    });

    expect(() => readServiceManifest(missingRoots)).toThrow("service.json proto.roots must be a non-empty string array");
    expect(() => readServiceManifest(emptyFile)).toThrow("service.json proto.files must be a non-empty string array");
  });

  it("rejects configSchema paths outside the package", () => {
    const absolute = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: validProto(),
      configSchema: "/tmp/schema.json",
    });
    const escaping = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: validProto(),
      configSchema: "../schema.json",
    });

    expect(() => readServiceManifest(absolute)).toThrow("service.json configSchema must be a relative path inside the package");
    expect(() => readServiceManifest(escaping)).toThrow("service.json configSchema must stay inside the package");
  });

  it("rejects secretSchema paths outside the package", () => {
    const absolute = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: validProto(),
      secretSchema: "/tmp/schema.json",
    });
    const escaping = writeManifest({
      schema: "chaitin.octobus.service.v1",
      name: "calculator",
      proto: validProto(),
      secretSchema: "../schema.json",
    });

    expect(() => readServiceManifest(absolute)).toThrow("service.json secretSchema must be a relative path inside the package");
    expect(() => readServiceManifest(escaping)).toThrow("service.json secretSchema must stay inside the package");
  });
});

function validProto() {
  return {
    roots: ["proto"],
    files: ["calculator.proto"],
  };
}

function writeManifest(
  manifest: Record<string, unknown>,
  options: { packageJson?: Record<string, unknown> } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "octobus-sdk-manifest-"));
  fs.mkdirSync(path.join(dir, "proto"));
  fs.writeFileSync(path.join(dir, "service.json"), JSON.stringify(manifest), "utf8");
  if (options.packageJson) {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(options.packageJson), "utf8");
  }
  return dir;
}
