import type { Request, Response, NextFunction } from "express";
import { newTraceId } from "../../obs/trace.js";

const HEADER_NAME = "x-trace-id";

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER_NAME);
  const traceId = (incoming && String(incoming).trim()) || newTraceId();

  req.trace_id = traceId;
  res.setHeader("X-Trace-Id", traceId);
  next();
}
