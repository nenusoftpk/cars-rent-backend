import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import User from "../models/User.js";
import Business from "../models/Business.js";
import Subscription from "../models/Subscription.js";

import { wrap, send, fail, paging } from "../utils/http.js";
import { requirePlatform } from "../services/scope.js";

// ======================================================
// CONSTANTS
// ======================================================

/**
 * Super-admin only fields.
 * Password is intentionally included (hash only) because this controller
 * is protected by requirePlatform / superAdminOnly.
 */
const SUPER_ADMIN_FIELDS =
  "_id businessId name email phone photo photoPublicId role permissions dataScope status " +
  "isEmailVerified emailVerifiedAt lastLoginAt password passwordChangedAt " +
  "createdBy createdAt updatedAt " +
  "+tokenVersion +failedLoginAttempts +lockUntil"; // force-select hidden fields when needed

const ALLOWED_STATUSES = ["active", "disabled"];

const ALLOWED_UPDATE_FIELDS = [
  "name",
  "email",
  "phone",
  "photo",
  "status",
  "password", // plain text → will be hashed
];

// ======================================================
// HELPERS
// ======================================================

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validId = (value, label = "ID") => {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`Invalid ${label}.`, 400);
  }
};

/**
 * Normalize a lean/document user into a consistent response shape.
 * Attaches business + subscription when present.
 */
const formatAdmin = (doc, subscription = null) => {
  if (!doc) return null;

  const value = doc.toObject ? doc.toObject() : { ...doc };

  // Ensure id is a string and businessId is normalized
  const business =
    value.businessId && typeof value.businessId === "object"
      ? {
          id: String(value.businessId._id),
          businessName: value.businessId.businessName,
          status: value.businessId.status,
        }
      : value.businessId
        ? { id: String(value.businessId) }
        : null;

  return {
    id: String(value._id),
    businessId: business?.id || null,
    business,
    name: value.name,
    email: value.email,
    phone: value.phone || "",
    photo: value.photo || "",
    role: value.role,
    permissions: value.permissions || [],
    dataScope: value.dataScope,
    status: value.status,
    isEmailVerified: value.isEmailVerified,
    emailVerifiedAt: value.emailVerifiedAt,
    lastLoginAt: value.lastLoginAt,
    passwordChangedAt: value.passwordChangedAt,
    // Password hash is only present when explicitly selected
    password: value.password || undefined,
    tokenVersion: value.tokenVersion,
    failedLoginAttempts: value.failedLoginAttempts,
    lockUntil: value.lockUntil,
    createdBy: value.createdBy ? String(value.createdBy) : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    // Attached subscription for this admin's business
    subscription: subscription
      ? {
          id: String(subscription._id),
          plan: subscription.plan,
          status: subscription.status,
          paymentStatus: subscription.paymentStatus,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          trialDays: subscription.trialDays,
          trialExtensionDays: subscription.trialExtensionDays,
          notes: subscription.notes || "",
          activatedBy: subscription.activatedBy
            ? String(subscription.activatedBy)
            : null,
          updatedBy: subscription.updatedBy
            ? String(subscription.updatedBy)
            : null,
          createdAt: subscription.createdAt,
          updatedAt: subscription.updatedAt,
        }
      : null,
  };
};

/**
 * Load subscription for a given businessId (or null).
 */
const getSubscriptionByBusinessId = async (businessId) => {
  if (!businessId) return null;
  return Subscription.findOne({ businessId }).lean();
};

/**
 * Load multiple subscriptions keyed by businessId string.
 */
const getSubscriptionsMap = async (businessIds) => {
  if (!businessIds.length) return new Map();

  const subs = await Subscription.find({
    businessId: { $in: businessIds },
  }).lean();

  const map = new Map();
  for (const sub of subs) {
    map.set(String(sub.businessId), sub);
  }
  return map;
};

// ======================================================
// 1. LIST ALL ADMINS (full details + subscription)
// GET /api/v1/platform/admins
// ======================================================

export const listPlatformAdmins = wrap(async (req, res) => {
  requirePlatform(req);

  const filter = { role: "admin" };

  // ---------- Status filter ----------
  if (req.query.status) {
    if (!ALLOWED_STATUSES.includes(req.query.status)) {
      throw fail(
        "Invalid status. Allowed values: active, disabled.",
        400
      );
    }
    filter.status = req.query.status;
  }

  // ---------- Business filter ----------
  if (req.query.businessId) {
    validId(req.query.businessId, "business ID");
    filter.businessId = req.query.businessId;
  }

  // ---------- Search (name / email / phone) ----------
  if (req.query.search?.trim()) {
    const term = new RegExp(
      escapeRegex(req.query.search.trim().slice(0, 100)),
      "i"
    );
    filter.$or = [{ name: term }, { email: term }, { phone: term }];
  }

  const { page, limit } = paging(req.query);

  const [items, total] = await Promise.all([
    User.find(filter)
      .select(SUPER_ADMIN_FIELDS) // includes password hash
      .populate("businessId", "businessName status")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Attach subscriptions in one query
  const businessIds = items
    .map((u) => u.businessId?._id || u.businessId)
    .filter(Boolean);

  const subMap = await getSubscriptionsMap(businessIds);

  const formatted = items.map((item) => {
    const bizId = item.businessId?._id || item.businessId;
    const subscription = bizId ? subMap.get(String(bizId)) || null : null;
    return formatAdmin(item, subscription);
  });

  send(
    res,
    {
      items: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Platform admins loaded successfully."
  );
});

// ======================================================
// 2. GET ONE ADMIN (deep profile + subscription + password hash)
// GET /api/v1/platform/admins/:id
// ======================================================

export const getPlatformAdmin = wrap(async (req, res) => {
  requirePlatform(req);
  validId(req.params.id, "admin ID");

  const admin = await User.findOne({
    _id: req.params.id,
    role: "admin",
  })
    .select(SUPER_ADMIN_FIELDS)
    .populate("businessId", "businessName status")
    .lean();

  if (!admin) {
    throw fail("Admin not found.", 404);
  }

  const businessId = admin.businessId?._id || admin.businessId;
  const subscription = await getSubscriptionByBusinessId(businessId);

  send(
    res,
    formatAdmin(admin, subscription),
    "Admin loaded successfully."
  );
});

// ======================================================
// 3. UPDATE ADMIN (full editable fields for super-admin)
// PATCH /api/v1/platform/admins/:id
// Body can contain: name, email, phone, photo, status, password
// ======================================================

export const updatePlatformAdmin = wrap(async (req, res) => {
  requirePlatform(req);
  validId(req.params.id, "admin ID");

  const updates = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw fail(
      "Please provide at least one field to update: name, email, phone, photo, status, or password.",
      400
    );
  }

  // ---------- Validate name ----------
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || !updates.name.trim()) {
      throw fail("Name is required.", 400);
    }
    updates.name = updates.name.trim();
    if (updates.name.length < 2 || updates.name.length > 120) {
      throw fail("Name must be between 2 and 120 characters.", 400);
    }
  }

  // ---------- Validate email ----------
  if (updates.email !== undefined) {
    if (typeof updates.email !== "string" || !updates.email.trim()) {
      throw fail("Email is required.", 400);
    }
    updates.email = updates.email.trim().toLowerCase();

    // Basic format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updates.email)) {
      throw fail("Invalid email format.", 400);
    }
    if (updates.email.length > 254) {
      throw fail("Email cannot exceed 254 characters.", 400);
    }

    // Uniqueness check (exclude current admin)
    const existing = await User.findOne({
      email: updates.email,
      _id: { $ne: req.params.id },
    })
      .select("_id")
      .lean();

    if (existing) {
      throw fail("Email is already in use by another account.", 409);
    }
  }

  // ---------- Validate phone ----------
  if (updates.phone !== undefined) {
    updates.phone = String(updates.phone || "").trim();
  }

  // ---------- Validate photo ----------
  if (updates.photo !== undefined) {
    updates.photo = String(updates.photo || "").trim();
  }

  // ---------- Validate status ----------
  if (updates.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(updates.status)) {
      throw fail(
        "Invalid status. Allowed values: active, disabled.",
        400
      );
    }
  }

  // ---------- Handle password ----------
  let passwordChanged = false;
  if (updates.password !== undefined) {
    if (typeof updates.password !== "string" || updates.password.length < 10) {
      throw fail("Password must contain at least 10 characters.", 400);
    }
    updates.password = await bcrypt.hash(updates.password, 12);
    updates.passwordChangedAt = new Date();
    // Clear any pending reset tokens + lock state
    updates.passwordResetTokenHash = null;
    updates.passwordResetExpiresAt = null;
    updates.failedLoginAttempts = 0;
    updates.lockUntil = null;
    passwordChanged = true;
  }

  const updateOps = {
    $set: updates,
  };

  // Always revoke sessions when password changes or account is disabled
  if (passwordChanged || updates.status === "disabled") {
    updateOps.$inc = { tokenVersion: 1 };
  }

  const admin = await User.findOneAndUpdate(
    {
      _id: req.params.id,
      role: "admin",
    },
    updateOps,
    {
      new: true,
      runValidators: true,
    }
  )
    .select(SUPER_ADMIN_FIELDS)
    .populate("businessId", "businessName status")
    .lean();

  if (!admin) {
    throw fail("Admin not found.", 404);
  }

  const businessId = admin.businessId?._id || admin.businessId;
  const subscription = await getSubscriptionByBusinessId(businessId);

  let message = "Admin updated successfully.";
  if (passwordChanged && updates.status === "disabled") {
    message =
      "Admin updated, password changed, and account disabled. All sessions have been revoked.";
  } else if (passwordChanged) {
    message =
      "Admin updated and password changed. All existing sessions have been revoked.";
  } else if (updates.status === "disabled") {
    message =
      "Admin disabled successfully. All sessions have been revoked.";
  }

  send(res, formatAdmin(admin, subscription), message);
});

// ======================================================
// 4. RESET ADMIN PASSWORD (dedicated endpoint)
// PATCH /api/v1/platform/admins/:id/reset-password
// ======================================================

export const resetPlatformAdminPassword = wrap(async (req, res) => {
  requirePlatform(req);
  validId(req.params.id, "admin ID");

  const { newPassword } = req.body;

  if (typeof newPassword !== "string" || newPassword.length < 10) {
    throw fail("Password must contain at least 10 characters.", 400);
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  const admin = await User.findOneAndUpdate(
    {
      _id: req.params.id,
      role: "admin",
    },
    {
      $set: {
        password: hashed,
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
      $inc: { tokenVersion: 1 },
    },
    { new: true }
  )
    .select(SUPER_ADMIN_FIELDS)
    .populate("businessId", "businessName status")
    .lean();

  if (!admin) {
    throw fail("Admin not found.", 404);
  }

  const businessId = admin.businessId?._id || admin.businessId;
  const subscription = await getSubscriptionByBusinessId(businessId);

  send(
    res,
    formatAdmin(admin, subscription),
    "Admin password has been reset. All existing sessions have been revoked."
  );
});

// ======================================================
// 5. UPDATE ADMIN STATUS ONLY
// PATCH /api/v1/platform/admins/:id/status
// ======================================================

export const setPlatformAdminStatus = wrap(async (req, res) => {
  requirePlatform(req);
  validId(req.params.id, "admin ID");

  const { status } = req.body;

  if (!ALLOWED_STATUSES.includes(status)) {
    throw fail(
      "Invalid status. Allowed values: active, disabled.",
      400
    );
  }

  const updateOps = {
    $set: { status },
  };

  if (status === "disabled") {
    updateOps.$inc = { tokenVersion: 1 };
  }

  const admin = await User.findOneAndUpdate(
    {
      _id: req.params.id,
      role: "admin",
    },
    updateOps,
    {
      new: true,
      runValidators: true,
    }
  )
    .select(SUPER_ADMIN_FIELDS)
    .populate("businessId", "businessName status")
    .lean();

  if (!admin) {
    throw fail("Admin not found.", 404);
  }

  const businessId = admin.businessId?._id || admin.businessId;
  const subscription = await getSubscriptionByBusinessId(businessId);

  send(
    res,
    formatAdmin(admin, subscription),
    status === "disabled"
      ? "Admin disabled successfully. All sessions have been revoked."
      : "Admin activated successfully."
  );
});