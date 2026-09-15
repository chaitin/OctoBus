import { defineService, GrpcError, grpcStatus } from "../../src/index.js";

export default defineService({
  handlers: {
    "calculator.v1.CalculatorService/Add": async (ctx) => {
      const request = ctx.request as { left: number; right: number };
      if (request.left === -1) {
        throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "left must not be -1");
      }
      if (request.left === -2) {
        throw new Error("ordinary failure");
      }
      return { result: request.left + request.right };
    },
    "calculator.v1.CalculatorService/EchoContract": () => ({
      httpStatusCode: 200,
    }),
    "calculator.v1.CalculatorService/JsonShape": (ctx) => {
      // Reads its field by the name the .proto declares, which is what a service
      // package does and what the tool schema advertises. The CLI builds a handler's
      // request from JSON rather than from the wire, so this handler is where the two
      // invocations of one service would diverge if only the wire path aliased.
      const request = ctx.request as { request_id?: string };
      if (!request.request_id) {
        throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "request_id is required");
      }
      return { customField: request.request_id };
    },
  },
});
