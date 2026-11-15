import express from "express";

import {
  getDashboard,
  getReminders,
  completeReminder,
  reopenReminder,
  getNotifications,
  globalSearch,
} from "../controllers/dashboardController.js";

import { authenticate } from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import { checkSubscription } from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";

const router = express.Router();

// Authentication, business isolation and subscription
router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription
);

// Dashboard statistics
router.get(
  "/",
  checkPermission("dashboard.view"),
  getDashboard
);

// Centralized reminders
router.get(
  "/reminders",
  checkPermission("reminders.view"),
  getReminders
);

// Mark reminder as done
router.patch(
  "/reminders/:id/complete",
  checkPermission("reminders.view"), // frontend uses reminders:edit – adjust if you have a stricter permission
  completeReminder
);

// Reopen a completed reminder
router.patch(
  "/reminders/:id/reopen",
  checkPermission("reminders.view"),
  reopenReminder
);

// Notifications
router.get(
  "/notifications",
  checkPermission("reminders.view"),
  getNotifications
);

// Global search
router.get(
  "/search",
  checkPermission("dashboard.view"),
  globalSearch
);

export default router;