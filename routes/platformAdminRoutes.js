import { Router } from "express";
import {
  listPlatformAdmins,
  getPlatformAdmin,
  updatePlatformAdmin,
  resetPlatformAdminPassword,
  setPlatformAdminStatus,
} from "../controllers/platformAdminController.js";

import authenticate from "../middlewares/auth.middleware.js";
import { superAdminOnly } from "../middlewares/permission.middleware.js";

const router = Router();

// All routes require authentication + super-admin role
router.use(authenticate, superAdminOnly);

// List + Get (full details including password hash + subscription)
router.get("/", listPlatformAdmins);
router.get("/:id", getPlatformAdmin);

// Full update (name, email, phone, photo, status, password)
router.patch("/:id", updatePlatformAdmin);

// Convenience endpoints
router.patch("/:id/status", setPlatformAdminStatus);
router.patch("/:id/reset-password", resetPlatformAdminPassword);

export default router;