import { describe, expect, it } from "vitest";
import {
  GrpcError,
  grpcError,
  grpcInvalidArgumentError,
  grpcNotFoundError,
  grpcPermissionDeniedError,
  grpcUnauthenticatedError,
  grpcUnavailableError,
  grpcStatus,
  serviceError,
} from "../src/index.js";

describe("GrpcError", () => {
  it("stores a gRPC status code and message", () => {
    const error = new GrpcError(grpcStatus.NOT_FOUND, "missing", { legacyCode: "NOT_FOUND", details: { id: "svc" } });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GrpcError");
    expect(error.code).toBe(grpcStatus.NOT_FOUND);
    expect(error.message).toBe("missing");
    expect(error.legacyCode).toBe("NOT_FOUND");
    expect(error.details).toEqual({ id: "svc" });
  });

  it("provides helper constructors", () => {
    expect(grpcError(grpcStatus.UNAVAILABLE, "down")).toMatchObject({ code: grpcStatus.UNAVAILABLE, message: "down" });
    expect(grpcInvalidArgumentError("bad")).toMatchObject({ code: grpcStatus.INVALID_ARGUMENT, message: "bad" });
    expect(grpcNotFoundError("missing")).toMatchObject({ code: grpcStatus.NOT_FOUND, message: "missing" });
    expect(grpcPermissionDeniedError("denied")).toMatchObject({ code: grpcStatus.PERMISSION_DENIED, message: "denied" });
    expect(grpcUnauthenticatedError("login")).toMatchObject({ code: grpcStatus.UNAUTHENTICATED, message: "login" });
    expect(grpcUnavailableError("down")).toMatchObject({ code: grpcStatus.UNAVAILABLE, message: "down" });
  });

  it("constructs service errors with numeric and legacy codes", () => {
    expect(serviceError("INVALID_ARGUMENT", "bad input", { field: "name" })).toMatchObject({
      code: grpcStatus.INVALID_ARGUMENT,
      legacyCode: "INVALID_ARGUMENT",
      message: "bad input",
      details: { field: "name" },
    });
  });
});
