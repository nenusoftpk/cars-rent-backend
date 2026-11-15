
import { fail } from "../utils/http.js";
import Booking from "../models/Booking.js";

// ======================================================
// RESOURCE SCOPE CONFIGURATION
// ======================================================

// Shared resources within the same business.
// Employees can access these records only when
// their corresponding permissions allow it.
const SHARED_MODELS = new Set([
  "Car",
  "Customer",
  "Driver",
  "Maintenance",
]);

// Resources directly owned or assigned to employees.
const OWNED_MODELS = Object.freeze({
  Booking: "employeeId",
  Expense: "createdBy",
});

// Resources whose visibility depends on an assigned booking.
// Both models must contain a bookingId reference.
const BOOKING_LINKED_MODELS = new Set([
  "Payment",
  "CarInspection",
]);

// ======================================================
// TENANT VALIDATION
// ======================================================

const getTenant = (req) => {
  const tenant = req.tenant;

  if (!tenant?.businessId || !tenant?.userId) {
    throw fail("Business access is required.", 403);
  }

  if (!["admin", "employee"].includes(tenant.role)) {
    throw fail("Business access is not allowed.", 403);
  }

  // Employees always use own-booking scope.
  if (
    tenant.role === "employee" &&
    tenant.dataScope !== "own"
  ) {
    throw fail("Invalid employee data scope.", 403);
  }

  return tenant;
};

// ======================================================
// BUSINESS SCOPE
// ======================================================

export const tenantOnly = (req) => {
  const tenant = getTenant(req);

  return {
    businessId: tenant.businessId,
  };
};

// ======================================================
// RESOURCE SCOPE
// ======================================================

export const scope = (req, modelName) => {
  const tenant = getTenant(req);

  const filter = {
    businessId: tenant.businessId,
  };

  // Admin sees all records within their business.
  if (tenant.role === "admin") {
    return filter;
  }

  // Shared business resources.
  if (SHARED_MODELS.has(modelName)) {
    return filter;
  }

  // Employee-specific resources.
  const ownerField = OWNED_MODELS[modelName];

  if (ownerField) {
    return {
      ...filter,
      [ownerField]: tenant.userId,
    };
  }

  // Booking-linked resources require an async lookup.
  if (BOOKING_LINKED_MODELS.has(modelName)) {
    throw fail(
      `Use bookingLinkedScope() for ${modelName}.`,
      500
    );
  }

  // Unknown models are denied by default.
  throw fail(
    "This information is not available to your account.",
    403
  );
};

// ======================================================
// BOOKING-LINKED SCOPE
// ======================================================

// Employees can access payments and inspections
// belonging to their assigned bookings.
export const bookingLinkedScope = async (
  req,
  modelName
) => {
  if (!BOOKING_LINKED_MODELS.has(modelName)) {
    throw fail("Invalid booking-linked resource.", 500);
  }

  const tenant = getTenant(req);

  const filter = {
    businessId: tenant.businessId,
  };

  if (tenant.role === "admin") {
    return filter;
  }

  const bookingIds = await Booking.distinct("_id", {
    businessId: tenant.businessId,
    employeeId: tenant.userId,
  });

  return {
    ...filter,
    bookingId: {
      $in: bookingIds,
    },
  };
};

// ======================================================
// ADMIN ACCESS
// ======================================================

export const requireAdmin = (req) => {
  if (req.tenant?.role !== "admin") {
    throw fail(
      "Only your business administrator can do this.",
      403
    );
  }
};

// ======================================================
// SUPER ADMIN ACCESS
// ======================================================

// Intended for platform-level routes using separate
// super-admin authentication and authorization.
export const requirePlatform = (req) => {
  if (req.user?.role !== "super-admin") {
    throw fail(
      "This action is only available to the platform administrator.",
      403
    );
  }
};

// ======================================================
// BUSINESS REFERENCE VALIDATION
// ======================================================

// Confirms that a referenced document belongs
// to the current business.
//
// This does NOT authorize an employee to edit,
// delete, or view the document.
export const checkRef = async (
  Model,
  id,
  req,
  name
) => {
  const item = await Model.findOne({
    _id: id,
    ...tenantOnly(req),
  });

  if (!item) {
    throw fail(
      `${name} was not found in your business.`,
      404
    );
  }

  return item;
};

// ======================================================
// SCOPED DOCUMENT VALIDATION
// ======================================================

// Use for employee-sensitive read/update/delete operations.
export const checkScopedRef = async (
  Model,
  id,
  req,
  modelName,
  name
) => {
  const filter = BOOKING_LINKED_MODELS.has(modelName)
    ? await bookingLinkedScope(req, modelName)
    : scope(req, modelName);

  const item = await Model.findOne({
    _id: id,
    ...filter,
  });

  if (!item) {
    throw fail(`${name} was not found.`, 404);
  }

  return item;
};
