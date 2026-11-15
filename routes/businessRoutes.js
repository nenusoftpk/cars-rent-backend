
import { Router } from "express";

// ======================================================
// MIDDLEWARES
// ======================================================

import authenticate from "../middlewares/auth.middleware.js";

import tenantMiddleware from "../middlewares/tenant.middleware.js";

import checkSubscription from "../middlewares/subscription.middleware.js";

import {
  adminOnly,
} from "../middlewares/permission.middleware.js";

import validate from "../middlewares/validate.middleware.js";

// ======================================================
// CONTROLLERS
// ======================================================

import {
  getMyBusiness,
  updateMyBusiness,
} from "../controllers/businessController.js";

// ======================================================
// VALIDATIONS
// ======================================================

import {
  updateBusinessSchema,
} from "../validations/businessValidation.js";

// ======================================================
// ROUTER INITIALIZATION
// ======================================================

const router = Router();

// ======================================================
// PROTECTED ROUTES
// ======================================================

// All business routes require:
// 1. Valid JWT authentication
// 2. Valid business / tenant context
// 3. Active subscription

router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription
);

// ======================================================
// 1. GET MY BUSINESS
// GET /api/v1/businesses/me
//
// Access:
// - Admin
// - Employee
//
// Returns:
// - Business ID
// - Business name
// - Business status
// - Created / updated timestamps
// ======================================================

router.get(
  "/me",
  getMyBusiness
);

// ======================================================
// 2. UPDATE MY BUSINESS
// PATCH /api/v1/businesses/me
//
// Access:
// - Admin only
//
// Allowed update:
// - businessName
//
// Employees cannot update business information.
// Business status is controlled by Super Admin.
// ======================================================

router.patch(
  "/me",
  adminOnly,
  validate(updateBusinessSchema),
  updateMyBusiness
);

// ======================================================
// EXPORT ROUTER
// ======================================================

export default router;
