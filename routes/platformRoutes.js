import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import { superAdminOnly } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";

import {
  listPlatformBusinesses,
  setBusinessStatus,
} from "../controllers/businessController.js";

import {
  listPlatformSubscriptions,
  getPlatformSubscription,
  setPlatformSubscription,
} from "../controllers/subscriptionController.js";

import { updateBusinessStatusSchema } from "../validations/businessValidation.js";
import { idParamSchema } from "../validations/listValidation.js";

const router = Router();

// Only Super Admin can access platform routes
router.use(authenticate, superAdminOnly);

// ======================================================
// BUSINESSES
// ======================================================

router.get("/businesses", listPlatformBusinesses);

router.patch(
  "/businesses/:id/status",
  validate(idParamSchema, "params"),
  validate(updateBusinessStatusSchema),
  setBusinessStatus
);

// ======================================================
// SUBSCRIPTIONS
// ======================================================

// List all subscriptions
router.get("/subscriptions", listPlatformSubscriptions);

// Get subscription of a specific business
router.get(
  "/subscriptions/:businessId",
  getPlatformSubscription
);

// Update / activate subscription of a business
router.patch(
  "/subscriptions/:businessId",
  setPlatformSubscription
);

// Keep backward compatibility (old route)
router.patch(
  "/businesses/:businessId/subscription",
  setPlatformSubscription
);

export default router;