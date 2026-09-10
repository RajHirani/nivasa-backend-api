import { Router } from "express";
import {
  register,
  login,
  getMe,
  listUsers,
  logout,
} from "../controllers/auth.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";

const router = Router();

// Public routes
router.post("/register", validateBody("email", "password", "name"), register);
router.post("/login", validateBody("email", "password"), login);

// Protected routes (require valid JWT)
router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);

// Admin-only routes
router.get("/users", authenticate, authorize("admin"), listUsers);

export default router;
