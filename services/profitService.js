
import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import Car from "../models/Car.js";

import { dateWindow, fail } from "../utils/http.js";
import { tenantOnly, scope } from "./scope.js";

// ======================================================
// PROFIT SERVICE
// ======================================================
//
// Accounting rules:
//
// 1. Rental revenue comes from completed bookings.
//
// 2. Revenue is recognized on actualReturnDate.
//    If actualReturnDate is missing, updatedAt is used.
//
// 3. Expenses are counted by expenseDate.
//
// 4. Maintenance expenses (repair, service, oil change,
//    tyres, brakes, inspection) are already stored in
//    Expense and are deducted only once.
//
// 5. Security deposits and security refunds are excluded
//    from rental receipts.
//
// 6. This is a completion-date profit report, not a
//    daily rental accrual report.
//
// ======================================================

// ======================================================
// CONSTANTS
// ======================================================

const RENTAL_PAYMENT_TYPES = new Set([
  "advance",
  "rental",
  "final",
]);

const MAINTENANCE_CATEGORIES = new Set([
  "repair",
  "service",
  "oil_change",
  "tyres",
  "brakes",
  "inspection",
]);

// ======================================================
// MONEY HELPERS
// ======================================================

const cents = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.round(amount * 100);
};

const money = (value) => {
  return Math.round(value) / 100;
};

const sumAmount = (items, field = "amount") => {
  return items.reduce(
    (total, item) => total + cents(item[field]),
    0
  );
};

// ======================================================
// ACCESS HELPERS
// ======================================================

const isOwnEmployee = (req) => {
  return (
    req.tenant?.role === "employee" &&
    req.tenant?.dataScope === "own"
  );
};

const validateAccess = (req) => {
  // Profit is a business-wide financial calculation.
  // Own-scope employees must not receive totals
  // containing records outside their data scope.

  if (isOwnEmployee(req)) {
    throw fail(
      "Profit reports are not available for employees with own-data access.",
      403
    );
  }
};

// ======================================================
// CAR VALIDATION
// ======================================================

const validateCar = async (req, carId) => {
  if (!carId) {
    return null;
  }

  if (!mongoose.isObjectIdOrHexString(carId)) {
    throw fail("Invalid car ID.", 400);
  }

  const car = await Car.findOne({
    _id: carId,
    ...scope(req, "Car"),
  })
    .select("_id name numberPlate")
    .lean();

  if (!car) {
    throw fail(
      "Car was not found or you do not have access to it.",
      404
    );
  }

  return car;
};

// ======================================================
// COMPLETION DATE FILTER
// ======================================================

const getCompletionDateFilter = (req) => {
  const filter = dateWindow(
    req.query || {},
    "actualReturnDate"
  );

  const range = filter.actualReturnDate;

  if (!range) {
    return {};
  }

  return {
    $or: [
      {
        actualReturnDate: range,
      },
      {
        actualReturnDate: null,
        updatedAt: range,
      },
    ],
  };
};

// ======================================================
// PAYMENT CALCULATION
// ======================================================

const calculatePayments = (payments) => {
  let received = 0;
  let refunded = 0;

  for (const payment of payments) {
    if (payment.status !== "completed") {
      continue;
    }

    const amount = cents(payment.amount);

    if (RENTAL_PAYMENT_TYPES.has(payment.type)) {
      received += amount;
    } else if (payment.type === "refund") {
      refunded += amount;
    }

    // security_deposit and security_refund
    // are intentionally excluded.
  }

  return {
    received,
    refunded,
    netReceived: received - refunded,
  };
};

// ======================================================
// EXPENSE BREAKDOWN
// ======================================================

const calculateExpenses = (expenses) => {
  const breakdown = {};

  let total = 0;
  let maintenance = 0;

  for (const expense of expenses) {
    const amount = cents(expense.amount);
    const category = expense.category || "other";

    total += amount;

    if (MAINTENANCE_CATEGORIES.has(category)) {
      maintenance += amount;
    }

    breakdown[category] =
      (breakdown[category] || 0) + amount;
  }

  return {
    total,
    maintenance,
    breakdown: Object.entries(breakdown)
      .map(([category, amount]) => ({
        category,
        amount: money(amount),
      }))
      .sort((a, b) => b.amount - a.amount),
  };
};

// ======================================================
// MAIN PROFIT CALCULATION
// ======================================================

export const calculateProfit = async (
  req,
  carId = null
) => {
  // --------------------------------------------------
  // 1. VALIDATE ACCESS
  // --------------------------------------------------

  validateAccess(req);

  // --------------------------------------------------
  // 2. TENANT AND CAR
  // --------------------------------------------------

  const tenant = tenantOnly(req);

  const car = await validateCar(req, carId);

  const baseFilter = car
    ? {
        ...tenant,
        carId: car._id,
      }
    : {
        ...tenant,
      };

  // --------------------------------------------------
  // 3. DATE FILTERS
  // --------------------------------------------------

  const completionFilter =
    getCompletionDateFilter(req);

  const expenseFilter = dateWindow(
    req.query || {},
    "expenseDate"
  );

  // --------------------------------------------------
  // 4. COMPLETED BOOKINGS
  // --------------------------------------------------

  const completed = await Booking.find({
    ...baseFilter,
    status: "completed",
    ...completionFilter,
  })
    .select(
      "_id carId totalAmount actualReturnDate updatedAt"
    )
    .lean();

  const bookingIds = completed.map(
    (booking) => booking._id
  );

  // Revenue from completed rentals.
  const revenueCents = sumAmount(
    completed,
    "totalAmount"
  );

  // --------------------------------------------------
  // 5. RENTAL PAYMENTS
  // --------------------------------------------------

  const linkedPayments = bookingIds.length
    ? await Payment.find({
        ...tenant,
        bookingId: {
          $in: bookingIds,
        },
        status: "completed",
      })
        .select(
          "bookingId amount type status paymentDate"
        )
        .lean()
    : [];

  const paymentTotals =
    calculatePayments(linkedPayments);

  const receivedCents =
    paymentTotals.netReceived;

  // This is cash received for bookings completed
  // in the selected period, not necessarily cash
  // received during that calendar period.

  // --------------------------------------------------
  // 6. EXPENSES
  // --------------------------------------------------

  const expenses = await Expense.find({
    ...baseFilter,
    ...expenseFilter,
  })
    .select(
      "_id amount category carId bookingId expenseDate"
    )
    .lean();

  const expenseTotals =
    calculateExpenses(expenses);

  const expenseCents =
    expenseTotals.total;

  // Maintenance is already included in total expenses.
  // Do not subtract it separately.

  const maintenanceExpenseCents =
    expenseTotals.maintenance;

  // --------------------------------------------------
  // 7. PROFIT
  // --------------------------------------------------

  const profitCents =
    revenueCents - expenseCents;

  const pendingCents =
    revenueCents - receivedCents;

  const profitMargin =
    revenueCents > 0
      ? Math.round(
          (profitCents / revenueCents) * 10000
        ) / 100
      : null;

  // --------------------------------------------------
  // 8. BUSINESS-WIDE EXPENSES
  // --------------------------------------------------

  // Expenses without carId are included in overall
  // business profit but excluded from car-specific profit.

  const unallocatedExpensesCents = car
    ? 0
    : expenses
        .filter((expense) => !expense.carId)
        .reduce(
          (sum, expense) =>
            sum + cents(expense.amount),
          0
        );

  // --------------------------------------------------
  // 9. RESPONSE
  // --------------------------------------------------

  return {
    period: {
      from: req.query?.from || null,
      to: req.query?.to || null,
    },

    carId: car ? String(car._id) : null,

    car: car
      ? {
          id: String(car._id),
          name: car.name,
          numberPlate: car.numberPlate,
        }
      : null,

    completedBookings: completed.length,

    // ----------------------------------------------
    // REVENUE
    // ----------------------------------------------

    earnedRentalRevenue: money(
      revenueCents
    ),

    // ----------------------------------------------
    // PAYMENTS
    // ----------------------------------------------

    cashReceivedForCompletedBookings: money(
      receivedCents
    ),

    rentalPaymentsReceived: money(
      paymentTotals.received
    ),

    rentalPaymentsRefunded: money(
      paymentTotals.refunded
    ),

    pendingRentalAmount: money(
      pendingCents
    ),

    // ----------------------------------------------
    // EXPENSES
    // ----------------------------------------------

    recordedExpenses: money(
      expenseCents
    ),

    maintenanceExpenses: money(
      maintenanceExpenseCents
    ),

    expenseBreakdown:
      expenseTotals.breakdown,

    unallocatedBusinessExpenses: car
      ? null
      : money(unallocatedExpensesCents),

    // ----------------------------------------------
    // PROFIT
    // ----------------------------------------------

    estimatedOperatingProfit: money(
      profitCents
    ),

    operatingProfitMarginPercent:
      profitMargin,

    // ----------------------------------------------
    // ACCOUNTING
    // ----------------------------------------------

    currency: "PKR",

    accountingBasis:
      "Completed rental revenue by actualReturnDate (fallback updatedAt), expenses by expenseDate.",

    warnings: [
      "Rental revenue is recognized when bookings are completed, not allocated across individual rental days.",

      "Maintenance expenses are already included in recordedExpenses and are not deducted twice.",

      "Security deposits and security refunds are excluded from rental receipts.",

      "Cash received for completed bookings includes payments associated with those bookings regardless of payment date.",

      "Individual car profit excludes business-wide expenses without carId.",

      "Security deductions are not recognized separately unless already included in Booking.totalAmount.",
    ],
  };
};
