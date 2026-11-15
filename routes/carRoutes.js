
import { Router } from "express";

// ======================================================
// MIDDLEWARES
// ======================================================

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";

import {
  checkPermission,
} from "../middlewares/permission.middleware.js";

import validate from "../middlewares/validate.middleware.js";

import {
  uploadImages,
  uploadDocuments,
  handleUpload,
} from "../middlewares/upload.middleware.js";

// ======================================================
// VALIDATIONS
// ======================================================

import {
  idParamSchema,
} from "../validations/listValidation.js";

import {
  createCarSchema,
  updateCarSchema,
  updateCarStatusSchema,
  removeCarImageSchema,
  carAvailabilitySchema,
} from "../validations/carValidation.js";

// ======================================================
// CONTROLLERS
// ======================================================

import {
  listCars,
  getCar,
  createCar,
  updateCar,
  deleteCar,
  uploadCarImages,
  removeCarImage,
  uploadCarDocument,
  setCarStatus,
  getCarHistory,
  getCarReminders,
  getCarFinancials,
  checkCarAvailability,
  getCarStats,
  addCarServiceRecord,
  getCarServiceRecords,
} from "../controllers/carController.js";

const router = Router();

// ======================================================
// UPLOAD CONFIGURATION
// ======================================================

// Car images:
// JPG, PNG, WEBP
// Maximum: 5 MB per image
// Maximum: 10 images

const carImagesUpload = handleUpload(
  uploadImages.array("images", 5)
);

// Car documents:
// JPG, PNG, WEBP, PDF
// Maximum: 10 MB per document
// Single file field: file

const carDocumentUpload = handleUpload(
  uploadDocuments.single("file")
);

// ======================================================
// PROTECTED ROUTES
// ======================================================

router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription
);

// ======================================================
// 1. CAR LISTING
// ======================================================

router.get(
  "/",
  checkPermission("cars.view"),
  listCars
);

// ======================================================
// 2. CREATE CAR
// ======================================================

router.post(
  "/",
  checkPermission("cars.create"),
  validate(createCarSchema),
  createCar
);

// ======================================================
// 3. CAR STATISTICS
// ======================================================

router.get(
  "/stats",
  checkPermission("cars.view"),
  getCarStats
);

// ======================================================
// 4. CAR REMINDERS
// ======================================================

router.get(
  "/reminders",
  checkPermission("cars.view"),
  getCarReminders
);

// ======================================================
// 5. GET SINGLE CAR
// ======================================================

router.get(
  "/:id",
  checkPermission("cars.view"),
  validate(idParamSchema, "params"),
  getCar
);

// ======================================================
// 6. UPDATE CAR
// ======================================================

router.patch(
  "/:id",
  checkPermission("cars.update"),
  validate(idParamSchema, "params"),
  validate(updateCarSchema),
  updateCar
);

// ======================================================
// 7. DELETE CAR
// ======================================================

router.delete(
  "/:id",
  checkPermission("cars.delete"),
  validate(idParamSchema, "params"),
  deleteCar
);

// ======================================================
// 8. UPLOAD CAR IMAGES
// ======================================================

router.post(
  "/:id/images",
  checkPermission("cars.update"),
  validate(idParamSchema, "params"),
  carImagesUpload,
  uploadCarImages
);

// ======================================================
// 9. REMOVE CAR IMAGE
// ======================================================

router.delete(
  "/:id/images",
  checkPermission("cars.update"),
  validate(idParamSchema, "params"),
  validate(removeCarImageSchema),
  removeCarImage
);

// ======================================================
// 10. UPLOAD CAR DOCUMENT
// ======================================================

router.post(
  "/:id/documents",
  checkPermission("cars.update"),
  validate(idParamSchema, "params"),
  carDocumentUpload,
  uploadCarDocument
);

// ======================================================
// 11. UPDATE CAR STATUS
// ======================================================

router.patch(
  "/:id/status",
  checkPermission("cars.update"),
  validate(idParamSchema, "params"),
  validate(updateCarStatusSchema),
  setCarStatus
);

// ======================================================
// 12. CAR HISTORY
// ======================================================

router.get(
  "/:id/history",
  checkPermission("cars.view"),
  validate(idParamSchema, "params"),
  getCarHistory
);

// ======================================================
// 13. CAR FINANCIAL REPORT
// ======================================================

router.get(
  "/:id/financials",
  checkPermission("reports.view"),
  validate(idParamSchema, "params"),
  getCarFinancials
);

// ======================================================
// 14. CHECK CAR AVAILABILITY
// ======================================================

router.get(
  "/:id/availability",
  checkPermission("cars.view"),
  validate(idParamSchema, "params"),
  validate(carAvailabilitySchema, "query"),
  checkCarAvailability
);

// ======================================================
// 15. GET CAR SERVICE RECORDS
// ======================================================

router.get(
  "/:id/services",
  checkPermission("reports.view"),
  validate(idParamSchema, "params"),
  getCarServiceRecords
);

// ======================================================
// 16. ADD CAR SERVICE RECORD
// ======================================================

router.post(
  "/:id/services",
  checkPermission("reports.view"),
  validate(idParamSchema, "params"),
  addCarServiceRecord
);

// ======================================================
// 17. GET CAR MAINTENANCE RECORDS
// ======================================================

router.get(
  "/:id/maintenance",
  checkPermission("reports.view"),
  validate(idParamSchema, "params"),
  getCarServiceRecords
);

export default router;
