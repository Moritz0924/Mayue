import "express";

declare global {
  namespace Express {
    interface Request {
      trace_id?: string;
    }
  }
}

export {};
