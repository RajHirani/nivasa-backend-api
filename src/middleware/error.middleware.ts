import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import type { ApiResponse } from "../types/index";

/**
 * Global error-handling middleware.
 * Must be registered LAST in the middleware chain.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error("Unhandled error", {
    message: err.message,
    stack: err.stack,
  });

  const statusCode = "statusCode" in err ? (err as Error & { statusCode: number }).statusCode : 500;

  const body: ApiResponse = {
    success: false,
    message:
      process.env["NODE_ENV"] === "production"
        ? "Internal server error"
        : err.message,
  };

  res.status(statusCode).json(body);
}
