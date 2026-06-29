let sdk = {};
try {
  sdk = require('@chaitin-ai/octobus-sdk');
} catch {}

const grpcStatus = sdk.grpcStatus || {
  INVALID_ARGUMENT: 3,
  UNAUTHENTICATED: 16,
  DEADLINE_EXCEEDED: 4,
  UNAVAILABLE: 14,
  UNKNOWN: 2,
  INTERNAL: 13,
};

class FallbackGrpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GrpcError';
    this.code = code;
  }
}

const GrpcError = sdk.GrpcError || FallbackGrpcError;

function createGrpcError(code, message) {
  return new GrpcError(code, message);
}

function invalidArgument(message) {
  return createGrpcError(grpcStatus.INVALID_ARGUMENT, message);
}

function unauthenticated(message) {
  return createGrpcError(grpcStatus.UNAUTHENTICATED, message);
}

function unknown(message) {
  return createGrpcError(grpcStatus.UNKNOWN, message);
}

function unavailable(message) {
  return createGrpcError(grpcStatus.UNAVAILABLE, message);
}

function invalidJson(message = 'Invalid JSON response from upstream') {
  return createGrpcError(grpcStatus.INTERNAL, message);
}

function fromUpstream(payload) {
  const exception = payload && payload.exception;
  if (!exception) return null;
  if (Array.isArray(exception) && exception.length === 0) return null;
  if (typeof exception === 'object' && !Array.isArray(exception) && Object.keys(exception).length === 0) return null;
  const code = exception.code || exception.message || 'unknown upstream error';
  const message = exception.message || String(code);
  const lowered = String(code).toLowerCase();
  if (lowered.includes('login') || lowered.includes('auth') || lowered.includes('token')) return unauthenticated(message);
  return unknown(message);
}

module.exports = { grpcStatus, GrpcError, createGrpcError, invalidArgument, unauthenticated, unknown, unavailable, invalidJson, fromUpstream };
