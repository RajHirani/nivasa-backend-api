import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { config } from "../config/index";
import type {
  AuthTokens,
  AuthUser,
  LoginBody,
  RegisterBody,
  TokenPayload,
  UserRecord,
} from "../types/index";
import { logger } from "../utils/logger";

// ─── In-Memory User Store (Dummy Data) ──────────────────────
// TODO: Replace with Prisma queries once the database is connected.

const users: UserRecord[] = [];
let nextId = 1;

// Seed a default admin user on startup
const SEED_PASSWORD = bcrypt.hashSync("admin123", 10);
users.push({
  id: String(nextId++),
  email: "admin@nivasa.com",
  name: "Admin User",
  password: SEED_PASSWORD,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
});

logger.info("Seeded default admin user", { email: "admin@nivasa.com", password: "admin123" });

// ─── Helpers ─────────────────────────────────────────────────

function generateToken(user: AuthUser): AuthTokens {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expiresIn is always a valid ms string like "24h"
  const accessToken = jwt.sign(payload, config.jwt.secret as string, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);

  return {
    accessToken,
    expiresIn: config.jwt.expiresIn as string,
  };
}

function toPublicUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

// ─── Service Methods ─────────────────────────────────────────

export async function registerUser(
  body: RegisterBody,
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  // Check if email already exists
  const existing = users.find((u) => u.email === body.email);
  if (existing) {
    throw Object.assign(new Error("Email already registered."), {
      statusCode: 409,
    });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(body.password, 10);

  // Create user record
  const newUser: UserRecord = {
    id: String(nextId++),
    email: body.email.toLowerCase().trim(),
    name: body.name.trim(),
    password: hashedPassword,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  users.push(newUser);
  logger.info("User registered", { id: newUser.id, email: newUser.email });

  const publicUser = toPublicUser(newUser);
  const tokens = generateToken(publicUser);

  return { user: publicUser, tokens };
}

export async function loginUser(
  body: LoginBody,
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const user = users.find((u) => u.email === body.email.toLowerCase().trim());

  if (!user) {
    throw Object.assign(new Error("Invalid email or password."), {
      statusCode: 401,
    });
  }

  const isMatch = await bcrypt.compare(body.password, user.password);
  if (!isMatch) {
    throw Object.assign(new Error("Invalid email or password."), {
      statusCode: 401,
    });
  }

  logger.info("User logged in", { id: user.id, email: user.email });

  const publicUser = toPublicUser(user);
  const tokens = generateToken(publicUser);

  return { user: publicUser, tokens };
}

export function getUserById(id: string): AuthUser | null {
  const user = users.find((u) => u.id === id);
  return user ? toPublicUser(user) : null;
}

export function getAllUsers(): AuthUser[] {
  return users.map(toPublicUser);
}
