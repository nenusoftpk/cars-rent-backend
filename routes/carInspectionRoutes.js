import { Router } from "express";
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
  issueInspectionSchema,
  returnInspectionSchema,
  createInspectionSchema,
  bookingInspectionParamsSchema,
  inspectionParamsSchema,
  inspectionIdParamsSchema,
  listInspectionQuerySchema,
} from "../validations/carInspectionValidation.js";
import {
  listInspections,
  getBookingInspections,
  getInspection,
  getInspectionById,
  issueCar,
  returnCar,
  createInspection,
  getInspectionStats,
} from "../controllers/carInspectionController.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// ======================================================
// IMAGE UPLOAD (same pattern as authRoutes)
// Max 5 files, 5 MB each, JPG/PNG/WEBP only
// ======================================================

const inspectionImageUpload = handleUpload(
  uploadImages.array("photos", 5)
);

// ======================================================
// ROUTES
// ======================================================

router.get(
  "/",
  checkPermission("inspections.view"),
  validate(listInspectionQuerySchema, "query"),
  listInspections
);

router.get(
  "/stats",
  checkPermission("inspections.view"),
  getInspectionStats
);

// Issue car + optional images
router.post(
  "/issue",
  checkPermission("inspections.issue"),
  inspectionImageUpload,          // ← Multer first
  validate(issueInspectionSchema),
  issueCar
);

// Return car + optional images
router.post(
  "/return",
  checkPermission("inspections.return"),
  inspectionImageUpload,          // ← Multer first
  validate(returnInspectionSchema),
  returnCar
);

router.post(
  "/",
  checkPermission("inspections.issue"),
  validate(createInspectionSchema),
  createInspection
);

router.get(
  "/booking/:bookingId",
  checkPermission("inspections.view"),
  validate(bookingInspectionParamsSchema, "params"),
  getBookingInspections
);

router.get(
  "/booking/:bookingId/:type",
  checkPermission("inspections.view"),
  validate(inspectionParamsSchema, "params"),
  getInspection
);

router.get(
  "/:id",
  checkPermission("inspections.view"),
  validate(inspectionIdParamsSchema, "params"),
  getInspectionById
);

export default router;