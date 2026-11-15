// bookingRoutes.js  (unchanged – no new endpoints required)

import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";

import {
  checkPermission,
} from "../middlewares/permission.middleware.js";

import validate from "../middlewares/validate.middleware.js";

import {
  listBookings,
  getBooking,
  checkAvailability,
  createBooking,
  updateBooking,
  extendBooking,
  cancelBooking,
  getBookingStats,
} from "../controllers/bookingController.js";

import {
  createBookingSchema,
  updateBookingSchema,
  cancelBookingSchema,
  extendBookingSchema,
  bookingFilterSchema,
  bookingIdSchema,
  bookingAvailabilitySchema,
} from "../validations/bookingValidation.js";

const router = Router();

// ======================================================
// COMMON MIDDLEWARES
// ======================================================

router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription
);

// ======================================================
// LIST BOOKINGS
// GET /api/v1/bookings
// ======================================================

router.get(
  "/",
  checkPermission("bookings.view"),
  validate(bookingFilterSchema, "query"),
  listBookings
);

// ======================================================
// BOOKING STATISTICS
// GET /api/v1/bookings/stats
// ======================================================

router.get(
  "/stats",
  checkPermission("bookings.view"),
  getBookingStats
);

// ======================================================
// CHECK CAR AVAILABILITY
// GET /api/v1/bookings/availability
// ======================================================

router.get(
  "/availability",
  checkPermission("bookings.view"),
  validate(bookingAvailabilitySchema, "query"),
  checkAvailability
);

// ======================================================
// CREATE BOOKING
// POST /api/v1/bookings
// ======================================================

router.post(
  "/",
  checkPermission("bookings.create"),
  validate(createBookingSchema),
  createBooking
);

// ======================================================
// GET SINGLE BOOKING
// GET /api/v1/bookings/:id
// ======================================================

router.get(
  "/:id",
  checkPermission("bookings.view"),
  validate(bookingIdSchema, "params"),
  getBooking
);

// ======================================================
// UPDATE BOOKING
// PATCH /api/v1/bookings/:id
// ======================================================

router.patch(
  "/:id",
  checkPermission("bookings.update"),
  validate(bookingIdSchema, "params"),
  validate(updateBookingSchema),
  updateBooking
);

// ======================================================
// EXTEND BOOKING
// PATCH /api/v1/bookings/:id/extend
// ======================================================

router.patch(
  "/:id/extend",
  checkPermission("bookings.update"),
  validate(bookingIdSchema, "params"),
  validate(extendBookingSchema),
  extendBooking
);

// ======================================================
// CANCEL BOOKING
// PATCH /api/v1/bookings/:id/cancel
// ======================================================

router.patch(
  "/:id/cancel",
  checkPermission("bookings.cancel"),
  validate(bookingIdSchema, "params"),
  validate(cancelBookingSchema),
  cancelBooking
);

export default router;