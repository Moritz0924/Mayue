import type { Request, Response, NextFunction } from "express";
import { AppError, internal } from "../../domain/common/errors.js";

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const trace_id = req.trace_id;
  const appErr: AppError = err instanceof AppError ? err : internal();

  // Never leak stack traces to clients; keep responses stable.
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      trace_id,
    },
  });
}
