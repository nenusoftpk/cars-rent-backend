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
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  getCustomerBookings,
  getCustomerPayments,
} from "../controllers/customerController.js";

import {
  createCustomerSchema,
  updateCustomerSchema,
} from "../validations/customerValidation.js";

import { idParamSchema } from "../validations/listValidation.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// ======================================================
// IMAGE UPLOAD (same pattern as auth + inspection)
// Customer fields: photo, cnicFront, cnicBack, licenseImage, thumbImage
// Guarantor fields: guarantor{1|2}Photo, guarantor{1|2}CnicFront,
//                   guarantor{1|2}CnicBack
// ======================================================

const customerImageUpload = handleUpload(
  uploadImages.fields([
    { name: "photo", maxCount: 1 },
    { name: "cnicFront", maxCount: 1 },
    { name: "cnicBack", maxCount: 1 },
    { name: "licenseImage", maxCount: 1 },
    { name: "thumbImage", maxCount: 1 },          // Customer fingerprint

    // Guarantor 1
    { name: "guarantor1Photo", maxCount: 1 },
    { name: "guarantor1CnicFront", maxCount: 1 },
    { name: "guarantor1CnicBack", maxCount: 1 },
    { name: "guarantor1ThumbImage", maxCount: 1 }, // NEW

    // Guarantor 2
    { name: "guarantor2Photo", maxCount: 1 },
    { name: "guarantor2CnicFront", maxCount: 1 },
    { name: "guarantor2CnicBack", maxCount: 1 },
    { name: "guarantor2ThumbImage", maxCount: 1 }, // NEW
  ])
);

// ======================================================
// ROUTES
// ======================================================

router.get("/", checkPermission("customers.view"), listCustomers);

router.post(
  "/",
  checkPermission("customers.create"),
  customerImageUpload,                 // ← Multer first
  validate(createCustomerSchema),
  createCustomer
);

router.get(
  "/:id",
  checkPermission("customers.view"),
  validate(idParamSchema, "params"),
  getCustomer
);

router.patch(
  "/:id",
  checkPermission("customers.update"),
  customerImageUpload,                 // ← Multer first
  validate(idParamSchema, "params"),
  validate(updateCustomerSchema),
  updateCustomer
);

router.delete(
  "/:id",
  checkPermission("customers.delete"),
  validate(idParamSchema, "params"),
  deleteCustomer
);

router.get(
  "/:id/bookings",
  checkPermission("customers.view", "bookings.view"),
  validate(idParamSchema, "params"),
  getCustomerBookings
);

router.get(
  "/:id/payments",
  checkPermission("customers.view", "bookings.view", "payments.view"),
  validate(idParamSchema, "params"),
  getCustomerPayments
);

export default router;
