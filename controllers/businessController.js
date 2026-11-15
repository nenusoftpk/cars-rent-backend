
import Business from "../models/Business.js";

import {
  wrap,
  send,
  fail,
  paging,
} from "../utils/http.js";

import {
  requireAdmin,
  requirePlatform,
} from "../services/scope.js";

// ======================================================
// CONSTANTS
// ======================================================

const ALLOWED_BUSINESS_STATUSES = [
  "active",
  "suspended",
];

// ======================================================
// COMMON HELPERS
// ======================================================

// Remove internal MongoDB fields from API responses.
const safeBusiness = (business) => {
  if (!business) return null;

  const data =
    typeof business.toObject === "function"
      ? business.toObject()
      : { ...business };

  delete data.__v;

  return data;
};

// Get business ID from authenticated tenant context.
const getBusinessId = (req) => {
  const businessId = req.tenant?.businessId;

  if (!businessId) {
    throw fail(
      "Business context is missing.",
      403
    );
  }

  return businessId;
};

// ======================================================
// 1. GET MY BUSINESS
// GET /api/v1/businesses/me
//
// Accessible to authenticated business users.
// ======================================================

export const getMyBusiness = wrap(async (req, res) => {
  const businessId = getBusinessId(req);

  const business = await Business.findById(
    businessId
  ).lean();

  if (!business) {
    throw fail(
      "Business not found.",
      404
    );
  }

  return send(
    res,
    safeBusiness(business),
    "Business retrieved successfully."
  );
});

// ======================================================
// 2. UPDATE MY BUSINESS
// PATCH /api/v1/businesses/me
//
// Admin only.
//
// Allowed fields:
// - businessName
//
// Business status cannot be changed by Admin.
// ======================================================

export const updateMyBusiness = wrap(async (req, res) => {
  // Only business administrators can update.
  requireAdmin(req);

  const businessId = getBusinessId(req);

  // ====================================================
  // VALIDATE BUSINESS NAME
  // ====================================================

  const { businessName } = req.body || {};

  if (
    typeof businessName !== "string" ||
    !businessName.trim()
  ) {
    throw fail(
      "Business name is required.",
      400
    );
  }

  const trimmedName = businessName.trim();

  if (trimmedName.length < 2) {
    throw fail(
      "Business name must be at least 2 characters.",
      400
    );
  }

  if (trimmedName.length > 150) {
    throw fail(
      "Business name cannot exceed 150 characters.",
      400
    );
  }

  // ====================================================
  // UPDATE BUSINESS NAME
  // ====================================================

  const updatedBusiness =
    await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          businessName: trimmedName,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

  if (!updatedBusiness) {
    throw fail(
      "Business not found.",
      404
    );
  }

  return send(
    res,
    safeBusiness(updatedBusiness),
    "Business name updated successfully."
  );
});

// ======================================================
// 3. LIST ALL BUSINESSES
// GET /api/v1/platform/businesses
//
// Super Admin only.
//
// Supports:
// - Pagination
// - Status filtering
// - Business name search
// ======================================================

export const listPlatformBusinesses = wrap(
  async (req, res) => {
    requirePlatform(req);

    const { page, limit } = paging(req.query);

    const filter = {};

    // ==================================================
    // FILTER BY BUSINESS STATUS
    // ==================================================

    if (req.query.status) {
      const status = req.query.status;

      if (
        !ALLOWED_BUSINESS_STATUSES.includes(status)
      ) {
        throw fail(
          "Invalid business status. Allowed values: active, suspended.",
          400
        );
      }

      filter.status = status;
    }

    // ==================================================
    // SEARCH BY BUSINESS NAME
    // ==================================================

    if (req.query.search) {
      if (
        typeof req.query.search !== "string"
      ) {
        throw fail(
          "Search must be a string.",
          400
        );
      }

      const search = req.query.search.trim();

      if (search.length > 100) {
        throw fail(
          "Search cannot exceed 100 characters.",
          400
        );
      }

      if (search) {
        // Escape regex special characters.
        const escapedSearch = search.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

        filter.businessName = {
          $regex: escapedSearch,
          $options: "i",
        };
      }
    }

    // ==================================================
    // FETCH BUSINESSES
    // ==================================================

    const [items, total] = await Promise.all([
      Business.find(filter)
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Business.countDocuments(filter),
    ]);

    return send(
      res,
      {
        items: items.map(safeBusiness),

        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Businesses retrieved successfully."
    );
  }
);

// ======================================================
// 4. UPDATE BUSINESS STATUS
// PATCH /api/v1/platform/businesses/:id/status
//
// Super Admin only.
//
// Allowed statuses:
// - active
// - suspended
// ======================================================

export const setBusinessStatus = wrap(
  async (req, res) => {
    requirePlatform(req);

    const { status } = req.body || {};

    // ==================================================
    // VALIDATE STATUS
    // ==================================================

    if (
      !ALLOWED_BUSINESS_STATUSES.includes(status)
    ) {
      throw fail(
        "Please select a valid business status: active or suspended.",
        400
      );
    }

    // ==================================================
    // UPDATE BUSINESS STATUS
    // ==================================================

    const updatedBusiness =
      await Business.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!updatedBusiness) {
      throw fail(
        "Business not found.",
        404
      );
    }

    return send(
      res,
      safeBusiness(updatedBusiness),
      "Business status updated successfully."
    );
  }
);
