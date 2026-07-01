export class GrpcError extends Error {
  public readonly code: number;
  public readonly legacyCode?: string;
  public readonly details?: unknown;

  public constructor(code: number, message: string, options: { legacyCode?: string; details?: unknown } = {}) {
    super(message);
    this.name = "GrpcError";
    this.code = code;
    this.legacyCode = options.legacyCode;
    this.details = options.details;
  }
}

export function grpcError(code: number, message: string): GrpcError {
  return new GrpcError(code, message);
}
