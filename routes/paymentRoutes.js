import mongoose from "mongoose";
import { Router } from "express";
import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import {
  checkPermission,
  adminOnly,
} from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";
import {
  uploadImages,
  handleUpload,
} from "../middlewares/upload.middleware.js";
import {
  listPayments,
  getPayment,
  bookingBalance,
  bookingPayments,
  paymentStats,
  createPayment,
  receiveSecurity,
  refundSecurity,
  refundPayment,
  voidPayment,
} from "../controllers/paymentController.js";
import {
  createPaymentSchema,
  receiveSecuritySchema,
  refundSecuritySchema,
  refundPaymentSchema,
  voidPaymentSchema,
} from "../validations/paymentValidation.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// Same pattern as Auth / Employee / Customer image uploads
const paymentProofUpload = handleUpload(
  uploadImages.single("paymentProof")
);

const validateId = (name) => (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params[name])) {
    return res.status(400).json({
      success: false,
      message: `Invalid ${name}.`,
    });
  }
  next();
};

// ======================================================
// STATIC PATHS (must be before /:id)
// ======================================================

router.get(
  "/",
  checkPermission("payments.view"),
  listPayments
);

router.get(
  "/stats",
  checkPermission("payments.view"),
  paymentStats
);

router.get(
  "/booking/:bookingId/balance",
  checkPermission("payments.view"),
  validateId("bookingId"),
  bookingBalance
);

router.get(
  "/booking/:bookingId",
  checkPermission("payments.view"),
  validateId("bookingId"),
  bookingPayments
);

// ======================================================
// CREATE / REFUND ENDPOINTS (with optional proof upload)
// ======================================================

router.post(
  "/",
  checkPermission("payments.create"),
  paymentProofUpload,
  validate(createPaymentSchema),
  createPayment
);

router.post(
  "/security/receive",
  checkPermission("payments.create"),
  paymentProofUpload,
  validate(receiveSecuritySchema),
  receiveSecurity
);

router.post(
  "/security/refund",
  checkPermission("payments.refund"),
  paymentProofUpload,
  validate(refundSecuritySchema),
  refundSecurity
);

router.post(
  "/:id/refund",
  checkPermission("payments.refund"),
  validateId("id"),
  paymentProofUpload,
  validate(refundPaymentSchema),
  refundPayment
);

// Void is intentionally admin-only and never accepts a file
router.post(
  "/:id/void",
  adminOnly,
  validateId("id"),
  validate(voidPaymentSchema),
  voidPayment
);

// ======================================================
// GET ONE
// ======================================================

router.get(
  "/:id",
  checkPermission("payments.view"),
  validateId("id"),
  getPayment
);

export default router;