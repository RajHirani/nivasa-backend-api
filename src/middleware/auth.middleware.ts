import type { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import { config } from "../config/index";
import { sendError } from "../utils/response";
import type { TokenPayload } from "../types/index";
import { logger } from "../utils/logger";

/**
 * Middleware that verifies the JWT from the Authorization header
 * and attaches the decoded user to `req.user`.
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Bearer ")) {
    sendError(res, "Access denied. No token provided.", 401, "NO_TOKEN");
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const decoded = jwt.verify(token, config.jwt.secret as string) as TokenPayload;

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name ?? "",
      role: decoded.role,
    };

    next();
  } catch (error) {
    logger.warn("Invalid token attempt", {
      error: error instanceof Error ? error.message : error,
    });
    sendError(res, "Invalid or expired token.", 401, "INVALID_TOKEN");
  }
}

/**
 * Middleware that checks if the authenticated user has
 * one of the required roles.
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, "Authentication required.", 401, "NOT_AUTHENTICATED");
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(
        res,
        "You do not have permission to perform this action.",
        403,
        "FORBIDDEN",
      );
      return;
    }

    next();
  };
}
