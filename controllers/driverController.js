// controllers/driverController.js
//
// Production-ready multi-tenant driver module.
// Architecture aligned with customerController.js
//
// Accounting rules:
//   totalEarned  = sum of driverPaymentAmount on NON-cancelled bookings
//                  (uses the snapshot stored on the booking – never recalculates
//                   historical earnings with the driver's current rate)
//   totalPaid    = sum of Expense.amount where category = "driver_payment"
//   totalPending = max(0, totalEarned - totalPaid)
//
// Own-scope employees only see drivers that appear on their own bookings.
// Admins see every driver in the business.

import mongoose from "mongoose";

import Driver from "../models/Driver.js";
import Booking from "../models/Booking.js";
import Expense from "../models/Expense.js";

import { wrap, send, fail, paging } from "../utils/http.js";
import { tenantOnly, scope } from "../services/scope.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";



// ======================================================
// CONSTANTS
// ======================================================

const DRIVER_STATUSES = ["available", "assigned", "inactive"];
const PAYMENT_TYPES = ["fixed", "percentage"];
const BOOKING_STATUSES = ["reserved", "on_rent", "completed", "cancelled"];
const RECENT_LIMIT = 30;

const SENSITIVE_FIELDS = [
  "cnic",
  "cnicFront",
  "cnicBack",
  "licenseNumber",
  "licenseImage",
  "licenseExpiry",
];

const ALLOWED_WRITE_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  // photo, cnicFront, cnicBack, licenseImage REMOVED
  "cnic",
  "licenseNumber",
  "licenseExpiry",
  "salary",
  "paymentType",
  "paymentRate",
  "status",
];

// ======================================================
// HELPERS
// ======================================================

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const id = (value) => String(value?._id || value || "");
const validId = (value) => mongoose.isValidObjectId(value);

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isOwnEmployee = (req) =>
  req.tenant?.role === "employee" && req.tenant?.dataScope === "own";

const canViewSensitive = (req) => {
  if (req.tenant?.role === "admin") return true;
  const perms = req.user?.permissions || [];
  return (
    perms.includes("drivers.documents.view") ||
    perms.includes("sensitive.view") ||
    perms.includes("sensitive:view")
  );
};

const canEditSensitive = (req) => {
  if (req.tenant?.role === "admin") return true;
  const perms = req.user?.permissions || [];
  return (
    perms.includes("drivers.create") ||
    perms.includes("drivers.update") ||
    perms.includes("sensitive.edit") ||
    perms.includes("sensitive:edit")
  );
};

const hasSensitiveFiles = (req) => {
  const files = req.files || {};
  return Boolean(
    files.cnicFront?.[0] ||
    files.cnicBack?.[0] ||
    files.licenseImage?.[0]
  );
};

const maskCnic = (value) => {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 13) return "*****-*******-*";
  return `${digits.slice(0, 2)}***-*******-${digits.slice(-1)}`;
};

// ======================================================
// VISIBILITY (own-scope employees see only drivers on their bookings)
// ======================================================

const getVisibleDriverIds = async (req) => {
  if (!isOwnEmployee(req)) return null;

  return Booking.distinct("driverId", {
    ...tenantOnly(req),
    employeeId: req.tenant.userId,
    driverId: { $ne: null },
  });
};

const driverScopeFilter = async (req) => {
  const filter = { ...tenantOnly(req) };
  const visibleIds = await getVisibleDriverIds(req);

  if (visibleIds !== null) {
    filter._id = { $in: visibleIds };
  }
  return filter;
};

const findDriver = async (req, driverId) => {
  if (!validId(driverId)) throw fail("Invalid driver ID.", 400);

  const filter = await driverScopeFilter(req);
  const driver = await Driver.findOne({ ...filter, _id: driverId });

  if (!driver) throw fail("Driver not found or access denied.", 404);
  return driver;
};

const bookingScopeFilter = (req, driverId) => {
  const filter = {
    ...tenantOnly(req),
    driverId,
  };
  if (isOwnEmployee(req)) {
    filter.employeeId = req.tenant.userId;
  }
  return filter;
};

// ======================================================
// PAYLOAD & VALIDATION
// ======================================================

const normalizePayload = (body = {}) => {
  const data = { ...body };

  // Frontend aliases
  if (data.mobile !== undefined) data.phone = data.mobile;
  if (data.licenseNo !== undefined) data.licenseNumber = data.licenseNo;

  // Frontend status labels → database values
  if (data.status === "Active") data.status = "available";
  if (data.status === "Inactive") data.status = "inactive";

  // Never trust these from the client
  delete data.businessId;
  delete data.createdBy;
  delete data._id;
  delete data.id;
  delete data.mobile;
  delete data.licenseNo;

  const result = {};
  for (const field of ALLOWED_WRITE_FIELDS) {
    if (data[field] !== undefined) result[field] = data[field];
  }
  return result;
};

const validatePaymentSettings = (data, existing = {}) => {
  const type = data.paymentType ?? existing.paymentType ?? "fixed";
  const rate = Number(data.paymentRate ?? existing.paymentRate ?? 0);

  if (!PAYMENT_TYPES.includes(type)) {
    throw fail("Invalid driver payment type. Allowed: fixed, percentage.", 400);
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw fail("Driver payment rate must be zero or greater.", 400);
  }
  if (type === "percentage" && rate > 100) {
    throw fail("Driver percentage cannot exceed 100%.", 400);
  }
};

const assertSensitiveWrite = (req, data) => {
  if (
    !canEditSensitive(req) &&
    SENSITIVE_FIELDS.some((f) => data[f] !== undefined)
  ) {
    throw fail(
      "You do not have permission to change sensitive driver information.",
      403
    );
  }
};

// ======================================================
// FINANCIAL SUMMARY (DB-level, uses snapshot amounts)
// ======================================================

const getDriverFinancials = async (req, driverId) => {
  const filter = bookingScopeFilter(req, driverId);

  const [bookingAgg, expenseAgg] = await Promise.all([
    Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalBookings: {
            $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, 1, 0] },
          },
          completedBookings: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          activeBookings: {
            $sum: {
              $cond: [{ $in: ["$status", ["reserved", "on_rent"]] }, 1, 0],
            },
          },
          totalEarnedCents: {
            $sum: {
              $cond: [
                { $eq: ["$status", "cancelled"] },
                0,
                {
                  $round: [
                    { $multiply: [{ $ifNull: ["$driverPaymentAmount", 0] }, 100] },
                    0,
                  ],
                },
              ],
            },
          },
        },
      },
    ]),

    Expense.aggregate([
      {
        $match: {
          ...tenantOnly(req),
          driverId: new mongoose.Types.ObjectId(driverId),
          category: "driver_payment",
        },
      },
      {
        $group: {
          _id: null,
          totalPaidCents: {
            $sum: {
              $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0],
            },
          },
        },
      },
    ]),
  ]);

  const earnedCents = bookingAgg[0]?.totalEarnedCents || 0;
  const paidCents = expenseAgg[0]?.totalPaidCents || 0;

  return {
    totalBookings: bookingAgg[0]?.totalBookings || 0,
    completedBookings: bookingAgg[0]?.completedBookings || 0,
    activeBookings: bookingAgg[0]?.activeBookings || 0,
    totalEarned: money(earnedCents / 100),
    totalPaid: money(paidCents / 100),
    totalPending: money(Math.max(0, (earnedCents - paidCents) / 100)),
  };
};

// ======================================================
// RESPONSE DTO
// ======================================================

const formatDriver = (driver, financials = null, req = null) => {
  const d = driver?.toObject ? driver.toObject() : { ...driver };
  const sensitive = req ? canViewSensitive(req) : true;

  const statusLabels = {
    available: "Active",
    assigned: "Active",
    inactive: "Inactive",
  };

  const dto = {
    id: id(d._id),
    name: d.name || "",
    phone: d.phone || "",
    mobile: d.phone || "",
    email: d.email || "",
    address: d.address || "",
    photo: d.photo || "",
    status: statusLabels[d.status] || "Inactive",
    rawStatus: d.status || "available",
    salary: money(d.salary),
    paymentType: d.paymentType || "fixed",
    paymentRate: money(d.paymentRate),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    locked: !sensitive,
  };

  if (sensitive) {
    dto.cnic = d.cnic || "";
    dto.cnicFront = d.cnicFront || "";
    dto.cnicBack = d.cnicBack || "";
    dto.licenseNumber = d.licenseNumber || "";
    dto.licenseNo = d.licenseNumber || "";
    dto.licenseImage = d.licenseImage || "";
    dto.licenseExpiry = d.licenseExpiry || null;
  } else {
    dto.cnic = maskCnic(d.cnic);
    dto.licenseNo = "";
  }

  if (financials) {
    Object.assign(dto, financials);
  }

  return dto;
};

// ======================================================
// LICENCE EXPIRY REMINDERS
// ======================================================

/**
 * Safe to import from dashboardController.
 * Returns [] when the caller cannot view sensitive data.
 */
export async function collectDriverReminders(req, daysBefore) {
  if (!canViewSensitive(req)) return [];

  let horizonDays = 7;
  if (daysBefore !== undefined && daysBefore !== null && Number.isFinite(Number(daysBefore))) {
    horizonDays = Math.max(1, Math.min(90, Math.floor(Number(daysBefore))));
  }

  let timezone = "Asia/Karachi";
  try {
    const Setting = mongoose.models.Setting;
    if (Setting) {
      const setting = await Setting.findOne({
        businessId: req.tenant?.businessId,
      })
        .select("reminderDaysBefore timezone")
        .lean();

      if (setting) {
        if (
          (daysBefore === undefined || daysBefore === null) &&
          Number.isFinite(Number(setting.reminderDaysBefore))
        ) {
          horizonDays = Math.max(1, Math.min(90, Math.floor(Number(setting.reminderDaysBefore))));
        }
        if (setting.timezone) timezone = setting.timezone;
      }
    }
  } catch {
    // Setting model may not be registered yet
  }

  const toLocalDateKey = (date) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  };

  const todayKey = toLocalDateKey(new Date());
  const todayStart = new Date(`${todayKey}T00:00:00`);

  const filter = await driverScopeFilter(req);
  filter.licenseExpiry = { $ne: null, $exists: true };
  filter.status = { $ne: "inactive" };

  const drivers = await Driver.find(filter)
    .select("_id name licenseExpiry")
    .lean();

  const reminders = [];
  const seen = new Set();

  for (const driver of drivers) {
    const expiry = new Date(driver.licenseExpiry);
    if (Number.isNaN(expiry.getTime())) continue;

    const expiryKey = toLocalDateKey(expiry);
    const expiryStart = new Date(`${expiryKey}T00:00:00`);
    const daysRemaining = Math.round(
      (expiryStart.getTime() - todayStart.getTime()) / 86400000
    );

    if (daysRemaining > horizonDays) continue;

    let category, priority;
    if (daysRemaining < 0) {
      category = "overdue";
      priority = "high";
    } else if (daysRemaining <= 1) {
      category = "due_soon";
      priority = "high";
    } else if (daysRemaining <= 3) {
      category = "due_soon";
      priority = "medium";
    } else {
      category = "upcoming";
      priority = "low";
    }

    const driverId = String(driver._id);
    const reminderId = `driver-${driverId}-license-${expiryKey}`;
    if (seen.has(reminderId)) continue;
    seen.add(reminderId);

    const abs = Math.abs(daysRemaining);
    const message =
      daysRemaining < 0
        ? `Driving licence for driver ${driver.name} expired ${abs} day${abs === 1 ? "" : "s"} ago.`
        : daysRemaining === 0
          ? `Driving licence for driver ${driver.name} expires today.`
          : `Driving licence for driver ${driver.name} expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;

    reminders.push({
      id: reminderId,
      driverId,
      driverName: driver.name || "",
      type: "driver_license_expiry",
      source: "driver",
      message,
      dueDate: expiryStart,
      daysRemaining,
      priority,
      category,
    });
  }

  const categoryOrder = { overdue: 0, due_soon: 1, upcoming: 2 };
  reminders.sort(
    (a, b) =>
      (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9) ||
      new Date(a.dueDate) - new Date(b.dueDate)
  );

  return reminders;
}

// ======================================================
// 1. LIST DRIVERS
// ======================================================

export const listDrivers = wrap(async (req, res) => {
  const filter = await driverScopeFilter(req);
  const { search, status, paymentType } = req.query;

  if (status) {
    if (status === "Active") {
      filter.status = { $in: ["available", "assigned"] };
    } else if (status === "Inactive") {
      filter.status = "inactive";
    } else if (DRIVER_STATUSES.includes(status)) {
      filter.status = status;
    } else {
      throw fail("Invalid status filter.", 400);
    }
  }

  if (paymentType) {
    if (!PAYMENT_TYPES.includes(paymentType)) {
      throw fail("Invalid payment type filter.", 400);
    }
    filter.paymentType = paymentType;
  }

  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim().slice(0, 80)), "i");
    const fields = ["name", "phone", "email"];
    if (canViewSensitive(req)) {
      fields.push("cnic", "licenseNumber");
    }
    filter.$or = fields.map((f) => ({ [f]: regex }));
  }

  const { page, limit } = paging(req.query);

  const [drivers, total] = await Promise.all([
    Driver.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Driver.countDocuments(filter),
  ]);

  send(res, {
    items: drivers.map((d) => formatDriver(d, null, req)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  });
});

// ======================================================
// 2. DRIVER STATISTICS
// ======================================================

export const getDriverStats = wrap(async (req, res) => {
  const filter = await driverScopeFilter(req);

  const [total, available, assigned, inactive] = await Promise.all([
    Driver.countDocuments(filter),
    Driver.countDocuments({ ...filter, status: "available" }),
    Driver.countDocuments({ ...filter, status: "assigned" }),
    Driver.countDocuments({ ...filter, status: "inactive" }),
  ]);

  send(res, {
    total,
    available,
    assigned,
    inactive,
    active: available + assigned,
  });
});

// ======================================================
// 3. AVAILABLE DRIVERS (with optional date range)
// ======================================================

export const getAvailableDrivers = wrap(async (req, res) => {
  const filter = await driverScopeFilter(req);
  filter.status = { $ne: "inactive" };

  const { pickupDate, returnDate } = req.query;

  if (Boolean(pickupDate) !== Boolean(returnDate)) {
    throw fail("Both pickup and return dates are required for availability check.", 400);
  }

  if (pickupDate && returnDate) {
    const start = new Date(pickupDate);
    const end = new Date(returnDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw fail("Enter valid pickup and return dates.", 400);
    }

    // Business-wide busy check (even for own-scope employees)
    const busyIds = await Booking.distinct("driverId", {
      ...tenantOnly(req),
      driverId: { $ne: null },
      status: { $in: ["reserved", "on_rent"] },
      pickupDate: { $lt: end },
      returnDate: { $gt: start },
    });

    filter._id = filter._id
      ? { $in: filter._id.$in, $nin: busyIds }
      : { $nin: busyIds };
  } else {
    // No dates → only currently available drivers
    filter.status = "available";
  }

  const drivers = await Driver.find(filter)
    .sort({ name: 1 })
    .lean();

  send(
    res,
    drivers.map((d) => formatDriver(d, null, req)),
    "Available drivers loaded successfully."
  );
});

// ======================================================
// 4. GET SINGLE DRIVER
// ======================================================

export const getDriver = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);
  const financials = await getDriverFinancials(req, driver._id);

  send(res, formatDriver(driver, financials, req));
});

// ======================================================
// 5. CREATE DRIVER
// ======================================================

export const createDriver = wrap(async (req, res) => {
  const data = normalizePayload(req.body);

  if (!data.name?.trim()) throw fail("Driver name is required.", 400);
  if (!data.phone?.trim()) throw fail("Driver phone number is required.", 400);

  validatePaymentSettings(data);

  // Check both body fields and uploaded files
  if (
    !canEditSensitive(req) &&
    (SENSITIVE_FIELDS.some((f) => data[f] !== undefined) || hasSensitiveFiles(req))
  ) {
    throw fail(
      "You do not have permission to change sensitive driver information.",
      403
    );
  }

  if (data.cnic) {
    const exists = await Driver.exists({
      ...tenantOnly(req),
      cnic: data.cnic,
    });
    if (exists) throw fail("A driver with this CNIC already exists.", 409);
  }

  const uploadedPublicIds = [];
  const folder = `rent-a-car/${req.tenant.businessId}/drivers`;

  try {
    const files = req.files || {};

    const uploadOne = async (fieldName) => {
      const file = files[fieldName]?.[0];
      if (!file) return null;

      const result = await uploadToCloudinary(file.buffer, folder, "image", false);
      uploadedPublicIds.push(result.public_id);
      return result;
    };

    // Sequential uploads for reliable cleanup
    const photoResult = await uploadOne("photo");
    const cnicFrontResult = await uploadOne("cnicFront");
    const cnicBackResult = await uploadOne("cnicBack");
    const licenseResult = await uploadOne("licenseImage");

    if (photoResult) {
      data.photo = photoResult.secure_url;
      data.photoPublicId = photoResult.public_id;
    }
    if (cnicFrontResult) {
      data.cnicFront = cnicFrontResult.secure_url;
      data.cnicFrontPublicId = cnicFrontResult.public_id;
    }
    if (cnicBackResult) {
      data.cnicBack = cnicBackResult.secure_url;
      data.cnicBackPublicId = cnicBackResult.public_id;
    }
    if (licenseResult) {
      data.licenseImage = licenseResult.secure_url;
      data.licenseImagePublicId = licenseResult.public_id;
    }

    const driver = await Driver.create({
      ...data,
      ...tenantOnly(req),
      createdBy: req.tenant.userId,
    });

    send(res, formatDriver(driver, null, req), "Driver created successfully.", 201);
  } catch (err) {
    // Clean up only on failure
    if (uploadedPublicIds.length) {
      await Promise.allSettled(
        uploadedPublicIds.map((id) => deleteFromCloudinary(id, "image", "upload"))
      );
    }

    if (err?.code === 11000) {
      throw fail("A driver with this information already exists.", 409);
    }
    throw err;
  }
});

// ======================================================
// 6. UPDATE DRIVER
// ======================================================

export const updateDriver = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);
  const data = normalizePayload(req.body);

  const hasFiles = Object.values(req.files || {}).some(
    (files) => Array.isArray(files) && files.length > 0
  );

  if (!Object.keys(data).length && !hasFiles) {
    throw fail("Please provide fields to update.", 400);
  }

  if (data.status === "assigned") {
    throw fail("Assigned status is managed automatically by the booking workflow.", 400);
  }

  validatePaymentSettings(data, driver);

  // Check both body fields and uploaded files
  if (
    !canEditSensitive(req) &&
    (SENSITIVE_FIELDS.some((f) => data[f] !== undefined) || hasSensitiveFiles(req))
  ) {
    throw fail(
      "You do not have permission to change sensitive driver information.",
      403
    );
  }

  if (data.status === "available" || data.status === "inactive") {
    const active = await Booking.exists({
      ...tenantOnly(req),
      driverId: driver._id,
      status: "on_rent",
    });
    if (active) {
      throw fail(
        "This driver has an active rental. Complete the rental before changing status.",
        409
      );
    }
  }

  if (data.cnic && data.cnic !== driver.cnic) {
    const exists = await Driver.exists({
      ...tenantOnly(req),
      _id: { $ne: driver._id },
      cnic: data.cnic,
    });
    if (exists) throw fail("Another driver already has this CNIC.", 409);
  }

  // Load publicIds for old image cleanup
  const existing = await Driver.findById(driver._id).select(
    "+photoPublicId +cnicFrontPublicId +cnicBackPublicId +licenseImagePublicId"
  );

  const uploadedPublicIds = [];
  const oldPublicIdsToDelete = [];
  const folder = `rent-a-car/${req.tenant.businessId}/drivers`;

  try {
    const files = req.files || {};

    const uploadOne = async (fieldName, oldPublicIdField) => {
      const file = files[fieldName]?.[0];
      if (!file) return null;

      const result = await uploadToCloudinary(file.buffer, folder, "image", false);
      uploadedPublicIds.push(result.public_id);

      if (existing[oldPublicIdField]) {
        oldPublicIdsToDelete.push(existing[oldPublicIdField]);
      }
      return result;
    };

    // Sequential uploads
    const photoResult = await uploadOne("photo", "photoPublicId");
    const cnicFrontResult = await uploadOne("cnicFront", "cnicFrontPublicId");
    const cnicBackResult = await uploadOne("cnicBack", "cnicBackPublicId");
    const licenseResult = await uploadOne("licenseImage", "licenseImagePublicId");

    if (photoResult) {
      data.photo = photoResult.secure_url;
      data.photoPublicId = photoResult.public_id;
    }
    if (cnicFrontResult) {
      data.cnicFront = cnicFrontResult.secure_url;
      data.cnicFrontPublicId = cnicFrontResult.public_id;
    }
    if (cnicBackResult) {
      data.cnicBack = cnicBackResult.secure_url;
      data.cnicBackPublicId = cnicBackResult.public_id;
    }
    if (licenseResult) {
      data.licenseImage = licenseResult.secure_url;
      data.licenseImagePublicId = licenseResult.public_id;
    }

    Object.assign(driver, data);
    await driver.save();

    // DB succeeded → delete OLD images only
    if (oldPublicIdsToDelete.length) {
      await Promise.allSettled(
        oldPublicIdsToDelete.map((id) =>
          deleteFromCloudinary(id, "image", "upload")
        )
      );
    }

    const financials = await getDriverFinancials(req, driver._id);
    send(res, formatDriver(driver, financials, req), "Driver updated successfully.");
  } catch (err) {
    // Clean up NEW uploads only on failure
    if (uploadedPublicIds.length) {
      await Promise.allSettled(
        uploadedPublicIds.map((id) =>
          deleteFromCloudinary(id, "image", "upload")
        )
      );
    }

    if (err.name === "VersionError") {
      throw fail(
        "This driver was updated by someone else. Please refresh and try again.",
        409
      );
    }
    throw err;
  }
});

// ======================================================
// 7. DELETE DRIVER
// ======================================================

export const deleteDriver = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);

  // Load publicIds
  const fullDriver = await Driver.findById(driver._id).select(
    "+photoPublicId +cnicFrontPublicId +cnicBackPublicId +licenseImagePublicId"
  );

  const [hasBookings, hasPayments] = await Promise.all([
    Booking.exists({ ...tenantOnly(req), driverId: driver._id }),
    Expense.exists({
      ...tenantOnly(req),
      driverId: driver._id,
      category: "driver_payment",
    }),
  ]);

  if (hasBookings || hasPayments) {
    throw fail(
      "This driver has booking or payment history. Mark the driver inactive instead of deleting.",
      409
    );
  }

  await driver.deleteOne();

  // Clean up Cloudinary images after successful deletion
  const publicIds = [
    fullDriver.photoPublicId,
    fullDriver.cnicFrontPublicId,
    fullDriver.cnicBackPublicId,
    fullDriver.licenseImagePublicId,
  ].filter(Boolean);

  if (publicIds.length) {
    await Promise.allSettled(
      publicIds.map((id) => deleteFromCloudinary(id, "image", "upload"))
    );
  }

  send(res, { id: id(driver._id) }, "Driver deleted successfully.");
});

// ======================================================
// 8. DRIVER BOOKING HISTORY
// ======================================================

export const getDriverBookings = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);
  const filter = bookingScopeFilter(req, driver._id);

  if (req.query.status) {
    const status = String(req.query.status).toLowerCase();
    if (!BOOKING_STATUSES.includes(status)) {
      throw fail("Invalid booking status filter.", 400);
    }
    filter.status = status;
  }

  const { page, limit } = paging(req.query);

  const [bookings, total, financials] = await Promise.all([
    Booking.find(filter)
      .select(
        "bookingNumber invoiceNumber carId customerId pickupDate returnDate status totalAmount driverPaymentAmount"
      )
      .populate("carId", "name numberPlate")
      .populate("customerId", "name phone")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
    getDriverFinancials(req, driver._id),
  ]);

  const items = bookings.map((b) => ({
    id: id(b._id),
    bookingNumber: b.bookingNumber || "",
    invoiceNumber: b.invoiceNumber || "",
    customerName: b.customerId?.name || "",
    customerPhone: b.customerId?.phone || "",
    carName: b.carId?.name || "",
    carPlate: b.carId?.numberPlate || "",
    pickupDate: b.pickupDate,
    returnDate: b.returnDate,
    status: b.status,
    bookingTotal: money(b.totalAmount),
    payable: b.status === "cancelled" ? 0 : money(b.driverPaymentAmount),
  }));

  send(res, {
    driver: formatDriver(driver, null, req),
    summary: financials,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  });
});

// ======================================================
// 9. DRIVER PAYMENT HISTORY
// ======================================================

export const getDriverPayments = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);
  const { page, limit } = paging(req.query);

  const filter = {
    ...tenantOnly(req),
    driverId: driver._id,
    category: "driver_payment",
  };

  // Simple date filter (no timezone helper assumed here)
  if (req.query.from) {
    const start = new Date(req.query.from);
    if (Number.isNaN(start.getTime())) throw fail("Invalid start date.", 400);
    filter.expenseDate = { ...(filter.expenseDate || {}), $gte: start };
  }
  if (req.query.to) {
    const end = new Date(req.query.to);
    if (Number.isNaN(end.getTime())) throw fail("Invalid end date.", 400);
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      end.setUTCDate(end.getUTCDate() + 1);
      filter.expenseDate = { ...(filter.expenseDate || {}), $lt: end };
    } else {
      filter.expenseDate = { ...(filter.expenseDate || {}), $lte: end };
    }
  }

  const [expenses, total, financials] = await Promise.all([
    Expense.find(filter)
      .sort({ expenseDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Expense.countDocuments(filter),
    getDriverFinancials(req, driver._id),
  ]);

  const items = expenses.map((e) => ({
    id: id(e._id),
    bookingId: e.bookingId ? id(e.bookingId) : null,
    amount: money(e.amount),
    title: e.title || "Driver Payment",
    paymentMethod: e.paymentMethod || "cash",
    paymentDate: e.expenseDate || e.createdAt,
    description: e.description || "",
  }));

  send(res, {
    driver: formatDriver(driver, null, req),
    summary: {
      totalEarned: financials.totalEarned,
      totalPaid: financials.totalPaid,
      totalPending: financials.totalPending,
    },
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  });
});

// ======================================================
// 10. DRIVER OVERVIEW
// ======================================================

export const getDriverOverview = wrap(async (req, res) => {
  const driver = await findDriver(req, req.params.id);
  const financials = await getDriverFinancials(req, driver._id);

  const bookingFilter = bookingScopeFilter(req, driver._id);

  const [recentBookings, recentPayments] = await Promise.all([
    Booking.find(bookingFilter)
      .select(
        "bookingNumber invoiceNumber carId customerId pickupDate returnDate status totalAmount driverPaymentAmount"
      )
      .populate("carId", "name numberPlate")
      .populate("customerId", "name phone")
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .lean(),

    Expense.find({
      ...tenantOnly(req),
      driverId: driver._id,
      category: "driver_payment",
    })
      .sort({ expenseDate: -1 })
      .limit(RECENT_LIMIT)
      .lean(),
  ]);

  send(res, {
    driver: formatDriver(driver, financials, req),
    summary: financials,
    bookings: recentBookings.map((b) => ({
      id: id(b._id),
      bookingNumber: b.bookingNumber || "",
      customerName: b.customerId?.name || "",
      carName: b.carId?.name || "",
      carPlate: b.carId?.numberPlate || "",
      pickupDate: b.pickupDate,
      returnDate: b.returnDate,
      status: b.status,
      payable: b.status === "cancelled" ? 0 : money(b.driverPaymentAmount),
    })),
    payments: recentPayments.map((e) => ({
      id: id(e._id),
      amount: money(e.amount),
      title: e.title || "Driver Payment",
      paymentMethod: e.paymentMethod || "cash",
      paymentDate: e.expenseDate || e.createdAt,
    })),
    bookingsTruncated: recentBookings.length >= RECENT_LIMIT,
    paymentsTruncated: recentPayments.length >= RECENT_LIMIT,
  });
});