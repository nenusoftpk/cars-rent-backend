// PATH: src/routes/driverRoutes.js
import { Router } from "express";
import { idParamSchema } from "../validations/listValidation.js";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";

import {
  uploadImages,
  handleUpload,
} from "../middlewares/upload.middleware.js";

import {
  listDrivers,
  getDriverStats,
  getAvailableDrivers,
  getDriver,
  createDriver,
  updateDriver,
  deleteDriver,
  getDriverBookings,
  getDriverPayments,
  getDriverOverview,
} from "../controllers/driverController.js";

import {
  createDriverSchema,
  updateDriverSchema,
} from "../validations/driverValidation.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

const driverImageUpload = handleUpload(
  uploadImages.fields([
    { name: "photo", maxCount: 1 },
    { name: "cnicFront", maxCount: 1 },
    { name: "cnicBack", maxCount: 1 },
    { name: "licenseImage", maxCount: 1 },
  ])
);

router.get("/", checkPermission("drivers.view"), listDrivers);
router.get("/stats", checkPermission("drivers.view"), getDriverStats);
router.get("/available", checkPermission("drivers.view"), getAvailableDrivers);

router.post(
  "/",
  checkPermission("drivers.create"),
  driverImageUpload,
  validate(createDriverSchema),
  createDriver
);

router.get(
  "/:id/bookings",
  checkPermission("drivers.view"),
  validate(idParamSchema, "params"),
  getDriverBookings
);

router.get(
  "/:id/payments",
  checkPermission("drivers.view"),
  validate(idParamSchema, "params"),
  getDriverPayments
);

router.get(
  "/:id/overview",
  checkPermission("drivers.view"),
  validate(idParamSchema, "params"),
  getDriverOverview
);

router.get(
  "/:id",
  checkPermission("drivers.view"),
  validate(idParamSchema, "params"),
  getDriver
);

router.patch(
  "/:id",
  checkPermission("drivers.update"),
  validate(idParamSchema, "params"),
  driverImageUpload,
  validate(updateDriverSchema),
  updateDriver
);

router.delete(
  "/:id",
  checkPermission("drivers.delete"),
  validate(idParamSchema, "params"),
  deleteDriver
);

export default router;