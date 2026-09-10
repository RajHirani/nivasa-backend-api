import type { Response } from "express";
import type { ApiResponse } from "../types/index";

/**
 * Send a standardised success response.
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200,
): void {
  const body: ApiResponse<T> = { success: true, message, data };
  res.status(statusCode).json(body);
}

/**
 * Send a standardised error response.
 */
export function sendError(
  res: Response,
  message: string,
  statusCode = 400,
  error?: string,
): void {
  const body: ApiResponse = { success: false, message };
  if (error) {
    (body as ApiResponse & { error: string }).error = error;
  }
  res.status(statusCode).json(body);
}
