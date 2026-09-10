import type { Request, Response } from "express";
import { prisma } from "../prisma";
import { sendSuccess, sendError } from "../utils/response";

/**
 * GET /api/health
 */
export async function healthCheck(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, { database: "connected" }, "Service is healthy.");
  } catch {
    sendError(res, "Service unhealthy.", 503, "DATABASE_DISCONNECTED");
  }
}
