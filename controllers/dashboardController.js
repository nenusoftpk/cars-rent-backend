// controllers/dashboardController.js

import mongoose from "mongoose";
import Car from "../models/Car.js";
import Booking from "../models/Booking.js";
import Customer from "../models/Customer.js";
import Driver from "../models/Driver.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import Setting from "../models/Setting.js";

import { wrap, send, fail, paging } from "../utils/http.js";
import { scope, tenantOnly, bookingLinkedScope } from "../services/scope.js";

import { collectCarReminders } from "./carController.js";
import { collectBookingReminders } from "./bookingController.js";
import { collectCustomerReminders } from "./customerController.js";
import { collectDriverReminders } from "./driverController.js";

// ======================================================
// REMINDER COMPLETION MODEL (lightweight, self-contained)
// ======================================================

const ReminderCompletionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reminderId: {
      type: String,
      required: true,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

ReminderCompletionSchema.index(
  { businessId: 1, reminderId: 1 },
  { unique: true }
);

const ReminderCompletion =
  mongoose.models.ReminderCompletion ||
  mongoose.model("ReminderCompletion", ReminderCompletionSchema);

// ======================================================
// CONSTANTS
// ======================================================

const DEFAULT_REMINDER_DAYS = 7;
const DEFAULT_TIMEZONE = "Asia/Karachi";
const MAX_REMINDER_DAYS = 365;

const CATEGORY_ORDER = { overdue: 0, due_soon: 1, upcoming: 2 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

const ALLOWED_REMINDER_SOURCES = new Set([
  "car",
  "booking",
  "customer",
  "driver",
]);
const ALLOWED_REMINDER_CATEGORIES = new Set([
  "overdue",
  "due_soon",
  "upcoming",
]);
const ALLOWED_REMINDER_PRIORITIES = new Set(["high", "medium", "low"]);

const ALLOWED_VIEWS = new Set([
  "Today",
  "Upcoming",
  "Overdue",
  "Completed",
]);

// Map internal types → frontend labels used by Reminders page
const FRONTEND_TYPE_MAP = {
  // Car
  insurance: "Insurance Expiry",
  token: "Token Tax Expiry",
  registration: "Car Document Expiry",
  service: "Car Servicing",
  service_odometer: "Car Servicing",
  oil_change: "Oil Change",
  oil_change_odometer: "Oil Change",

  // Booking
  balance: "Car Return",
  return: "Car Return",
  overdue_return: "Overdue Car",
  pickup: "Car Return",

  // Customer / Driver
  customer_license_expiry: "Car Document Expiry",
  driver_license_expiry: "Car Document Expiry",
};

// Resource permission keys
const RESOURCE_PERMISSIONS = {
  car: ["cars.view"],
  booking: ["bookings.view"],
  customer: ["customers.view"],
  driver: ["drivers.view"],
};

// ======================================================
// BASIC HELPERS
// ======================================================

const toCents = (value) => Math.round(Number(value || 0) * 100);
const money = (cents) => Math.round(cents) / 100;

const isOwnEmployee = (req) =>
  req.tenant?.role === "employee" && req.tenant?.dataScope === "own";

const isAdmin = (req) =>
  ["admin", "super-admin"].includes(
    String(req.tenant?.role || req.user?.role || "").toLowerCase()
  );

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw fail(`Invalid ${fieldName}.`, 400);
  }

  const input = value.trim();

  const isoWithTimezone =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

  if (!isoWithTimezone.test(input)) {
    throw fail(
      `${fieldName} must be YYYY-MM-DD or an ISO timestamp with timezone.`,
      400
    );
  }

  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw fail(`Invalid ${fieldName}.`, 400);
  }

  return date;
};

const canAccessResource = (req, resource) => {
  const role = String(req.user?.role || "").toLowerCase();

  if (role === "admin") {
    return true;
  }

  if (role !== "employee") {
    return false;
  }

  const permissions = Array.isArray(req.user?.permissions)
    ? req.user.permissions
    : [];

  const requiredPermissions = RESOURCE_PERMISSIONS[resource];

  if (!requiredPermissions?.length) {
    return false;
  }

  return requiredPermissions.some((permission) =>
    permissions.includes(permission)
  );
};

// ======================================================
// TIMEZONE HELPERS
// ======================================================

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
};

const zonedMidnightUtc = (year, month, day, timeZone) => {
  const targetDate = new Date(Date.UTC(year, month - 1, day));

  if (
    targetDate.getUTCFullYear() !== year ||
    targetDate.getUTCMonth() + 1 !== month ||
    targetDate.getUTCDate() !== day
  ) {
    throw fail("Invalid calendar date.", 400);
  }

  const targetKey = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");

  const getKey = (timestamp) =>
    zonedDayKey(new Date(timestamp), timeZone);

  const utcMidnight = targetDate.getTime();

  let low = utcMidnight - 48 * 60 * 60 * 1000;
  let high = utcMidnight + 48 * 60 * 60 * 1000;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);

    if (getKey(mid) < targetKey) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (getKey(low) !== targetKey) {
    throw fail(
      "The selected calendar date does not exist in this timezone.",
      400
    );
  }

  return new Date(low);
};

const zonedDayKey = (date, timeZone) => {
  const parts = getZonedParts(date, timeZone);

  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const startOfZonedDay = (date, timeZone) => {
  const key = zonedDayKey(date, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  return zonedMidnightUtc(y, m, d, timeZone);
};

const endOfZonedDay = (date, timeZone) => {
  const parts = getZonedParts(date, timeZone);

  const nextDate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + 1)
  );

  const nextMidnight = zonedMidnightUtc(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
    timeZone
  );

  return new Date(nextMidnight.getTime() - 1);
};

const getDateRange = (query, timeZone = DEFAULT_TIMEZONE) => {
  const rawFrom = query.from == null ? "" : String(query.from).trim();
  const rawTo = query.to == null ? "" : String(query.to).trim();

  const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  const parseBoundary = (value, fieldName, endOfDay) => {
    if (!value) return null;

    if (!isDateOnly(value)) {
      return parseDate(value, fieldName);
    }

    const [year, month, day] = value.split("-").map(Number);

    const start = zonedMidnightUtc(year, month, day, timeZone);

    return endOfDay ? endOfZonedDay(start, timeZone) : start;
  };

  const now = new Date();

  if (!rawFrom && !rawTo) {
    return {
      from: startOfZonedDay(now, timeZone),
      to: endOfZonedDay(now, timeZone),
      isToday: true,
      timeZone,
    };
  }

  let from = parseBoundary(rawFrom, "from date", false);
  let to = parseBoundary(rawTo, "to date", true);

  if (from && !to) {
    to = endOfZonedDay(from, timeZone);
  }

  if (!from && to) {
    from = startOfZonedDay(to, timeZone);
  }

  if (from && to && from > to) {
    throw fail("From date cannot be after to date.", 400);
  }

  return {
    from,
    to,
    isToday: false,
    timeZone,
  };
};

// ======================================================
// SETTINGS
// ======================================================

const resolveReminderSettings = async (req) => {
  let daysBefore = DEFAULT_REMINDER_DAYS;
  let timezone = DEFAULT_TIMEZONE;

  const setting = await Setting.findOne(tenantOnly(req))
    .select("reminderDaysBefore timezone")
    .lean();

  if (setting) {
    const stored = Number(setting.reminderDaysBefore);

    if (
      setting.reminderDaysBefore != null &&
      Number.isInteger(stored) &&
      stored >= 0 &&
      stored <= MAX_REMINDER_DAYS
    ) {
      daysBefore = stored;
    }

    if (setting.timezone) {
      const candidate = String(setting.timezone).trim();

      try {
        new Intl.DateTimeFormat("en-US", {
          timeZone: candidate,
        });

        timezone = candidate;
      } catch {
        throw fail("Invalid business timezone configuration.", 500);
      }
    }
  }

  if (req.query?.days !== undefined) {
    const value = req.query.days;

    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
      throw fail(
        `days must be an integer between 0 and ${MAX_REMINDER_DAYS}.`,
        400
      );
    }

    const explicit = Number(value);

    if (
      !Number.isSafeInteger(explicit) ||
      explicit < 0 ||
      explicit > MAX_REMINDER_DAYS
    ) {
      throw fail(
        `days must be an integer between 0 and ${MAX_REMINDER_DAYS}.`,
        400
      );
    }

    daysBefore = explicit;
  }

  return { daysBefore, timezone };
};

// ======================================================
// REMINDER NORMALISATION + FRONTEND SHAPE
// ======================================================

const normaliseReminder = (raw, source) => {
  const id = String(raw?.id || "");
  if (!id) return null;

  const category = ALLOWED_REMINDER_CATEGORIES.has(raw.category)
    ? raw.category
    : "upcoming";

  const priority = ALLOWED_REMINDER_PRIORITIES.has(raw.priority)
    ? raw.priority
    : category === "overdue"
      ? "high"
      : category === "due_soon"
        ? "medium"
        : "low";

  let entityId = null;
  let entityName = "";

  if (source === "car") {
    entityId = raw.carId || raw.car?.id || null;
    entityName =
      raw.carName ||
      raw.car?.name ||
      [raw.car?.brand, raw.car?.model].filter(Boolean).join(" ") ||
      raw.plate ||
      "";
  } else if (source === "booking") {
    entityId = raw.bookingId || null;
    entityName = raw.bookingNumber || raw.customerName || "";
  } else if (source === "customer") {
    entityId = raw.customerId || null;
    entityName = raw.customerName || "";
  } else if (source === "driver") {
    entityId = raw.driverId || null;
    entityName = raw.driverName || "";
  }

  let dueDate = null;
  if (raw.dueDate) {
    const parsed = new Date(raw.dueDate);
    if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
  }

  return {
    id,
    source,
    type: raw.type || "",
    category,
    priority,
    message: raw.message || "",
    dueDate,
    daysRemaining:
      typeof raw.daysRemaining === "number" ? raw.daysRemaining : null,
    entityId: entityId ? String(entityId) : null,
    entityName: entityName || "",
    carId: raw.carId || raw.car?.id || null,
    carPlate: raw.carPlate || raw.plate || raw.car?.plate || null,
    bookingId: raw.bookingId || null,
    bookingNumber: raw.bookingNumber || null,
    customerId: raw.customerId || null,
    customerName: raw.customerName || null,
    driverId: raw.driverId || null,
    driverName: raw.driverName || null,
  };
};

/**
 * Convert internal reminder → shape expected by the Reminders page.
 */
const toFrontendReminder = (item, completedSet, timezone, now) => {
  const isCompleted = completedSet.has(item.id);

  // Determine view
  let view = "Upcoming";

  if (isCompleted) {
    view = "Completed";
  } else if (item.category === "overdue") {
    view = "Overdue";
  } else if (item.dueDate) {
    const dueKey = zonedDayKey(item.dueDate, timezone);
    const todayKey = zonedDayKey(now, timezone);

    if (dueKey === todayKey) {
      view = "Today";
    } else if (item.category === "due_soon") {
      view = "Today"; // treat near-term as Today for the tab
    } else {
      view = "Upcoming";
    }
  } else if (item.category === "due_soon") {
    view = "Today";
  }

  // Map type to frontend label
  const frontendType =
    FRONTEND_TYPE_MAP[item.type] ||
    (item.source === "booking" && item.category === "overdue"
      ? "Overdue Car"
      : item.source === "booking"
        ? "Car Return"
        : item.type || "Reminder");

  // Build details string
  const details =
    item.message ||
    [item.entityName, item.carPlate, item.bookingNumber]
      .filter(Boolean)
      .join(" · ") ||
    "Reminder";

  // Build deep-link
  let link = null;
  if (item.carId) link = `/cars/${item.carId}`;
  else if (item.bookingId) link = `/bookings/${item.bookingId}`;
  else if (item.customerId) link = `/customers/${item.customerId}`;
  else if (item.driverId) link = `/drivers/${item.driverId}`;

  return {
    id: item.id,
    type: frontendType,
    details,
    due: item.dueDate || null,
    view,
    completed: isCompleted,
    link,
    // keep original data for debugging / future use
    source: item.source,
    category: item.category,
    priority: item.priority,
    message: item.message,
    entityId: item.entityId,
    entityName: item.entityName,
    carId: item.carId,
    bookingId: item.bookingId,
    customerId: item.customerId,
    driverId: item.driverId,
  };
};

/**
 * Load all four collectors in parallel, normalise and deduplicate.
 */
const collectAllReminders = async (req, daysBefore) => {
  const collectors = [
    {
      source: "car",
      allowed: canAccessResource(req, "car"),
      run: () =>
        collectCarReminders(req, daysBefore, {
          includeOdometer: true,
          windowDays: daysBefore,
        }),
    },
    {
      source: "booking",
      allowed: canAccessResource(req, "booking"),
      run: () => collectBookingReminders(req, daysBefore),
    },
    {
      source: "customer",
      allowed: canAccessResource(req, "customer"),
      run: () => collectCustomerReminders(req, daysBefore),
    },
    {
      source: "driver",
      allowed: canAccessResource(req, "driver"),
      run: () => collectDriverReminders(req, daysBefore),
    },
  ];

  const permitted = collectors.filter((c) => c.allowed);

  const results = await Promise.all(
    permitted.map(async (collector) => ({
      source: collector.source,
      result: await collector.run(),
    }))
  );

  const normalised = [];

  for (const { source, result } of results) {
    let rawItems;

    if (source === "car") {
      if (!Array.isArray(result?.items)) {
        throw fail(
          "Car reminder collector returned an invalid response.",
          500
        );
      }
      rawItems = result.items;
    } else {
      if (!Array.isArray(result)) {
        throw fail(
          `${source} reminder collector returned an invalid response.`,
          500
        );
      }
      rawItems = result;
    }

    for (const raw of rawItems) {
      const item = normaliseReminder(raw, source);
      if (item) normalised.push(item);
    }
  }

  // Prefix source to avoid ID collisions
  const byId = new Map();

  for (const item of normalised) {
    const key = `${item.source}:${item.id}`;

    if (!byId.has(key)) {
      byId.set(key, {
        ...item,
        id: key,
      });
    }
  }

  const items = [...byId.values()];

  items.sort((a, b) => {
    const categoryDifference =
      (CATEGORY_ORDER[a.category] ?? 9) -
      (CATEGORY_ORDER[b.category] ?? 9);

    if (categoryDifference !== 0) return categoryDifference;

    const dateA = a.dueDate ? a.dueDate.getTime() : Infinity;
    const dateB = b.dueDate ? b.dueDate.getTime() : Infinity;

    if (dateA !== dateB) return dateA - dateB;

    return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  });

  return { items };
};

const parseCsvFilter = (value, allowed, fieldName) => {
  if (value === undefined || value === null || value === "") return null;

  const parts = String(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!parts.length) {
    throw fail(`Invalid ${fieldName} filter.`, 400);
  }

  for (const part of parts) {
    if (!allowed.has(part)) {
      throw fail(
        `Invalid ${fieldName} "${part}". Allowed: ${[...allowed].join(", ")}.`,
        400
      );
    }
  }

  return parts;
};

// ======================================================
// 1. DASHBOARD
// ======================================================

export const getDashboard = wrap(async (req, res) => {
  const { timezone } = await resolveReminderSettings(req);

  const { from, to, isToday, timeZone } = getDateRange(req.query, timezone);

  const isEmployee = req.tenant.role === "employee";

  const permissions = Array.isArray(req.user?.permissions)
    ? req.user.permissions
    : [];

  const allowed = (permission) =>
    !isEmployee || permissions.includes(permission);

  const canViewCars = allowed("cars.view");
  const canViewCustomers = allowed("customers.view");
  const canViewBookings = allowed("bookings.view");
  const canViewPayments = allowed("payments.view");
  const canViewExpenses = allowed("expenses.view");

  const carFilter = scope(req, "Car");
  const customerFilter = scope(req, "Customer");
  const bookingFilter = scope(req, "Booking");

  const paymentFilter = canViewPayments
    ? {
        ...(await bookingLinkedScope(req, "Payment")),
        status: "completed",
        paymentDate: { $gte: from, $lte: to },
      }
    : null;

  const expenseFilter = canViewExpenses
    ? {
        ...scope(req, "Expense"),
        expenseDate: { $gte: from, $lte: to },
      }
    : null;

  const empty = () => Promise.resolve([]);

  const [
    totalCars,
    availableCars,
    totalCustomers,
    newCustomers,
    totalBookings,
    reservedBookings,
    onRentBookings,
    completedBookings,
    cancelledBookings,
    bookingAgg,
    paymentAgg,
    expenseAgg,
  ] = await Promise.all([
    canViewCars ? Car.countDocuments(carFilter) : Promise.resolve(null),

    canViewCars
      ? Car.countDocuments({ ...carFilter, status: "available" })
      : Promise.resolve(null),

    canViewCustomers
      ? Customer.countDocuments(customerFilter)
      : Promise.resolve(null),

    canViewCustomers
      ? Customer.countDocuments({
          ...customerFilter,
          createdAt: { $gte: from, $lte: to },
        })
      : Promise.resolve(null),

    canViewBookings
      ? Booking.countDocuments(bookingFilter)
      : Promise.resolve(null),

    canViewBookings
      ? Booking.countDocuments({ ...bookingFilter, status: "reserved" })
      : Promise.resolve(null),

    canViewBookings
      ? Booking.countDocuments({ ...bookingFilter, status: "on_rent" })
      : Promise.resolve(null),

    canViewBookings
      ? Booking.countDocuments({ ...bookingFilter, status: "completed" })
      : Promise.resolve(null),

    canViewBookings
      ? Booking.countDocuments({ ...bookingFilter, status: "cancelled" })
      : Promise.resolve(null),

    canViewBookings
      ? Booking.aggregate([
          {
            $match: {
              ...bookingFilter,
              pickupDate: { $gte: from, $lte: to },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              revenue: {
                $sum: {
                  $cond: [
                    { $ne: ["$status", "cancelled"] },
                    { $ifNull: ["$totalAmount", 0] },
                    0,
                  ],
                },
              },
            },
          },
        ])
      : empty(),

    canViewPayments
      ? Payment.aggregate([
          { $match: paymentFilter },
          { $group: { _id: "$type", total: { $sum: "$amount" } } },
        ])
      : empty(),

    canViewExpenses
      ? Expense.aggregate([
          { $match: expenseFilter },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
      : empty(),
  ]);

  const bookingRevenue = money(toCents(bookingAgg[0]?.revenue || 0));

  let cashReceivedCents = 0;
  let refundsCents = 0;

  for (const payment of paymentAgg) {
    const type = String(payment._id || "").toLowerCase();
    const amount = toCents(payment.total);

    if (["advance", "rental", "final"].includes(type)) {
      cashReceivedCents += amount;
    }

    if (type === "refund") {
      refundsCents += amount;
    }
  }

  const netCashCents = cashReceivedCents - refundsCents;
  const expensesCents = toCents(expenseAgg[0]?.total || 0);
  const canViewCashSurplus = canViewPayments && canViewExpenses;
  const cashSurplusCents = netCashCents - expensesCents;

  send(
    res,
    {
      filters: { from, to, isToday, timeZone },

      overview: {
        totalCars,
        availableCars,
        totalCustomers,
        newCustomers,
        totalBookings,
        activeRentals: onRentBookings,
      },

      bookings: {
        reserved: reservedBookings,
        onRent: onRentBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        inSelectedPeriod: canViewBookings ? bookingAgg[0]?.count || 0 : null,
      },

      financials: {
        scope: isEmployee
          ? "assigned_bookings_and_own_expenses"
          : "business",

        bookingRevenue: canViewBookings ? bookingRevenue : null,
        cashReceived: canViewPayments ? money(cashReceivedCents) : null,
        refunds: canViewPayments ? money(refundsCents) : null,
        netCash: canViewPayments ? money(netCashCents) : null,
        expenses: canViewExpenses ? money(expensesCents) : null,
        estimatedCashSurplus: canViewCashSurplus
          ? money(cashSurplusCents)
          : null,
        estimatedProfit: canViewCashSurplus ? money(cashSurplusCents) : null,
      },
    },
    "Dashboard loaded successfully."
  );
});

// ======================================================
// 2. CENTRALISED REMINDERS (with view + complete support)
// GET /api/v1/dashboard/reminders
// ======================================================

export const getReminders = wrap(async (req, res) => {
  const { daysBefore, timezone } = await resolveReminderSettings(req);
  const { items: rawItems } = await collectAllReminders(req, daysBefore);

  // Load completed reminder IDs for this business
  const completions = await ReminderCompletion.find({
    businessId: req.tenant.businessId,
  })
    .select("reminderId")
    .lean();

  const completedSet = new Set(completions.map((c) => c.reminderId));

  const now = new Date();

  // Convert every reminder to the frontend shape
  let all = rawItems.map((item) =>
    toFrontendReminder(item, completedSet, timezone, now)
  );

  // Optional filters from query
  const sources = parseCsvFilter(
    req.query.source,
    ALLOWED_REMINDER_SOURCES,
    "source"
  );
  const categories = parseCsvFilter(
    req.query.category,
    ALLOWED_REMINDER_CATEGORIES,
    "category"
  );
  const priorities = parseCsvFilter(
    req.query.priority,
    ALLOWED_REMINDER_PRIORITIES,
    "priority"
  );

  if (sources) {
    all = all.filter((i) => sources.includes(i.source));
  }
  if (categories) {
    all = all.filter((i) => categories.includes(i.category));
  }
  if (priorities) {
    all = all.filter((i) => priorities.includes(i.priority));
  }

  // Date range filter (only on non-completed items that have a due date)
  if (req.query.from || req.query.to) {
    const range = getDateRange(
      { from: req.query.from, to: req.query.to },
      timezone
    );

    all = all.filter((i) => {
      if (i.completed) return true; // keep completed items when filtering by date
      if (!i.due) return false;
      const d = i.due instanceof Date ? i.due : new Date(i.due);
      if (Number.isNaN(d.getTime())) return false;
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      return true;
    });
  }

  // Search (type / details / entity)
  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");

    all = all.filter(
      (i) =>
        regex.test(i.type) ||
        regex.test(i.details) ||
        regex.test(i.entityName || "") ||
        regex.test(i.message || "")
    );
  }

  // Type filter (frontend SelectFilter)
  if (req.query.type?.trim()) {
    const wanted = String(req.query.type).trim();
    all = all.filter((i) => i.type === wanted);
  }

  // Build summary counts (always on the full filtered set before view)
  const summary = {
    Today: 0,
    Upcoming: 0,
    Overdue: 0,
    Completed: 0,
  };

  for (const item of all) {
    if (summary[item.view] !== undefined) {
      summary[item.view] += 1;
    }
  }

  // View tab filter
  const view = req.query.view || "Today";
  if (!ALLOWED_VIEWS.has(view)) {
    throw fail(
      `Invalid view. Allowed: ${[...ALLOWED_VIEWS].join(", ")}.`,
      400
    );
  }

  let filtered = all.filter((i) => i.view === view);

  // Pagination
  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const total = filtered.length;
  const start = (page - 1) * limit;
  const pageItems = filtered.slice(start, start + limit);

  send(
    res,
    {
      items: pageItems,
      summary,
      counts: {
        // keep old shape for any other consumers
        total: all.length,
        overdue: summary.Overdue,
        dueSoon: summary.Today,
        upcoming: summary.Upcoming,
        completed: summary.Completed,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
      daysBefore,
      timeZone: timezone,
    },
    "Reminders loaded successfully."
  );
});

// ======================================================
// 2b. COMPLETE REMINDER
// PATCH /api/v1/dashboard/reminders/:id/complete
// ======================================================

export const completeReminder = wrap(async (req, res) => {
  const reminderId = String(req.params.id || "").trim();

  if (!reminderId) {
    throw fail("Reminder ID is required.", 400);
  }

  // Upsert so repeated calls are idempotent
  await ReminderCompletion.findOneAndUpdate(
    {
      businessId: req.tenant.businessId,
      reminderId,
    },
    {
      $set: {
        completedAt: new Date(),
        completedBy: req.tenant.userId,
      },
      $setOnInsert: {
        businessId: req.tenant.businessId,
        reminderId,
      },
    },
    { upsert: true, new: true }
  );

  send(res, { id: reminderId, completed: true }, "Reminder marked as done.");
});

// ======================================================
// 2c. REOPEN REMINDER
// PATCH /api/v1/dashboard/reminders/:id/reopen
// ======================================================

export const reopenReminder = wrap(async (req, res) => {
  const reminderId = String(req.params.id || "").trim();

  if (!reminderId) {
    throw fail("Reminder ID is required.", 400);
  }

  const result = await ReminderCompletion.deleteOne({
    businessId: req.tenant.businessId,
    reminderId,
  });

  if (result.deletedCount === 0) {
    // Still return success – frontend just needs the item back in the active list
    return send(
      res,
      { id: reminderId, completed: false },
      "Reminder is already open."
    );
  }

  send(res, { id: reminderId, completed: false }, "Reminder reopened.");
});

// ======================================================
// 3. NOTIFICATIONS
// ======================================================

export const getNotifications = wrap(async (req, res) => {
  const { daysBefore } = await resolveReminderSettings(req);
  const { items } = await collectAllReminders(req, daysBefore);

  // Also respect completions so completed items do not appear as notifications
  const completions = await ReminderCompletion.find({
    businessId: req.tenant.businessId,
  })
    .select("reminderId")
    .lean();

  const completedSet = new Set(completions.map((c) => c.reminderId));

  const notifications = items
    .filter(
      (i) =>
        !completedSet.has(i.id) &&
        ["high", "medium"].includes(i.priority)
    )
    .map((i) => ({
      id: `notif-${i.id}`,
      title:
        i.category === "overdue"
          ? "Overdue action required"
          : i.category === "due_soon"
            ? "Action due soon"
            : "Upcoming reminder",
      message: i.message,
      type: i.type,
      source: i.source,
      priority: i.priority,
      category: i.category,
      dueDate: i.dueDate,
      entityId: i.entityId,
      entityName: i.entityName,
      carId: i.carId,
      bookingId: i.bookingId,
      customerId: i.customerId,
      driverId: i.driverId,
    }));

  send(
    res,
    {
      items: notifications,
      total: notifications.length,
    },
    "Notifications loaded successfully."
  );
});

// ======================================================
// 4. GLOBAL SEARCH
// ======================================================

export const globalSearch = wrap(async (req, res) => {
  const raw = String(req.query.q || "").trim();
  if (!raw) {
    return send(
      res,
      { cars: [], bookings: [], customers: [], drivers: [] },
      "Empty query."
    );
  }
  if (raw.length > 80) {
    throw fail("Search query is too long.", 400);
  }

  const term = escapeRegex(raw);
  const regex = new RegExp(term, "i");
  const limit = 8;

  const searchCars = canAccessResource(req, "car");
  const searchBookings = canAccessResource(req, "booking");
  const searchCustomers = canAccessResource(req, "customer");
  const searchDrivers = canAccessResource(req, "driver");

  const empty = Promise.resolve([]);

  const driverQuery = async () => {
    if (!searchDrivers) return [];

    return Driver.find({
      ...scope(req, "Driver"),
      $or: [{ name: regex }, { phone: regex }, { email: regex }],
    })
      .select("name phone status")
      .limit(limit)
      .lean();
  };

  const [cars, bookings, customers, drivers] = await Promise.all([
    searchCars
      ? Car.find({
          ...scope(req, "Car"),
          $or: [
            { name: regex },
            { brand: regex },
            { model: regex },
            { numberPlate: regex },
          ],
        })
          .select("name brand model numberPlate status images")
          .limit(limit)
          .lean()
      : empty,

    searchBookings
      ? Booking.find({
          ...scope(req, "Booking"),
          $or: [{ bookingNumber: regex }, { invoiceNumber: regex }],
        })
          .select(
            "bookingNumber invoiceNumber status pickupDate returnDate customerId carId"
          )
          .populate("customerId", "name")
          .populate("carId", "name numberPlate")
          .limit(limit)
          .lean()
      : empty,

    searchCustomers
      ? Customer.find({
          ...scope(req, "Customer"),
          $or: [
            { name: regex },
            { phone: regex },
            { email: regex },
            { customerCode: regex },
          ],
        })
          .select("name phone email customerCode status")
          .limit(limit)
          .lean()
      : empty,

    driverQuery(),
  ]);

  send(
    res,
    {
      cars: cars.map((c) => ({
        id: String(c._id),
        title: c.name || `${c.brand || ""} ${c.model || ""}`.trim(),
        subtitle: c.numberPlate || "",
        type: "car",
        status: c.status,
        path: `/cars/${c._id}`,
      })),
      bookings: bookings.map((b) => ({
        id: String(b._id),
        title: b.bookingNumber || b.invoiceNumber || String(b._id),
        subtitle: [
          b.customerId?.name,
          b.carId?.name || b.carId?.numberPlate,
        ]
          .filter(Boolean)
          .join(" · "),
        type: "booking",
        status: b.status,
        path: `/bookings/${b._id}`,
      })),
      customers: customers.map((c) => ({
        id: String(c._id),
        title: c.name,
        subtitle: c.phone || c.email || "",
        type: "customer",
        status: c.status,
        path: `/customers/${c._id}`,
      })),
      drivers: drivers.map((d) => ({
        id: String(d._id),
        title: d.name,
        subtitle: d.phone || "",
        type: "driver",
        status: d.status,
        path: `/drivers/${d._id}`,
      })),
    },
    "Search completed successfully."
  );
});