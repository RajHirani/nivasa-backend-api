import type { Request, Response, NextFunction } from "express";
import {
  registerUser,
  loginUser,
  getUserById,
  getAllUsers,
} from "../services/auth.service";
import { sendSuccess, sendError } from "../utils/response";
import type { RegisterBody, LoginBody } from "../types/index";

/**
 * POST /api/auth/register
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as RegisterBody;
    const result = await registerUser(body);

    sendSuccess(res, result, "Registration successful.", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as LoginBody;
    const result = await loginUser(body);

    sendSuccess(res, result, "Login successful.");
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Protected — requires valid JWT.
 */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, "Not authenticated.", 401, "NOT_AUTHENTICATED");
      return;
    }

    const user = getUserById(req.user.id);

    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }

    sendSuccess(res, { user }, "User profile retrieved.");
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/users
 * Protected — admin only.
 */
export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = getAllUsers();
    sendSuccess(res, { users }, "Users retrieved.");
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/logout
 * Placeholder — for stateless JWT, client simply discards the token.
 * Implement token blacklisting here when needed.
 */
export async function logout(
  _req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  sendSuccess(res, null, "Logged out successfully.");
}
