export type ErrorCode =
  | "ROUTE_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "INTERNAL";

/**
 * Stable application error.
 * - `code`: machine-readable
 * - `status`: HTTP status
 * - `message`: human-readable
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function notFound(code: Exclude<ErrorCode, "INVALID_ARGUMENT" | "INTERNAL">, message: string): AppError {
  return new AppError(404, code, message);
}

export function badRequest(message: string): AppError {
  return new AppError(400, "INVALID_ARGUMENT", message);
}

export function internal(message = "Unexpected error"): AppError {
  return new AppError(500, "INTERNAL", message);
}
