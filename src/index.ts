import "dotenv/config";
import express from "express";
import { config } from "./config/index";
import routes from "./routes/index";
import { errorHandler } from "./middleware/error.middleware";
import { prisma } from "./prisma";
import { logger } from "./utils/logger";

const app = express();

// ─── Global Middleware ───────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging (dev only) ─────────────────────────────
if (config.isDev) {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
  });
}

// ─── API Routes ──────────────────────────────────────────────
app.use("/api", routes);

// ─── 404 Handler ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
    error: "NOT_FOUND",
  });
});

// ─── Global Error Handler (must be last) ─────────────────────
app.use(errorHandler);

// ─── Graceful Shutdown ───────────────────────────────────────
const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── Start Server ────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`Server running on http://localhost:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});
