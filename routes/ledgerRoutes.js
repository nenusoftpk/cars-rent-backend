
import mongoose from "mongoose";
import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";

import {
  checkPermission,
} from "../middlewares/permission.middleware.js";

import {
  getCustomerLedger,
} from "../controllers/ledgerController.js";

const router = Router();

// Authentication and business isolation
router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription
);

// Validate customer ID
const validateCustomerId = (
  req,
  res,
  next
) => {
  if (
    !mongoose.isValidObjectId(
      req.params.customerId
    )
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid customer ID.",
    });
  }

  next();
};

// ======================================================
// CUSTOMER LEDGER / KHATA
// ======================================================

// GET /api/v1/ledger/customers/:customerId
// Optional query: from, to

router.get(
  "/customers/:customerId",
  checkPermission("ledger.view"),
  validateCustomerId,
  getCustomerLedger
);

export default router;
