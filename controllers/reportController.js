// controllers/reportController.js

import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import Customer from "../models/Customer.js";
import Car from "../models/Car.js";
import Driver from "../models/Driver.js";
import User from "../models/User.js";

import { calculateProfit } from "../services/profitService.js";
import { wrap, send, fail, paging } from "../utils/http.js";
import { scope, tenantOnly } from "../services/scope.js";

// ======================================================
// HELPERS
// ======================================================

const toCents = (value) => Math.round(Number(value || 0) * 100);
const money = (cents) => Math.round(cents) / 100;
const id = (value) => String(value?._id || value || "");

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isOwnEmployee = (req) =>
  req.tenant?.role === "employee" && req.tenant?.dataScope === "own";

const canViewFinancials = (req) => {
  const role = String(req.tenant?.role || req.user?.role || "").toLowerCase();
  if (["admin", "super-admin"].includes(role)) return true;

  const permissions = req.user?.permissions || [];
  return (
    Array.isArray(permissions) &&
    (permissions.includes("financial:view") ||
      permissions.includes("financial.view") ||
      permissions.includes("reports.view") ||
      permissions.includes("payments.view") ||
      permissions.includes("expenses.view"))
  );
};

const parseDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw fail(`Invalid ${fieldName}.`, 400);
  }
  return date;
};

/**
 * Supports:
 * - YYYY-MM-DD  → full calendar day (to is exclusive +1 day)
 * - full ISO timestamps
 */
const getDateRange = (query, fieldLabel = "date") => {
  const from = parseDate(query.from, `from ${fieldLabel}`);
  let to = parseDate(query.to, `to ${fieldLabel}`);
  let toExclusive = false;

  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(String(query.to).trim())) {
    to = new Date(to);
    to.setUTCDate(to.getUTCDate() + 1);
    toExclusive = true;
  }

  if (from && to && from >= to) {
    throw fail("From date cannot be after to date.", 400);
  }

  return { from, to, toExclusive };
};

const applyDateFilter = (filter, field, range) => {
  if (!range.from && !range.to) return;

  filter[field] = {};
  if (range.from) filter[field].$gte = range.from;
  if (range.to) {
    if (range.toExclusive) filter[field].$lt = range.to;
    else filter[field].$lte = range.to;
  }
};

const validObjectId = (value, label) => {
  if (!value) return null;
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`Invalid ${label}.`, 400);
  }
  return value;
};

// ======================================================
// UNIFIED DISPATCHER
// GET /api/v1/reports?name=bookings&from=...&to=...
// ======================================================

export const getReport = wrap(async (req, res) => {
  const name = String(req.query.name || req.query.report || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  if (!name) {
    throw fail("Report name is required (query: name).", 400);
  }

  switch (name) {
    case "income-expense":
    case "profit":
    case "income_expense":
      return getIncomeExpenseReport(req, res);

    case "bookings":
    case "booking":
      return getBookingReport(req, res);

    case "payments":
    case "payment":
      return getPaymentReport(req, res);

    case "expenses":
    case "expense":
      return getExpenseReport(req, res);

    case "customers":
    case "customer":
      return getCustomerReport(req, res);

    case "cars-status":
    case "cars":
    case "car-status":
    case "fleet":
      return getCarsStatusReport(req, res);

    case "drivers":
    case "driver":
    case "driver-performance":
      return getDriverReport(req, res);

    default:
      throw fail(
        `Unknown report "${name}". Allowed: income-expense, bookings, payments, expenses, customers, cars-status, drivers.`,
        400
      );
  }
});

// ======================================================
// 1. INCOME & EXPENSE (PROFIT)
// ======================================================

export const getIncomeExpenseReport = wrap(async (req, res) => {
  if (!canViewFinancials(req)) {
    throw fail("You do not have permission to view financial reports.", 403);
  }

  const profit = await calculateProfit(req);

  send(
    res,
    {
      type: "income-expense",
      items: [], // profit is summary-oriented
      pagination: { page: 1, limit: 0, total: 0, totalPages: 0 },
      totals: {
        earnedRentalRevenue: profit.earnedRentalRevenue ?? null,
        cashReceived: profit.cashReceivedForCompletedBookings ?? profit.cashReceived ?? null,
        totalCosts: profit.totalCosts ?? null,
        estimatedOperatingProfit: profit.estimatedOperatingProfit ?? null,
      },
      summary: profit,
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        carId: req.query.carId || null,
      },
    },
    "Income and expense report loaded successfully."
  );
});

// ======================================================
// 2. BOOKING REPORT
// ======================================================

export const getBookingReport = wrap(async (req, res) => {
  const range = getDateRange(req.query, "pickup date");
  const filter = { ...scope(req, "Booking") };

  applyDateFilter(filter, "pickupDate", range);

  if (req.query.status) {
    const status = String(req.query.status).toLowerCase();
    if (!["reserved", "on_rent", "completed", "cancelled"].includes(status)) {
      throw fail("Invalid booking status.", 400);
    }
    filter.status = status;
  }

  if (req.query.carId) {
    filter.carId = validObjectId(req.query.carId, "car ID");
  }

  if (req.query.customerId) {
    filter.customerId = validObjectId(req.query.customerId, "customer ID");
  }

  if (req.query.driverId) {
    filter.driverId = validObjectId(req.query.driverId, "driver ID");
  }

  if (req.query.staffId || req.query.employeeId) {
    const staffId = req.query.staffId || req.query.employeeId;
    if (isOwnEmployee(req) && id(staffId) !== id(req.tenant.userId)) {
      throw fail("You can only view your own bookings.", 403);
    }
    filter.employeeId = validObjectId(staffId, "employee ID");
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [{ bookingNumber: regex }, { invoiceNumber: regex }];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const sortText = String(req.query.sort || "pickupDate:desc");
  const [sortField, sortDir] = sortText.split(":");
  const allowedSort = ["pickupDate", "returnDate", "totalAmount", "createdAt", "status"];
  const sort = allowedSort.includes(sortField)
    ? { [sortField]: sortDir === "asc" ? 1 : -1 }
    : { pickupDate: -1 };

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .populate("customerId", "name phone")
      .populate("carId", "name numberPlate brand model")
      .populate("driverId", "name phone")
      .populate("employeeId", "name")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);

  // Summary (full matching set, not just current page)
  const summaryAgg = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        amount: { $sum: { $ifNull: ["$totalAmount", 0] } },
      },
    },
  ]);

  const statusCount = {
    reserved: 0,
    on_rent: 0,
    completed: 0,
    cancelled: 0,
  };
  let totalAmountCents = 0;

  for (const row of summaryAgg) {
    if (statusCount[row._id] !== undefined) {
      statusCount[row._id] = row.count;
    }
    if (row._id !== "cancelled") {
      totalAmountCents += toCents(row.amount);
    }
  }

  const items = bookings.map((b) => ({
    id: id(b._id),
    bookingNumber: b.bookingNumber || "",
    invoiceNumber: b.invoiceNumber || "",
    status: b.status,
    pickupDate: b.pickupDate,
    returnDate: b.returnDate,
    totalAmount: canViewFinancials(req) ? money(toCents(b.totalAmount)) : null,
    customer: b.customerId
      ? {
          id: id(b.customerId._id),
          name: b.customerId.name,
          phone: b.customerId.phone,
        }
      : null,
    car: b.carId
      ? {
          id: id(b.carId._id),
          name: b.carId.name,
          numberPlate: b.carId.numberPlate,
        }
      : null,
    driver: b.driverId
      ? {
          id: id(b.driverId._id),
          name: b.driverId.name,
          phone: b.driverId.phone,
        }
      : null,
    employee: b.employeeId
      ? { id: id(b.employeeId._id), name: b.employeeId.name }
      : null,
  }));

  send(
    res,
    {
      type: "bookings",
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        status: req.query.status || null,
        carId: req.query.carId || null,
        customerId: req.query.customerId || null,
        driverId: req.query.driverId || null,
        staffId: req.query.staffId || req.query.employeeId || null,
      },
      summary: {
        totalBookings: total,
        totalAmount: canViewFinancials(req) ? money(totalAmountCents) : null,
        ...statusCount,
      },
      totals: {
        totalAmount: canViewFinancials(req) ? money(totalAmountCents) : null,
        totalBookings: total,
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Booking report loaded successfully."
  );
});

// ======================================================
// 3. PAYMENT REPORT
// ======================================================

export const getPaymentReport = wrap(async (req, res) => {
  if (!canViewFinancials(req)) {
    throw fail("You do not have permission to view payment reports.", 403);
  }

  const range = getDateRange(req.query, "payment date");
  const filter = {
    ...tenantOnly(req),
    status: "completed",
  };

  applyDateFilter(filter, "paymentDate", range);

  if (req.query.type) {
    filter.type = String(req.query.type).toLowerCase();
  }

  if (req.query.method) {
    filter.method = String(req.query.method).toLowerCase();
  }

  if (req.query.bookingId) {
    filter.bookingId = validObjectId(req.query.bookingId, "booking ID");
  }

  // Own-scope employees only see payments of their own bookings
  if (isOwnEmployee(req)) {
    const ownBookingIds = await Booking.distinct("_id", {
      ...scope(req, "Booking"),
    });
    filter.bookingId = filter.bookingId
      ? { $eq: filter.bookingId, $in: ownBookingIds }
      : { $in: ownBookingIds };
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [
      { paymentNumber: regex },
      { transactionReference: regex },
    ];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("bookingId", "bookingNumber invoiceNumber")
      .sort({ paymentDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  // Full summary
  const allMatching = await Payment.find(filter)
    .select("amount type method")
    .lean();

  let totalReceived = 0;
  let totalRefunded = 0;
  const byMethod = {};
  const byType = {};

  for (const p of allMatching) {
    const amount = Number(p.amount || 0);
    if (["advance", "rental", "final"].includes(p.type)) {
      totalReceived += amount;
    } else if (p.type === "refund") {
      totalRefunded += amount;
    }
    byMethod[p.method] = (byMethod[p.method] || 0) + amount;
    byType[p.type] = (byType[p.type] || 0) + amount;
  }

  const items = payments.map((p) => ({
    id: id(p._id),
    paymentNumber: p.paymentNumber,
    amount: money(toCents(p.amount)),
    method: p.method,
    type: p.type,
    paymentDate: p.paymentDate,
    booking: p.bookingId
      ? {
          id: id(p.bookingId._id),
          bookingNumber: p.bookingId.bookingNumber,
          invoiceNumber: p.bookingId.invoiceNumber,
        }
      : null,
  }));

  send(
    res,
    {
      type: "payments",
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        type: req.query.type || null,
        method: req.query.method || null,
      },
      summary: {
        totalPayments: total,
        totalReceived: money(toCents(totalReceived)),
        totalRefunded: money(toCents(totalRefunded)),
        netReceived: money(toCents(totalReceived - totalRefunded)),
        byMethod,
        byType,
      },
      totals: {
        amount: money(toCents(totalReceived - totalRefunded)),
        totalReceived: money(toCents(totalReceived)),
        totalRefunded: money(toCents(totalRefunded)),
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Payment report loaded successfully."
  );
});

// ======================================================
// 4. EXPENSE REPORT
// ======================================================

export const getExpenseReport = wrap(async (req, res) => {
  if (!canViewFinancials(req)) {
    throw fail("You do not have permission to view expense reports.", 403);
  }

  const range = getDateRange(req.query, "expense date");
  const filter = { ...scope(req, "Expense") };

  applyDateFilter(filter, "expenseDate", range);

  if (req.query.category) {
    filter.category = String(req.query.category).toLowerCase();
  }

  if (req.query.carId) {
    filter.carId = validObjectId(req.query.carId, "car ID");
  }

  if (req.query.driverId) {
    filter.driverId = validObjectId(req.query.driverId, "driver ID");
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [
      { title: regex },
      { description: regex },
      { paidTo: regex },
      { workshopName: regex },
    ];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate("carId", "name numberPlate")
      .populate("driverId", "name")
      .populate("bookingId", "bookingNumber")
      .sort({ expenseDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Expense.countDocuments(filter),
  ]);

  const summaryAgg = await Expense.aggregate([
    { $match: filter },
    {
      $group: {
        _id: "$category",
        amount: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  let totalAmountCents = 0;
  const byCategory = {};
  for (const row of summaryAgg) {
    const amt = toCents(row.amount);
    totalAmountCents += amt;
    byCategory[row._id] = money(amt);
  }

  const items = expenses.map((e) => ({
    id: id(e._id),
    title: e.title,
    category: e.category,
    amount: money(toCents(e.amount)),
    expenseDate: e.expenseDate,
    paymentMethod: e.paymentMethod,
    car: e.carId
      ? {
          id: id(e.carId._id),
          name: e.carId.name,
          numberPlate: e.carId.numberPlate,
        }
      : null,
    driver: e.driverId
      ? { id: id(e.driverId._id), name: e.driverId.name }
      : null,
    booking: e.bookingId
      ? {
          id: id(e.bookingId._id),
          bookingNumber: e.bookingId.bookingNumber,
        }
      : null,
  }));

  send(
    res,
    {
      type: "expenses",
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        category: req.query.category || null,
        carId: req.query.carId || null,
        driverId: req.query.driverId || null,
      },
      summary: {
        totalExpenses: total,
        totalAmount: money(totalAmountCents),
        byCategory,
      },
      totals: {
        amount: money(totalAmountCents),
        totalAmount: money(totalAmountCents),
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Expense report loaded successfully."
  );
});

// ======================================================
// 5. CUSTOMER REPORT
// ======================================================

export const getCustomerReport = wrap(async (req, res) => {
  const range = getDateRange(req.query, "created date");
  const filter = { ...scope(req, "Customer") };

  applyDateFilter(filter, "createdAt", range);

  if (req.query.status) {
    const status = String(req.query.status).toLowerCase();
    if (!["active", "inactive", "blocked"].includes(status)) {
      throw fail("Invalid customer status.", 400);
    }
    filter.status = status;
  }

  if (req.query.type) {
    const type = String(req.query.type);
    if (["Regular", "VIP", "Corporate", ""].includes(type)) {
      filter.type = type;
    }
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [
      { name: regex },
      { phone: regex },
      { email: regex },
      { customerCode: regex },
      { city: regex },
    ];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select("name phone email city status type createdAt customerCode")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const statusAgg = await Customer.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusCount = { active: 0, inactive: 0, blocked: 0 };
  for (const row of statusAgg) {
    if (statusCount[row._id] !== undefined) {
      statusCount[row._id] = row.count;
    }
  }

  const items = customers.map((c) => ({
    id: id(c._id),
    name: c.name,
    phone: c.phone,
    email: c.email || "",
    city: c.city || "",
    type: c.type || "",
    status: c.status,
    customerCode: c.customerCode || "",
    createdAt: c.createdAt,
  }));

  send(
    res,
    {
      type: "customers",
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        status: req.query.status || null,
        type: req.query.type || null,
      },
      summary: {
        totalCustomers: total,
        ...statusCount,
      },
      totals: {
        totalCustomers: total,
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Customer report loaded successfully."
  );
});

// ======================================================
// 6. CARS STATUS / FLEET REPORT
// ======================================================

export const getCarsStatusReport = wrap(async (req, res) => {
  const filter = { ...scope(req, "Car") };

  if (req.query.status) {
    const status = String(req.query.status)
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const allowed = [
      "available",
      "booked",
      "on_rent",
      "maintenance",
      "out_of_service",
    ];
    if (!allowed.includes(status)) {
      throw fail("Invalid car status.", 400);
    }
    filter.status = status;
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [
      { name: regex },
      { brand: regex },
      { model: regex },
      { numberPlate: regex },
    ];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [cars, total] = await Promise.all([
    Car.find(filter)
      .select(
        "name brand model year numberPlate status dailyRent hourlyRent odometer fuelType transmission seatingCapacity images createdAt"
      )
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Car.countDocuments(filter),
  ]);

  const statusAgg = await Car.aggregate([
    { $match: { ...scope(req, "Car") } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusCount = {
    available: 0,
    booked: 0,
    on_rent: 0,
    maintenance: 0,
    out_of_service: 0,
  };
  for (const row of statusAgg) {
    if (statusCount[row._id] !== undefined) {
      statusCount[row._id] = row.count;
    }
  }

  const items = cars.map((c) => ({
    id: id(c._id),
    name: c.name,
    brand: c.brand,
    model: c.model,
    year: c.year,
    numberPlate: c.numberPlate,
    status: c.status,
    dailyRent: canViewFinancials(req) ? money(toCents(c.dailyRent)) : null,
    hourlyRent: canViewFinancials(req) ? money(toCents(c.hourlyRent)) : null,
    odometer: c.odometer ?? 0,
    fuelType: c.fuelType,
    transmission: c.transmission,
    seats: c.seatingCapacity,
    image: Array.isArray(c.images) ? c.images[0] || "" : "",
  }));

  send(
    res,
    {
      type: "cars-status",
      filters: {
        status: req.query.status || null,
        search: req.query.search || null,
      },
      summary: {
        totalCars: Object.values(statusCount).reduce((a, b) => a + b, 0),
        ...statusCount,
      },
      totals: {
        totalCars: total,
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Cars status report loaded successfully."
  );
});

// ======================================================
// 7. DRIVER REPORT
// ======================================================

export const getDriverReport = wrap(async (req, res) => {
  const filter = { ...tenantOnly(req) };

  // Own-scope: only drivers that appear on the employee’s bookings
  if (isOwnEmployee(req)) {
    const visibleIds = await Booking.distinct("driverId", {
      ...scope(req, "Booking"),
      driverId: { $ne: null },
    });
    filter._id = { $in: visibleIds };
  }

  if (req.query.status) {
    const status = String(req.query.status).toLowerCase();
    if (status === "active") {
      filter.status = { $in: ["available", "assigned"] };
    } else if (["available", "assigned", "inactive"].includes(status)) {
      filter.status = status;
    } else {
      throw fail("Invalid driver status.", 400);
    }
  }

  if (req.query.search?.trim()) {
    const term = escapeRegex(req.query.search.trim().slice(0, 80));
    const regex = new RegExp(term, "i");
    filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [drivers, total] = await Promise.all([
    Driver.find(filter)
      .select("name phone email status paymentType paymentRate salary createdAt")
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Driver.countDocuments(filter),
  ]);

  // Enrich with booking counts (lightweight)
  const driverIds = drivers.map((d) => d._id);
  let bookingCounts = {};

  if (driverIds.length) {
    const bookingFilter = {
      ...tenantOnly(req),
      driverId: { $in: driverIds },
      status: { $ne: "cancelled" },
    };
    if (isOwnEmployee(req)) {
      bookingFilter.employeeId = req.tenant.userId;
    }

    const agg = await Booking.aggregate([
      { $match: bookingFilter },
      { $group: { _id: "$driverId", count: { $sum: 1 } } },
    ]);
    bookingCounts = Object.fromEntries(
      agg.map((r) => [String(r._id), r.count])
    );
  }

  const statusAgg = await Driver.aggregate([
    { $match: { ...tenantOnly(req) } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusCount = { available: 0, assigned: 0, inactive: 0 };
  for (const row of statusAgg) {
    if (statusCount[row._id] !== undefined) {
      statusCount[row._id] = row.count;
    }
  }

  const items = drivers.map((d) => ({
    id: id(d._id),
    name: d.name,
    phone: d.phone,
    email: d.email || "",
    status: d.status,
    paymentType: d.paymentType,
    paymentRate: money(toCents(d.paymentRate)),
    salary: canViewFinancials(req) ? money(toCents(d.salary)) : null,
    totalBookings: bookingCounts[id(d._id)] || 0,
  }));

  send(
    res,
    {
      type: "drivers",
      filters: {
        status: req.query.status || null,
        search: req.query.search || null,
      },
      summary: {
        totalDrivers: total,
        ...statusCount,
        active: (statusCount.available || 0) + (statusCount.assigned || 0),
      },
      totals: {
        totalDrivers: total,
      },
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Driver report loaded successfully."
  );
});