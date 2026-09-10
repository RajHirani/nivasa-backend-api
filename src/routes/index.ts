import { Router } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";

const router = Router();

// Mount route groups
router.use("/auth", authRoutes);
router.use("/health", healthRoutes);

export default router;
