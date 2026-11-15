// bookingController.js  (complete updated file)

import mongoose from "mongoose";
import CarInspection from "../models/CarInspection.js";

import { randomBytes } from "node:crypto";

import Booking from "../models/Booking.js";
import Car from "../models/Car.js";
import Customer from "../models/Customer.js";
import Driver from "../models/Driver.js";
import User from "../models/User.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";

import { wrap, send, fail, paging } from "../utils/http.js";
import { scope, tenantOnly, checkRef } from "../services/scope.js";

// ======================================================
// HELPERS
// ======================================================

const toCents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => toCents(value) / 100;
const rentalPaymentTypes = new Set(["advance", "rental", "final"]);
const paymentSummary = (payments) => {
  const totals = { received: 0, refunded: 0, securityReceived: 0, securityRefunded: 0 };
  for (const p of payments) {
    if (p.status !== "completed") continue;
    const value = toCents(p.amount);
    if (rentalPaymentTypes.has(p.type)) totals.received += value;
    else if (p.type === "refund") totals.refunded += value;
    else if (p.type === "security_deposit") totals.securityReceived += value;
    else if (p.type === "security_refund") totals.securityRefunded += value;
  }
  return totals;
};
const assertFinancialUpdate = (booking, payments) => {
  const t = paymentSummary(payments);
  const net = t.received - t.refunded;
  if (toCents(booking.totalAmount) < net)
    throw fail("Booking total cannot be less than rental payments already received. Refund the excess first.", 409);
  if (toCents(booking.securityDeposit) < t.securityReceived)
    throw fail("Required security cannot be reduced below the deposit already received.", 409);
};

const id = (value) =>
  String(value?._id || value || "");

const tenant = (req) => tenantOnly(req);
const bookingScope = (req) => scope(req, "Booking");

const isOwnEmployee = (req) =>
  req.tenant.role === "employee" &&
  req.tenant.dataScope === "own";

const isAdmin = (req) =>
  ["admin", "super-admin"].includes(req.tenant.role);

const makeNumber = (prefix) =>
  `${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;

const checkAmount = (value, name) => {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    typeof value === "boolean" ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  ) {
    throw fail(`Enter a valid ${name}.`, 400);
  }

  return money(value);
};

const checkDates = (pickup, returned) => {
  const start = new Date(pickup);
  const end = new Date(returned);

  if (Number.isNaN(start.getTime())) {
    throw fail("Enter a valid pickup date.", 400);
  }

  if (Number.isNaN(end.getTime())) {
    throw fail("Enter a valid return date.", 400);
  }

  if (end <= start) {
    throw fail("Return date must be after pickup date.", 400);
  }

  return { start, end };
};

const getUnits = (start, end, type) => {
  const duration = end.getTime() - start.getTime();
  const unit = type === "hourly" ? 3600000 : 86400000;

  return Math.ceil(duration / unit);
};

const getRentalTotal = (booking) => {
  const extra = ["extraDayCharges", "extraHourCharges", "extraKmCharges", "lateCharges", "damageCharges", "fuelCharges", "otherCharges"]
    .reduce((sum, key) => sum + toCents(booking[key]), 0);

  const custom = (booking.charges || []).reduce(
    (sum, charge) => sum + toCents(charge.amount),
    0
  );

  return (toCents(booking.rentalAmount) + extra + custom - toCents(booking.discount)) / 100;
};

const addHistory = (booking, text, userId) => {
  booking.history.push({
    text,
    at: new Date(),
    by: userId,
  });
};

// ======================================================
// REFERENCE VALIDATION
// ======================================================

const checkEmployee = async (req, employeeId) => {
  if (!employeeId) return;

  const employee = await User.findOne({
    _id: employeeId,
    ...tenant(req),
    role: "employee",
    status: "active",
  });

  if (!employee) {
    throw fail("Please select an active employee.", 400);
  }
};


const checkRelated = async (req, data) => {
  if (data.customerId) {
    await checkRef(
      Customer,
      data.customerId,
      req,
      "Customer"
    );
  }

  if (data.carId) {
    await checkRef(
      Car,
      data.carId,
      req,
      "Car"
    );
  }

  if (data.driverId) {
    await checkRef(
      Driver,
      data.driverId,
      req,
      "Driver"
    );
  }

  if (data.employeeId !== undefined) {
    if (req.tenant.role === "employee") {
      throw fail(
        "Only an admin can assign or reassign bookings.",
        403
      );
    }

    if (data.employeeId) {
      await checkEmployee(req, data.employeeId);
    }
  }
};


// ======================================================
// DRIVER PAYMENT
// ======================================================

// Driver payment is a business expense.
// It must NOT be added to the customer invoice.

const getDriverPayment = async (
  req,
  driverId,
  rentalAmount,
  override,
  previousBooking = null
) => {
  if (!driverId) {
    if (override !== undefined && Number(override) !== 0) {
      throw fail("Select a driver before setting payment.", 400);
    }

    return {
      driverPaymentType: "fixed",
      driverPaymentAmount: 0,
      driverPaymentRate: 0,
    };
  }

  const driver = await Driver.findOne({
    _id: driverId,
    ...tenant(req),
  });

  if (!driver) {
    throw fail("Driver not found in your business.", 404);
  }

  if (driver.status === "inactive") {
    throw fail("This driver is inactive.", 400);
  }

  const paymentType = driver.paymentType || "fixed";
  const paymentRate = Number(driver.paymentRate || 0);

  if (
    !Number.isFinite(paymentRate) ||
    paymentRate < 0 ||
    (paymentType === "percentage" && paymentRate > 100)
  ) {
    throw fail("Driver has an invalid payment rate.", 400);
  }

  // Preserve an existing agreement if nothing relevant changed.
  if (
    previousBooking &&
    id(previousBooking.driverId) === id(driverId) &&
    money(previousBooking.rentalAmount) === money(rentalAmount) &&
    override === undefined
  ) {
    return {
      driverPaymentType:
        previousBooking.driverPaymentType || "fixed",
      driverPaymentAmount:
        money(previousBooking.driverPaymentAmount),
      driverPaymentRate: money(previousBooking.driverPaymentRate ?? paymentRate),
    };
  }

  let amount =
    paymentType === "percentage"
      ? money(rentalAmount * paymentRate / 100)
      : money(paymentRate);

  if (override !== undefined) {
    if (!isAdmin(req)) {
      throw fail(
        "Only an admin can change driver payment.",
        403
      );
    }

    amount = checkAmount(override, "driver payment");
  }

  return {
    driverPaymentType: paymentType,
    driverPaymentAmount: amount,
    driverPaymentRate: money(paymentRate),
  };
};

// ======================================================
// DRIVER PAYMENT EXPENSE PROTECTION
// ======================================================

const checkDriverExpenses = async (req, booking, newDriverId, session = null) => {
  if (id(booking.driverId) === id(newDriverId)) return;

  const exists = await Expense.exists({
    ...tenant(req),
    bookingId: booking._id,
    category: "driver_payment",
  }).session(session);

  if (exists) {
    throw fail(
      "Driver payment already exists. Settle the driver payment before changing the driver.",
      409
    );
  }
};

// ======================================================
// CAR AVAILABILITY
// ======================================================

const hasCollision = async (
  req,
  carId,
  pickupDate,
  returnDate,
  excludeId = null,
  session = null
) => {
  const filter = {
    ...tenant(req),
    carId,
    status: { $in: ["reserved", "on_rent"] },
    pickupDate: { $lt: returnDate },
    returnDate: { $gt: pickupDate },
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return Boolean(await Booking.exists(filter).session(session));
};

// Driver collision uses the same half-open date window as car reservations.
const hasDriverCollision = async (req, driverId, start, end, excludeId = null, session = null) => {
  if (!driverId) return false;
  const filter = {
    ...tenant(req), driverId,
    status: { $in: ["reserved", "on_rent"] },
    pickupDate: { $lt: end }, returnDate: { $gt: start },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Boolean(await Booking.exists(filter).session(session));
};

// Serialize competing reservations by writing the same Car and Driver documents
// inside a transaction. All booking writers must use this convention.
// Lock all affected resources in deterministic order to avoid deadlocks.
// All other booking writers and inspection handover writers must follow this protocol.
const withReservationLock = async (req, carIds, driverIds, fn) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const resources = [
        ...[...new Set([carIds].flat().filter(Boolean).map(id))].map(key => ({ model: Car, key, kind: "Car" })),
        ...[...new Set([driverIds].flat().filter(Boolean).map(id))].map(key => ({ model: Driver, key, kind: "Driver" })),
      ].sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`));
      for (const resource of resources) {
        const filter = { _id: resource.key, ...tenant(req) };
        if (resource.kind === "Driver") filter.status = { $ne: "inactive" };
        const lock = await resource.model.updateOne(filter, { $inc: { __v: 1 } }, { session });
        if (!lock.matchedCount) throw fail(`${resource.kind} not found or unavailable.`, 409);
      }
      return fn(session);
    });
  } finally { await session.endSession(); }
};


const lockBooking = async (req, bookingId, session) => {
  const filter = {
    _id: bookingId,
    ...bookingScope(req),
  };

  const lock = await Booking.updateOne(
    filter,
    {
      $inc: { __v: 1 },
    },
    { session }
  );

  if (!lock.matchedCount) {
    throw fail(
      "Booking not found or access denied.",
      404
    );
  }

  const booking = await Booking.findOne(filter)
    .session(session);

  if (!booking) {
    throw fail(
      "Booking not found or access denied.",
      404
    );
  }

  return booking;
};


const loadInspectionMap = async (req, bookingIds) => {
  if (!bookingIds.length) return new Map();
  const records = await CarInspection.find({ ...tenant(req), bookingId: { $in: bookingIds } })
    .populate("inspectedBy", "name").lean();
  const map = new Map();
  for (const inspection of records) {
    const key = id(inspection.bookingId);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[inspection.type] = inspection;
  }
  return map;
};

const checkCar = async (req, carId) => {
  const car = await checkRef(Car, carId, req, "Car");

  if (
    ["maintenance", "out_of_service"].includes(car.status)
  ) {
    throw fail("This car is currently unavailable.", 400);
  }

  return car;
};

const getCarRate = (car, type) => {
  const rate = Number(
    type === "hourly" ? car.hourlyRent : car.dailyRent
  );

  if (!Number.isFinite(rate) || rate <= 0) {
    throw fail("Please set a valid car rental rate.", 400);
  }

  return rate;
};

// ======================================================
// POPULATE
// ======================================================

const populateBooking = (query) =>
  query
    .populate("customerId", "name phone photo")
    .populate(
      "carId",
      "name brand model numberPlate images dailyRent hourlyRent status"
    )
    .populate(
      "driverId",
      "name phone paymentType paymentRate"
    )
    .populate("employeeId", "name email")
    .populate("createdBy", "name")
    .populate("issueInspection.inspectedBy", "name")
    .populate("returnInspection.inspectedBy", "name");

// ======================================================
// FORMAT RESPONSE
// ======================================================

const formatInspection = (inspection) => {
  if (!inspection) return null;

  return {
    at: inspection.inspectionDate,
    meter: inspection.meterReading,
    fuel: inspection.fuelLevel,
    condition: inspection.condition,
    damage: inspection.damageNotes || "",
    photos: inspection.photos || [],
    staffId: id(inspection.inspectedBy),
    staffName: inspection.inspectedBy?.name || "",
  };
};

const formatPayment = (payment) => ({
  id: id(payment._id),
  receiptNo: payment.paymentNumber,
  bookingId: id(payment.bookingId),
  type: payment.type,
  amount: payment.amount,
  method: payment.method,
  date: payment.paymentDate,
  receivedBy: id(payment.receivedBy),
  note: payment.transactionReference || "",
});

const formatBooking = (
  booking,
  payments = null,
  driverPaid = 0,
  inspections = null
) => {
  const b = booking.toObject ? booking.toObject() : booking;

  const customer = b.customerId;
  const car = b.carId;
  const driver = b.driverId;
  const employee = b.employeeId;

  const labels = {
    reserved: "Reserved",
    on_rent: "On Rent",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  const payable = money(b.driverPaymentAmount);
  const paidToDriver = money(driverPaid);

  const result = {
    ...b,

    id: id(b._id),
    number: b.bookingNumber,
    invoiceNo: b.invoiceNumber,

    customerId: id(customer),
    customerName: customer?.name || "",
    customerMobile: customer?.phone || "",
    customerPhoto: customer?.photo || "",

    carId: id(car),
    carName: car?.name || "",
    carPlate: car?.numberPlate || "",
    carImage: car?.images?.[0] || "",

    driverId: id(driver),
    driverName: driver?.name || "",

    driverPaymentType: b.driverPaymentType || "fixed",
    driverPaymentAmount: payable,
    driverPaymentRate: b.driverPaymentRate == null ? null : money(b.driverPaymentRate),
    driverPaid: paidToDriver,
    driverPending: money(
      Math.max(0, payable - paidToDriver)
    ),

    staffId: id(employee),
    staffName:
      employee?.name || b.createdBy?.name || "",

    pickupAt: b.pickupDate,
    returnAt: b.returnDate,

    rateType: b.rentType,
    rate: b.rentRate,
    days: b.rentalUnits,
    rentAmount: b.rentalAmount,

    total: b.totalAmount,

    status: labels[b.status] || b.status,
    displayStatus: labels[b.status] || b.status,

    instructions: b.specialInstructions || "",

    issue: formatInspection(inspections?.issue || b.issueInspection),
    returnInfo: formatInspection(inspections?.return || b.returnInspection),

    charges: [
      ...(b.charges || []),

      ...[
        ["Extra Day Charge", b.extraDayCharges],
        ["Extra Hour Charge", b.extraHourCharges],
        ["Extra Kilometer Charge", b.extraKmCharges],
        ["Late Return Charge", b.lateCharges],
        ["Damage Charge", b.damageCharges],
        ["Fuel Charge", b.fuelCharges],
        ["Other Charge", b.otherCharges],
      ]
        .filter(([, amount]) => Number(amount) > 0)
        .map(([label, amount]) => ({
          label,
          amount,
        })),
    ],

    history: b.history || [],

    depositPaid: b.securityReceived || 0,
    depositRefunded: b.securityRefunded || 0,
    depositAdjusted: b.securityDeduction || 0,

    depositHeld: money(
      Math.max(
        0,
        (b.securityReceived || 0) -
        (b.securityRefunded || 0) -
        (b.securityDeduction || 0)
      )
    ),
  };

  if (payments !== null) {
    const completed = payments.filter(
      (p) => p.status === "completed"
    );

    const t = paymentSummary(completed);
    const netPaid = t.received - t.refunded;
    result.paid = money(netPaid / 100);
    result.received = t.received / 100;
    result.refunded = t.refunded / 100;
    result.balance = Math.max(0, toCents(b.totalAmount) - netPaid) / 100;
    result.outstanding = result.balance;
    result.depositPaid = t.securityReceived / 100;
    result.depositRefunded = t.securityRefunded / 100;
    result.depositHeld = Math.max(0, t.securityReceived - t.securityRefunded - toCents(b.securityDeduction)) / 100;

    result.payments = completed.map(formatPayment);
  }

  return result;
};

// ======================================================
// PAYMENT HELPERS
// ======================================================

const getPayments = (req, bookingId) =>
  Payment.find({
    ...tenant(req),
    bookingId,
    status: "completed",
  })
    .sort({ paymentDate: -1 })
    .lean();

const getDriverPaid = async (req, bookingId, driverId, session = null) => {
  if (!driverId) return 0;

  const expenses = await Expense.find({
    ...tenant(req),
    bookingId,
    driverId,
    category: "driver_payment",
  })
    .select("amount")
    .session(session)
    .lean();

  return money(
    expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    )
  );
};

// Helper used by create / update / extend / cancel so the client always
// receives the same shape as getBooking / listBookings.
const loadAndFormatBooking = async (req, bookingId) => {
  const booking = await populateBooking(
    Booking.findOne({
      _id: bookingId,
      ...bookingScope(req),
    })
  ).lean();

  if (!booking) {
    throw fail("Booking not found or access denied.", 404);
  }

  const [payments, driverPaid] = await Promise.all([
    getPayments(req, booking._id),
    getDriverPaid(req, booking._id, booking.driverId),
  ]);

  const inspectionMap = await loadInspectionMap(req, [booking._id]);
  return formatBooking(
    booking,
    payments,
    driverPaid,
    inspectionMap.get(id(booking._id)) || null
  );
};

// ======================================================
// REMINDERS (reusable for dashboard / centralized reminders)
// ======================================================

/**
 * Collect booking-related reminders for the current tenant / employee scope.
 * Safe to call from dashboardController (or anywhere) – does not touch res.
 *
 * @param {import("express").Request} req  Authenticated request with req.tenant
 * @param {number} [daysBefore=7]  Horizon in days (normally Setting.reminderDaysBefore)
 * @returns {Promise<Array>} Array of reminder objects
 */
export const collectBookingReminders = async (req, daysBefore = 7) => {
  const requestedDays = Number(daysBefore);

  const horizonDays = Number.isFinite(requestedDays)
    ? Math.max(0, Math.min(365, requestedDays))
    : 7;
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86400000);

  // Date-only key (UTC YYYY-MM-DD) so a completed reminder for one day
  // does not suppress the same logical reminder on a later day.
  const dateKey = (d) => {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "invalid";
    return dt.toISOString().slice(0, 10);
  };

  const filter = {
    ...bookingScope(req),
    status: { $ne: "cancelled" },
  };

  const bookings = await Booking.find(filter)
    .populate("customerId", "name phone")
    .populate("carId", "name numberPlate brand model")
    .select(
      "_id bookingNumber invoiceNumber customerId carId status " +
      "pickupDate returnDate actualReturnDate updatedAt " +
      "totalAmount securityDeposit securityReceived " +
      "securityRefunded securityDeduction"
    )
    .lean();

  if (!bookings.length) return [];

  const bookingIds = bookings.map((b) => b._id);

  // Batch-load completed payments so we can compute outstanding balances.
  const payments = await Payment.find({
    ...tenant(req),
    bookingId: { $in: bookingIds },
    status: "completed",
  })
    .select("bookingId type amount status")
    .lean();

  const paymentMap = new Map();
  for (const p of payments) {
    const key = id(p.bookingId);
    if (!paymentMap.has(key)) paymentMap.set(key, []);
    paymentMap.get(key).push(p);
  }

  const reminders = [];
  const seen = new Set(); // guard against accidental duplicates

  const push = (reminder) => {
    if (seen.has(reminder.id)) return;
    seen.add(reminder.id);
    reminders.push(reminder);
  };

  for (const booking of bookings) {
    const bookingId = id(booking._id);
    const customerName = booking.customerId?.name || "Customer";
    const carName =
      booking.carId?.name ||
      [booking.carId?.brand, booking.carId?.model].filter(Boolean).join(" ") ||
      "Vehicle";
    const carPlate = booking.carId?.numberPlate || "";
    const bookingNumber = booking.bookingNumber || bookingId;

    const pickup = booking.pickupDate ? new Date(booking.pickupDate) : null;
    const ret = booking.returnDate ? new Date(booking.returnDate) : null;

    // ----- 1. Upcoming pickups (reserved only) -----
    if (
      booking.status === "reserved" &&
      pickup &&
      pickup >= now &&
      pickup <= horizon
    ) {
      const daysLeft = Math.ceil((pickup.getTime() - now.getTime()) / 86400000);
      const category = daysLeft <= 1 ? "due_soon" : "upcoming";
      const priority = daysLeft <= 1 ? "high" : daysLeft <= 3 ? "medium" : "low";

      push({
        id: `pickup:${bookingId}:${dateKey(pickup)}`,
        bookingId,
        bookingNumber,
        type: "pickup",
        category,
        priority,
        dueDate: pickup,
        message: `Pickup for ${carName}${carPlate ? ` (${carPlate})` : ""} with ${customerName} is due on ${pickup.toLocaleDateString()}.`,
        customerName,
        customerPhone: booking.customerId?.phone || "",
        carName,
        carPlate,
        status: booking.status,
      });
    }

    // ----- 2. Upcoming returns (reserved or on_rent) -----
    if (
      ["reserved", "on_rent"].includes(booking.status) &&
      ret &&
      ret >= now &&
      ret <= horizon
    ) {
      const daysLeft = Math.ceil((ret.getTime() - now.getTime()) / 86400000);
      const category = daysLeft <= 1 ? "due_soon" : "upcoming";
      const priority = daysLeft <= 1 ? "high" : daysLeft <= 3 ? "medium" : "low";

      push({
        id: `return:${bookingId}:${dateKey(ret)}`,
        bookingId,
        bookingNumber,
        type: "return",
        category,
        priority,
        dueDate: ret,
        message: `Return of ${carName}${carPlate ? ` (${carPlate})` : ""} from ${customerName} is due on ${ret.toLocaleDateString()}.`,
        customerName,
        customerPhone: booking.customerId?.phone || "",
        carName,
        carPlate,
        status: booking.status,
      });
    }

    // ----- 3. Overdue returns (on_rent past returnDate) -----
    if (booking.status === "on_rent" && ret && ret < now) {
      const daysOver = Math.ceil((now.getTime() - ret.getTime()) / 86400000);

      push({
        id: `overdue_return:${bookingId}:${dateKey(ret)}`,
        bookingId,
        bookingNumber,
        type: "overdue_return",
        category: "overdue",
        priority: "high",
        dueDate: ret,
        message: `${carName}${carPlate ? ` (${carPlate})` : ""} rented by ${customerName} is ${daysOver} day${daysOver === 1 ? "" : "s"} overdue (due ${ret.toLocaleDateString()}).`,
        customerName,
        customerPhone: booking.customerId?.phone || "",
        carName,
        carPlate,
        status: booking.status,
        daysOverdue: daysOver,
      });
    }

    // ----- 4. Outstanding / partial balances -----
    // Consider any non-cancelled booking that still has a rental balance.
    const completedPayments = paymentMap.get(bookingId) || [];
    const t = paymentSummary(completedPayments);
    const netPaid = t.received - t.refunded;
    const balanceCents = Math.max(0, toCents(booking.totalAmount) - netPaid);
    const balance = money(balanceCents / 100);

    if (balance > 0) {
      // For completed bookings the due date is the actual/expected return;
      // for active ones we treat the return date (or now if already overdue) as the due date.
      let due = ret || now;
      if (booking.status === "completed") {
        due = booking.actualReturnDate || ret || booking.updatedAt || now;
      } else if (ret && ret < now) {
        due = ret;
      }

      const isOverdue =
        booking.status === "completed" ||
        (ret && ret < now) ||
        booking.status === "on_rent";

      const category = isOverdue ? "overdue" : "due_soon";
      const priority = isOverdue || balanceCents >= 500000 ? "high" : "medium"; // ≥ 5 000 PKR

      push({
        id: `balance:${bookingId}:${dateKey(due)}`,
        bookingId,
        bookingNumber,
        type: "balance",
        category,
        priority,
        dueDate: due,
        message: `Outstanding balance of ${balance.toLocaleString("en-PK", {
          style: "currency",
          currency: "PKR",
          maximumFractionDigits: 0,
        })} on booking ${bookingNumber} (${customerName} – ${carName}).`,
        customerName,
        customerPhone: booking.customerId?.phone || "",
        carName,
        carPlate,
        status: booking.status,
        balance,
        totalAmount: money(booking.totalAmount),
        paid: money(netPaid / 100),
      });
    }
  }

  // Stable sort: overdue first, then by due date ascending, then by priority.
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const categoryOrder = { overdue: 0, due_soon: 1, upcoming: 2 };

  reminders.sort((a, b) => {
    const cat = (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9);
    if (cat !== 0) return cat;
    const da = new Date(a.dueDate).getTime();
    const db = new Date(b.dueDate).getTime();
    if (da !== db) return da - db;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });

  return reminders;
};

// ======================================================
// 1. LIST BOOKINGS
// GET /api/v1/bookings
// ======================================================

export const listBookings = wrap(async (req, res) => {
  const filter = { ...bookingScope(req) };

  const {
    search,
    status,
    customerId,
    carId,
    employeeId,
    from,
    to,
  } = req.query;

  if (status) filter.status = status;
  if (customerId) filter.customerId = customerId;
  if (carId) filter.carId = carId;

  if (employeeId) {
    if (
      isOwnEmployee(req) &&
      id(employeeId) !== id(req.tenant.userId)
    ) {
      throw fail("You can only view your own bookings.", 403);
    }

    filter.employeeId = employeeId;
  }

  if (from || to) {
    filter.pickupDate = {};

    if (from) {
      const start = new Date(from);

      if (Number.isNaN(start.getTime())) {
        throw fail("Invalid start date.", 400);
      }

      filter.pickupDate.$gte = start;
    }

    if (to) {
      const end = new Date(to);

      if (Number.isNaN(end.getTime())) {
        throw fail("Invalid end date.", 400);
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        end.setUTCDate(end.getUTCDate() + 1);
        filter.pickupDate.$lt = end;
      } else {
        filter.pickupDate.$lte = end;
      }
    }
  }

  if (search?.trim()) {
    const escaped = search
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { bookingNumber: regex },
      { invoiceNumber: regex },
    ];
  }

  const { page, limit } = paging(req.query);

  const [bookings, total] = await Promise.all([
    populateBooking(
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
    ).lean(),

    Booking.countDocuments(filter),
  ]);

  const bookingIds = bookings.map((b) => b._id);

  const inspectionMap = await loadInspectionMap(req, bookingIds);

  const [payments, expenses] = bookingIds.length
    ? await Promise.all([
      Payment.find({
        ...tenant(req),
        bookingId: { $in: bookingIds },
        status: "completed",
      }).lean(),

      Expense.find({
        ...tenant(req),
        bookingId: { $in: bookingIds },
        category: "driver_payment",
      })
        .select("bookingId driverId amount")
        .lean(),
    ])
    : [[], []];

  const paymentMap = new Map();
  const expenseMap = new Map();

  for (const payment of payments) {
    const key = id(payment.bookingId);

    if (!paymentMap.has(key)) {
      paymentMap.set(key, []);
    }

    paymentMap.get(key).push(payment);
  }

  for (const expense of expenses) {
    const key = `${id(expense.bookingId)}:${id(expense.driverId)}`;

    expenseMap.set(
      key,
      money((expenseMap.get(key) || 0) + expense.amount)
    );
  }

  const items = bookings.map((booking) => {
    const key = `${id(booking._id)}:${id(booking.driverId)}`;

    return formatBooking(
      booking,
      paymentMap.get(id(booking._id)) || [],
      expenseMap.get(key) || 0,
      inspectionMap.get(id(booking._id)) || null
    );
  });

  send(res, {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ======================================================
// 2. GET SINGLE BOOKING
// GET /api/v1/bookings/:id
// ======================================================

export const getBooking = wrap(async (req, res) => {
  send(res, await loadAndFormatBooking(req, req.params.id));
});

// ======================================================
// 3. CHECK CAR AVAILABILITY
// GET /api/v1/bookings/availability
// ======================================================

export const checkAvailability = wrap(async (req, res) => {
  const {
    carId,
    pickupDate,
    returnDate,
    excludeBookingId,
  } = req.query;

  if (!carId) {
    throw fail("Please select a car.", 400);
  }

  const car = await checkCar(req, carId);
  const { start, end } = checkDates(pickupDate, returnDate);

  let excludeId = null;

  if (excludeBookingId) {
    const booking = await Booking.findOne({
      _id: excludeBookingId,
      ...bookingScope(req),
    });

    if (!booking) {
      throw fail("Booking not found.", 404);
    }

    if (id(booking.carId) !== id(carId)) {
      throw fail(
        "The selected booking belongs to another car.",
        400
      );
    }

    excludeId = booking._id;
  }

  const collision = await hasCollision(
    req,
    carId,
    start,
    end,
    excludeId
  );

  send(res, {
    available: !collision,
    reason: collision
      ? "Car is already booked for these dates."
      : "",
  });
});

// ======================================================
// 4. CREATE BOOKING
// POST /api/v1/bookings
// ======================================================

export const createBooking = wrap(async (req, res) => {
  const d = req.body;

  await checkRelated(req, d);

  const car = await checkCar(req, d.carId);

  const { start, end } = checkDates(
    d.pickupDate,
    d.returnDate
  );

  const type = d.rentType || "daily";
  if (!["daily", "hourly"].includes(type)) throw fail("Invalid rental type.", 400);
  const rate = getCarRate(car, type);
  const units = getUnits(start, end, type);
  const rentAmount = money(units * rate);

  const discount = checkAmount(
    d.discount ?? 0,
    "discount"
  );

  if (discount > rentAmount) {
    throw fail(
      "Discount cannot exceed the rental amount.",
      400
    );
  }

  const driverId = d.driverId || null;

  const driverPay = await getDriverPayment(
    req,
    driverId,
    rentAmount,
    d.driverPaymentAmount
  );

  const employeeId = isOwnEmployee(req)
    ? req.tenant.userId
    : d.employeeId || null;

  const booking = await withReservationLock(req, d.carId, driverId, async (session) => {
    const currentCar = await Car.findOne({ _id: d.carId, ...tenant(req) }).session(session);
    if (!currentCar || ["maintenance", "out_of_service"].includes(currentCar.status)) throw fail("Car is unavailable.", 409);
    const carConflict = await Booking.exists({
      ...tenant(req), carId: d.carId,
      status: { $in: ["reserved", "on_rent"] },
      pickupDate: { $lt: end }, returnDate: { $gt: start }
    }).session(session);
    if (carConflict) throw fail("This car is already booked for the selected dates.", 409);
    if (await hasDriverCollision(req, driverId, start, end, null, session))
      throw fail("This driver is already assigned during these dates.", 409);
    const [created] = await Booking.create([{
      ...tenant(req),

      bookingNumber: makeNumber("BKG"),
      invoiceNumber: makeNumber("INV"),

      customerId: d.customerId,
      carId: d.carId,
      driverId,
      ...driverPay,
      employeeId,

      createdBy: req.tenant.userId,

      pickupDate: start,
      returnDate: end,

      pickupLocation: d.pickupLocation || "",
      returnLocation: d.returnLocation || "",

      rentType: type,
      rentRate: rate,
      rentalUnits: units,
      rentalAmount: rentAmount,
      discount,

      totalAmount: money(rentAmount - discount),

      securityDeposit: checkAmount(
        d.securityDeposit ?? 0,
        "security deposit"
      ),
      securityStatus: Number(d.securityDeposit || 0) > 0 ? "pending" : "none",

      specialInstructions: d.specialInstructions || "",

      status: "reserved",

      history: [
        {
          text: "Booking created",
          at: new Date(),
          by: req.tenant.userId,
        },
      ],
    }], { session });
    return created;
  });

  // Always return the same shape used by getBooking / listBookings
  const formatted = await loadAndFormatBooking(req, booking._id);
  send(res, formatted, "Booking created successfully.", 201);
});

// ======================================================
// 5. UPDATE BOOKING
// PATCH /api/v1/bookings/:id
// ======================================================

export const updateBooking = wrap(async (req, res) => {
  const d = req.body;
  await checkRelated(req, d);
  const existing = await Booking.findOne({ _id: req.params.id, ...bookingScope(req) }).lean();
  if (!existing) throw fail("Booking not found or access denied.", 404);
  if (existing.status !== "reserved") throw fail("Only reserved bookings can be edited.", 409);
  const newCarId = d.carId || existing.carId;
  const newDriverId = d.driverId !== undefined ? d.driverId || null : existing.driverId;
  const updated = await withReservationLock(req, [existing.carId, newCarId], [existing.driverId, newDriverId], async session => {
    const booking = await lockBooking(req, existing._id, session);
    if (booking.status !== "reserved") throw fail("Only reserved bookings can be edited.", 409);
    // A concurrent request may have changed the resources before locks were acquired.
    if (id(booking.carId) !== id(existing.carId) || id(booking.driverId) !== id(existing.driverId))
      throw fail("Booking assignment changed. Please reload and retry.", 409);
    const car = await Car.findOne({ _id: newCarId, ...tenant(req) }).session(session);
    if (!car || ["maintenance", "out_of_service"].includes(car.status)) throw fail("Car unavailable.", 409);
    const { start, end } = checkDates(d.pickupDate ?? booking.pickupDate, d.returnDate ?? booking.returnDate);
    if (await hasCollision(req, newCarId, start, end, booking._id, session))
      throw fail("This car is already booked for these dates.", 409);
    if (await hasDriverCollision(req, newDriverId, start, end, booking._id, session))
      throw fail("This driver is already assigned during these dates.", 409);
    await checkDriverExpenses(req, booking, newDriverId, session);
    const type = d.rentType || booking.rentType;
    if (!["daily", "hourly"].includes(type)) throw fail("Invalid rental type.", 400);
    const rate = id(newCarId) !== id(booking.carId) || type !== booking.rentType
      ? getCarRate(car, type) : booking.rentRate;
    const units = getUnits(start, end, type);
    const rentAmount = money(units * rate);
    const discount = d.discount !== undefined ? checkAmount(d.discount, "discount") : booking.discount;
    if (discount > rentAmount) throw fail("Discount cannot exceed rental amount.", 400);
    const driverPay = await getDriverPayment(req, newDriverId, rentAmount, d.driverPaymentAmount, booking);
    const alreadyPaid = await getDriverPaid(req, booking._id, newDriverId, session);
    if (toCents(driverPay.driverPaymentAmount) < toCents(alreadyPaid))
      throw fail("Driver payment cannot be less than amount already paid.", 409);
    if (d.customerId !== undefined && id(d.customerId) !== id(booking.customerId)) {
      const existingPayments = await Payment.exists({ ...tenant(req), bookingId: booking._id }).session(session);
      if (existingPayments) throw fail("Cannot change customer after payment activity.", 409);
      booking.customerId = d.customerId;
    }
    booking.carId = newCarId;
    booking.driverId = newDriverId;
    booking.pickupDate = start;
    booking.returnDate = end;
    booking.rentType = type;
    booking.rentRate = rate;
    booking.rentalUnits = units;
    booking.rentalAmount = rentAmount;
    booking.discount = discount;
    Object.assign(booking, driverPay);
    if (d.employeeId !== undefined && !isOwnEmployee(req)) booking.employeeId = d.employeeId || null;
    for (const field of ["pickupLocation", "returnLocation", "specialInstructions"]) {
      if (d[field] !== undefined) booking[field] = d[field];
    }
    if (d.securityDeposit !== undefined) {
      booking.securityDeposit = checkAmount(d.securityDeposit, "security deposit");
      if (!booking.securityReceived) booking.securityStatus = booking.securityDeposit ? "pending" : "none";
    }
    booking.totalAmount = getRentalTotal(booking);
    if (booking.totalAmount < 0) throw fail("Booking total cannot be negative.", 400);
    const payments = await Payment.find({ ...tenant(req), bookingId: booking._id, status: "completed" }).session(session).lean();
    assertFinancialUpdate(booking, payments);
    addHistory(booking, "Booking updated", req.tenant.userId);
    await booking.save({ session });
    return booking;
  });

  const formatted = await loadAndFormatBooking(req, updated._id);
  send(res, formatted, "Booking updated successfully.");
});

// ======================================================
// 6. EXTEND BOOKING
// PATCH /api/v1/bookings/:id/extend
// ======================================================
export const extendBooking = wrap(async (req, res) => {
  const existing = await Booking.findOne({ _id: req.params.id, ...bookingScope(req) }).lean();
  if (!existing) throw fail("Booking not found.", 404);
  if (!["reserved", "on_rent"].includes(existing.status)) throw fail("This booking cannot be extended.", 409);
  const updated = await withReservationLock(req, existing.carId, existing.driverId, async session => {
    const booking = await lockBooking(req, existing._id, session);
    if (!["reserved", "on_rent"].includes(booking.status)) throw fail("This booking cannot be extended.", 409);
    if (id(booking.carId) !== id(existing.carId) || id(booking.driverId) !== id(existing.driverId))
      throw fail("Booking assignment changed. Please reload and retry.", 409);
    const { end } = checkDates(booking.pickupDate, req.body.returnDate || req.body.returnAt);
    if (end <= booking.returnDate) throw fail("Please select a later return date.", 400);
    if (await hasCollision(req, booking.carId, booking.pickupDate, end, booking._id, session))
      throw fail("Another booking exists during this extension.", 409);
    if (await hasDriverCollision(req, booking.driverId, booking.pickupDate, end, booking._id, session))
      throw fail("Driver is already booked during the extended dates.", 409);
    booking.returnDate = end;
    booking.rentalUnits = getUnits(booking.pickupDate, end, booking.rentType);
    booking.rentalAmount = money(booking.rentalUnits * booking.rentRate);
    if (booking.driverId && booking.driverPaymentType === "percentage") {
      const rate = Number(booking.driverPaymentRate);
      if (booking.driverPaymentRate == null || !Number.isFinite(rate) || rate < 0 || rate > 100)
        throw fail("Historical driver percentage rate is invalid.", 409);
      booking.driverPaymentAmount = money(booking.rentalAmount * rate / 100);
    }
    const alreadyPaid = await getDriverPaid(req, booking._id, booking.driverId, session);
    if (toCents(booking.driverPaymentAmount) < toCents(alreadyPaid))
      throw fail("Extension would reduce driver payment below amount paid.", 409);
    booking.totalAmount = getRentalTotal(booking);
    if (booking.totalAmount < 0) throw fail("Booking total cannot be negative.", 400);
    const payments = await Payment.find({ ...tenant(req), bookingId: booking._id, status: "completed" }).session(session).lean();
    assertFinancialUpdate(booking, payments);
    addHistory(booking, "Booking extended", req.tenant.userId);
    await booking.save({ session });
    return booking;
  });

  const formatted = await loadAndFormatBooking(req, updated._id);
  send(res, formatted, "Booking extended successfully.");
});

// ======================================================
// 7. CANCEL BOOKING
// PATCH /api/v1/bookings/:id/cancel
// ======================================================
export const cancelBooking = wrap(async (req, res) => {
  const existing = await Booking.findOne({ _id: req.params.id, ...bookingScope(req) }).lean();
  if (!existing) throw fail("Booking not found.", 404);
  if (existing.status !== "reserved") throw fail("Only reserved bookings can be cancelled.", 409);
  const updated = await withReservationLock(req, existing.carId, existing.driverId, async session => {
    const booking = await lockBooking(req, existing._id, session);
    if (booking.status !== "reserved") throw fail("Only reserved bookings can be cancelled.", 409);
    const [payments, driverExpense] = await Promise.all([
      Payment.find({ ...tenant(req), bookingId: booking._id, status: "completed" }).session(session).lean(),
      Expense.exists({ ...tenant(req), bookingId: booking._id, category: "driver_payment" }).session(session),
    ]);
    const t = paymentSummary(payments);
    const rentalNet = t.received - t.refunded;
    const securityHeld = t.securityReceived - t.securityRefunded - toCents(booking.securityDeduction);
    if (req.body.refundAdvance || rentalNet !== 0 || securityHeld !== 0 || driverExpense)
      throw fail("Settle rental payments, security deposits and driver expenses before cancellation.", 409);
    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancelledBy = req.tenant.userId;
    booking.cancellationReason = req.body.reason || "Cancelled by staff";
    addHistory(booking, "Booking cancelled", req.tenant.userId);
    await booking.save({ session });
    return booking;
  });

  const formatted = await loadAndFormatBooking(req, updated._id);
  send(res, formatted, "Booking cancelled successfully.");
});

// ======================================================
// 8. BOOKING STATISTICS
// GET /api/v1/bookings/stats
// ======================================================

export const getBookingStats = wrap(async (req, res) => {
  const filter = bookingScope(req);

  const [
    total,
    reserved,
    onRent,
    completed,
    cancelled,
    totals,
  ] = await Promise.all([
    Booking.countDocuments(filter),

    Booking.countDocuments({
      ...filter,
      status: "reserved",
    }),

    Booking.countDocuments({
      ...filter,
      status: "on_rent",
    }),

    Booking.countDocuments({
      ...filter,
      status: "completed",
    }),

    Booking.countDocuments({
      ...filter,
      status: "cancelled",
    }),

    Booking.aggregate([
      {
        $match: {
          ...filter,
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$totalAmount" },
          driverPayable: { $sum: "$driverPaymentAmount" },
        },
      },
    ]),
  ]);

  send(res, {
    total,
    reserved,
    onRent,
    completed,
    cancelled,
    totalBookingValue: totals[0]?.totalAmount || 0,
    totalDriverPayable: totals[0]?.driverPayable || 0,
  });
});