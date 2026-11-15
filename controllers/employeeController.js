import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import {
  ALLOWED_PERMISSIONS,
  DEFAULT_EMPLOYEE_PERMISSIONS,
} from "../config/defaultPermissions.js";
import { wrap, send, fail, paging } from "../utils/http.js";
import { tenantOnly, requireAdmin } from "../services/scope.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// Never expose internal authentication and recovery fields.
const PUBLIC_FIELDS =
  "_id businessId name email phone photo role permissions dataScope status createdBy isEmailVerified emailVerifiedAt lastLoginAt createdAt updatedAt";

const employeeFilter = (req, employeeId) => ({
  ...tenantOnly(req),
  role: "employee",
  ...(employeeId ? { _id: employeeId } : {}),
});

const assertAdmin = (req) => requireAdmin(req);

const validId = (value) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw fail("Invalid employee ID.", 400);
  }
};

const safe = (doc) => {
  const value = doc?.toObject ? doc.toObject() : doc;
  return value ? { ...value, id: String(value._id) } : null;
};

const escapeRegex = (s) =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validatePermissions = (permissions) => {
  if (
    !Array.isArray(permissions) ||
    new Set(permissions).size !== permissions.length ||
    !permissions.every((p) => ALLOWED_PERMISSIONS.includes(p))
  ) {
    throw fail("Invalid or duplicate employee permissions.", 400);
  }
};

// ======================================================
// LIST EMPLOYEES
// ======================================================

export const listEmployees = wrap(async (req, res) => {
  assertAdmin(req);

  const filter = employeeFilter(req);
  const status = req.query.status;

  if (status && !["active", "disabled"].includes(status)) {
    throw fail("Invalid employee status.", 400);
  }
  if (status) filter.status = status;

  if (req.query.dataScope) {
    if (!["own", "business"].includes(req.query.dataScope)) {
      throw fail("Invalid data scope.", 400);
    }
    filter.dataScope = req.query.dataScope;
  }

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
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  send(
    res,
    {
      items: items.map(safe),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
    "Employees loaded successfully."
  );
});

// ======================================================
// GET ONE EMPLOYEE
// ======================================================

export const getEmployee = wrap(async (req, res) => {
  assertAdmin(req);
  validId(req.params.id);

  const employee = await User.findOne(
    employeeFilter(req, req.params.id)
  )
    .select(PUBLIC_FIELDS)
    .lean();

  if (!employee) {
    throw fail("Employee not found or access denied.", 404);
  }

  send(res, safe(employee), "Employee loaded successfully.");
});

// ======================================================
// GET ALLOWED PERMISSIONS (for UI)
// ======================================================

export const getEmployeePermissions = wrap(async (req, res) => {
  assertAdmin(req);

  send(res, {
    allowedPermissions: [...ALLOWED_PERMISSIONS],
    defaultEmployeePermissions: [...DEFAULT_EMPLOYEE_PERMISSIONS],
    dataScopes: ["own", "business"],
  });
});

// ======================================================
// CREATE EMPLOYEE (JSON or multipart with avatar)
// ======================================================

export const createEmployee = wrap(async (req, res) => {
  assertAdmin(req);

  const {
    name,
    email,
    phone = "",
    password,
    permissions = [...DEFAULT_EMPLOYEE_PERMISSIONS],
    dataScope = "own",
  } = req.body;

  validatePermissions(permissions);

  if (!["own", "business"].includes(dataScope)) {
    throw fail("Invalid data scope.", 400);
  }

  if (typeof password !== "string" || password.length < 10) {
    throw fail("Password must contain at least 10 characters.", 400);
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // Global unique email index (same as Auth / employees).
  if (await User.exists({ email: normalizedEmail })) {
    throw fail("This email address is already registered.", 409);
  }

  const avatarFile = req.file;
  const businessId = req.tenant.businessId;

  let uploadedPhoto = null;

  // ================================================
  // UPLOAD PROFILE IMAGE (same folder convention as Auth)
  // ================================================
  if (avatarFile) {
    uploadedPhoto = await uploadToCloudinary(
      avatarFile.buffer,
      `rent-a-car/${businessId}/profile`,
      "image",
      false
    );
  }

  let employee;

  try {
    employee = await User.create({
      name,
      email: normalizedEmail,
      phone,
      photo: uploadedPhoto?.secure_url || "",
      photoPublicId: uploadedPhoto?.public_id || "",
      password: await bcrypt.hash(password, 12),
      ...tenantOnly(req),
      role: "employee",
      status: "active",
      createdBy: req.tenant.userId,
      permissions,
      dataScope,
    });
  } catch (error) {
    // Clean up the newly uploaded image if DB create fails.
    if (uploadedPhoto?.public_id) {
      try {
        await deleteFromCloudinary(
          uploadedPhoto.public_id,
          "image",
          "upload"
        );
      } catch (cleanupError) {
        console.error(
          "Employee create image cleanup failed:",
          cleanupError
        );
      }
    }
    throw error;
  }

  const result = await User.findById(employee._id)
    .select(PUBLIC_FIELDS)
    .lean();

  send(res, safe(result), "Employee added successfully.", 201);
});

// ======================================================
// UPDATE EMPLOYEE (name, phone, and/or avatar)
// ======================================================

export const updateEmployee = wrap(async (req, res) => {
  assertAdmin(req);
  validId(req.params.id);

  const avatarFile = req.file;
  const changes = {};

  for (const key of ["name", "phone"]) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      changes[key] = req.body[key];
    }
  }

  // Allow image-only updates (no body fields).
  if (Object.keys(changes).length === 0 && !avatarFile) {
    throw fail("Provide employee details to update.", 400);
  }

  // Load current employee (with photoPublicId) under tenant isolation.
  const employee = await User.findOne(
    employeeFilter(req, req.params.id)
  ).select("+photoPublicId");

  if (!employee) {
    throw fail("Employee not found or access denied.", 404);
  }

  const oldPhotoPublicId = employee.photoPublicId || "";
  let uploadedPhoto = null;

  // ================================================
  // UPLOAD NEW PROFILE IMAGE
  // ================================================
  if (avatarFile) {
    uploadedPhoto = await uploadToCloudinary(
      avatarFile.buffer,
      `rent-a-car/${employee.businessId}/profile`,
      "image",
      false
    );
  }

  // ================================================
  // SAVE CHANGES
  // ================================================
  try {
    Object.assign(employee, changes);

    if (uploadedPhoto) {
      employee.photo = uploadedPhoto.secure_url;
      employee.photoPublicId = uploadedPhoto.public_id;
    }

    await employee.save();
  } catch (error) {
    // DB failed → delete only the newly uploaded image.
    // Never delete the previous image.
    if (uploadedPhoto?.public_id) {
      try {
        await deleteFromCloudinary(
          uploadedPhoto.public_id,
          "image",
          "upload"
        );
      } catch (cleanupError) {
        console.error(
          "Employee update new image cleanup failed:",
          cleanupError
        );
      }
    }
    throw error;
  }

  // ================================================
  // DELETE PREVIOUS IMAGE (only after successful save)
  // ================================================
  if (uploadedPhoto && oldPhotoPublicId) {
    try {
      await deleteFromCloudinary(
        oldPhotoPublicId,
        "image",
        "upload"
      );
    } catch (error) {
      // Log only – do not roll back the successful employee update.
      console.error(
        "Old employee profile image deletion failed:",
        error
      );
    }
  }

  // Return public fields only (no photoPublicId).
  const result = await User.findById(employee._id)
    .select(PUBLIC_FIELDS)
    .lean();

  send(res, safe(result), "Employee updated successfully.");
});

// ======================================================
// UPDATE EMPLOYEE PERMISSIONS + DATA SCOPE
// ======================================================

export const updateEmployeePermissions = wrap(async (req, res) => {
  assertAdmin(req);
  validId(req.params.id);

  const { permissions, dataScope } = req.body;

  validatePermissions(permissions);

  if (!["own", "business"].includes(dataScope)) {
    throw fail("Invalid data scope.", 400);
  }

  const employee = await User.findOneAndUpdate(
    employeeFilter(req, req.params.id),
    { $set: { permissions, dataScope } },
    { new: true, runValidators: true }
  )
    .select(PUBLIC_FIELDS)
    .lean();

  if (!employee) {
    throw fail("Employee not found or access denied.", 404);
  }

  send(
    res,
    safe(employee),
    "Employee permissions updated successfully."
  );
});

// ======================================================
// UPDATE EMPLOYEE STATUS (active / disabled)
// ======================================================

export const updateEmployeeStatus = wrap(async (req, res) => {
  assertAdmin(req);
  validId(req.params.id);

  const { status } = req.body;

  if (!["active", "disabled"].includes(status)) {
    throw fail("Invalid employee status.", 400);
  }

  // Invalidate previously issued tokens when disabling.
  const employee = await User.findOneAndUpdate(
    employeeFilter(req, req.params.id),
    {
      $set: { status },
      ...(status === "disabled" ? { $inc: { tokenVersion: 1 } } : {}),
    },
    { new: true, runValidators: true }
  )
    .select(PUBLIC_FIELDS)
    .lean();

  if (!employee) {
    throw fail("Employee not found or access denied.", 404);
  }

  send(
    res,
    safe(employee),
    status === "disabled"
      ? "Employee disabled successfully."
      : "Employee activated successfully."
  );
});

// ======================================================
// RESET EMPLOYEE PASSWORD (admin action)
// ======================================================

export const resetEmployeePassword = wrap(async (req, res) => {
  assertAdmin(req);
  validId(req.params.id);

  const { newPassword } = req.body;

  if (typeof newPassword !== "string" || newPassword.length < 10) {
    throw fail("Password must contain at least 10 characters.", 400);
  }

  const employee = await User.findOneAndUpdate(
    employeeFilter(req, req.params.id),
    {
      $set: {
        password: await bcrypt.hash(newPassword, 12),
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
      $inc: { tokenVersion: 1 },
    },
    { new: true, runValidators: true }
  )
    .select("_id")
    .lean();

  if (!employee) {
    throw fail("Employee not found or access denied.", 404);
  }

  send(
    res,
    null,
    "Employee password reset. All existing sessions have been revoked."
  );
});