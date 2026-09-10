import "dotenv/config";

export const config = {
  port: parseInt(process.env["PORT"] ?? "3000", 10),
  nodeEnv: process.env["NODE_ENV"] ?? "development",
  isDev: (process.env["NODE_ENV"] ?? "development") === "development",

  // JWT Configuration
  jwt: {
    secret: process.env["JWT_SECRET"] ?? "nivasa-dev-secret-change-in-production",
    expiresIn: process.env["JWT_EXPIRES_IN"] ?? "24h",
    refreshExpiresIn: process.env["JWT_REFRESH_EXPIRES_IN"] ?? "7d",
  },

  // Database
  databaseUrl: process.env["DATABASE_URL"] ?? "",

  // CORS
  cors: {
    origin: process.env["CORS_ORIGIN"] ?? "*",
  },
} as const;
