import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../domain/common/errors.js";

export function notFoundMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "ROUTE_NOT_FOUND", "Route not found"));
}
