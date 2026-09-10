import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response";

/**
 * Factory that returns middleware to validate required body fields.
 * Use on routes that expect a JSON body with specific keys.
 *
 * @example
 *   router.post("/login", validateBody("email", "password"), loginController);
 */
export function validateBody(...requiredFields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const missing: string[] = [];

    for (const field of requiredFields) {
      if (
        req.body == null ||
        (req.body as Record<string, unknown>)[field] === undefined ||
        (req.body as Record<string, unknown>)[field] === ""
      ) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      sendError(
        res,
        `Missing required fields: ${missing.join(", ")}`,
        400,
        "VALIDATION_ERROR",
      );
      return;
    }

    next();
  };
}
