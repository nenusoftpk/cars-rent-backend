import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";

import {
  getSettings,
  updateSettings,
  resetSettings,
} from "../controllers/settingController.js";

import { updateSettingSchema } from "../validations/settingValidation.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// Get settings
router.get(
  "/",
  checkPermission("settings.view"),
  getSettings
);

// Update settings
router.patch(
  "/",
  checkPermission("settings.update"),
  validate(updateSettingSchema),
  updateSettings
);

// Reset to default
router.post(
  "/reset",
  checkPermission("settings.update"),
  resetSettings
);

export default router;