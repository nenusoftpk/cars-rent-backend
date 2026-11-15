
import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Customer from "../models/Customer.js";

import {
  wrap,
  send,
  fail,
} from "../utils/http.js";

import {
  scope,
  tenantOnly,
} from "../services/scope.js";

// ======================================================
// HELPERS
// ======================================================

const toCents = (value) =>
  Math.round(Number(value || 0) * 100);

const fromCents = (value) =>
  Math.round(value) / 100;

const money = (value) =>
  fromCents(toCents(value));

const id = (value) =>
  String(value?._id || value || "");

const isOwnEmployee = (req) =>
  req.tenant.role === "employee" &&
  req.tenant.dataScope === "own";

const validDate = (value, label) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw fail(`Invalid ${label}.`, 400);
  }

  return date;
};

// YYYY-MM-DD is interpreted as a calendar date.
// The end date is exclusive after adding one day.
const parseDateRange = (query) => {
  const from = query.from
    ? validDate(query.from, "from date")
    : null;

  let to = query.to
    ? validDate(query.to, "to date")
    : null;

  let toExclusive = false;

  if (
    query.to &&
    /^\d{4}-\d{2}-\d{2}$/.test(query.to)
  ) {
    to = new Date(to);
    to.setUTCDate(to.getUTCDate() + 1);
    toExclusive = true;
  }

  if (from && to && from >= to) {
    throw fail(
      "From date must be before the end date.",
      400
    );
  }

  return {
    from,
    to,
    toExclusive,
  };
};

const inRange = (date, range) => {
  if (range.from && date < range.from) {
    return false;
  }

  if (range.to) {
    if (range.toExclusive && date >= range.to) {
      return false;
    }

    if (!range.toExclusive && date > range.to) {
      return false;
    }
  }

  return true;
};

const beforeRange = (date, range) =>
  Boolean(range.from && date < range.from);

const bookingFilter = (req, customerId) => ({
  ...scope(req, "Booking"),
  customerId,
});

// ======================================================
// PAYMENT CLASSIFICATION
// ======================================================

// These types are intentionally separated so that
// refundable security deposits do not become income.
//
// Confirm the exact enum values against Payment.js.
// Unknown payment types are not treated as revenue.

const DEPOSIT_RECEIVED_TYPES = new Set([
  "security_deposit",
  "deposit",
  "deposit_received",
]);

const DEPOSIT_REFUND_TYPES = new Set([
  "security_refund",
  "deposit_refund",
]);

const DEPOSIT_ADJUSTMENT_TYPES = new Set([
  "deposit_adjustment",
  "security_adjustment",
]);

const BILL_REFUND_TYPES = new Set([
  "refund",
  "advance_refund",
  "payment_refund",
]);

const BILL_RECEIPT_TYPES = new Set([
  "advance",
  "advance_payment",
  "partial",
  "partial_payment",
  "full",
  "full_payment",
  "rent",
  "rental",
  "rent_payment",
  "rental_payment",
  "payment",
  "balance",
  "balance_payment",
  "final",
  "final_payment",
]);

const normalizePaymentType = (type) =>
  String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const classifyPayment = (payment) => {
  const type = normalizePaymentType(payment.type);

  if (DEPOSIT_RECEIVED_TYPES.has(type)) {
    return "deposit_received";
  }

  if (DEPOSIT_REFUND_TYPES.has(type)) {
    return "deposit_refund";
  }

  if (DEPOSIT_ADJUSTMENT_TYPES.has(type)) {
    return "deposit_adjustment";
  }

  if (BILL_REFUND_TYPES.has(type)) {
    return "bill_refund";
  }

  if (BILL_RECEIPT_TYPES.has(type)) {
    return "bill_receipt";
  }

  return "unknown";
};

const paymentDate = (payment) =>
  validDate(
    payment.paymentDate ||
      payment.createdAt,
    "payment date"
  );

const bookingDate = (booking) =>
  validDate(
    booking.createdAt ||
      booking.pickupDate,
    "booking date"
  );

// ======================================================
// FORMAT CUSTOMER
// ======================================================

// Do not expose customer identification documents in a financial report.
// Own-scope employees must not see a business-wide opening balance.
const formatCustomer = (customer, req) => {
  const { cnic, cnicFront, cnicBack, licenseNumber,
    licenseImage, licenseExpiry, ...safe } = customer;
  return {
    ...safe,
    id: id(customer._id),
    mobile: customer.mobile || customer.phone || "",
    photo: customer.photo || "",
    openingBalance: isOwnEmployee(req) ? 0 : money(customer.openingBalance),
  };
};

// ======================================================
// FORMAT BOOKING HISTORY
// ======================================================

const formatBooking = (booking) => ({
  id: id(booking._id),

  number: booking.bookingNumber,
  invoiceNo: booking.invoiceNumber,

  carId: id(booking.carId),

  carName:
    booking.carId?.name ||
    booking.carId?.model ||
    "",

  carPlate:
    booking.carId?.numberPlate ||
    "",

  carImage:
    booking.carId?.images?.[0] ||
    "",

  pickupAt: booking.pickupDate,
  returnAt: booking.returnDate,

  status: booking.status,

  displayStatus: {
    reserved: "Reserved",
    on_rent: "On Rent",
    completed: "Completed",
    cancelled: "Cancelled",
  }[booking.status] || booking.status,

  total: money(booking.totalAmount),

  createdAt: booking.createdAt,
});

// ======================================================
// FORMAT PAYMENT HISTORY
// ======================================================

const formatPayment = (payment) => ({
  id: id(payment._id),

  bookingId: id(payment.bookingId),

  receiptNo:
    payment.paymentNumber ||
    payment.receiptNumber ||
    "",

  type: payment.type,

  amount: money(payment.amount),

  method: payment.method || "",

  date:
    payment.paymentDate ||
    payment.createdAt,

  status: payment.status,

  classification: classifyPayment(payment),
});

// ======================================================
// CREATE LEDGER TRANSACTIONS
// ======================================================

const createLedgerEntries = (bookings, payments) => {
  const entries = [];

  const bookingMap = new Map(
    bookings.map((booking) => [
      id(booking._id),
      booking,
    ])
  );

  // Bills: debit
  for (const booking of bookings) {
    if (booking.status === "cancelled") {
      continue;
    }

    const amount = toCents(booking.totalAmount);

    if (amount === 0) {
      continue;
    }

    const date = bookingDate(booking);

    entries.push({
      id: `bill-${id(booking._id)}`,
      date,

      details: `Rental Bill - ${
        booking.carId?.name ||
        booking.carId?.model ||
        "Car"
      }`,

      ref:
        booking.invoiceNumber ||
        booking.bookingNumber ||
        "",

      bookingId: id(booking._id),
      paymentId: null,

      type: "bill",

      debitCents: amount,
      creditCents: 0,

      // Bills appear before receipts on the same date.
      order: 0,
    });
  }

  // Payments: credit or refund debit
  for (const payment of payments) {
    const booking = bookingMap.get(
      id(payment.bookingId)
    );

    if (!booking) continue;

    // Cancellation is permitted only after rental payments are settled.
    // If legacy cancelled records still have transactions, retain them as
    // customer credits/debits rather than silently losing the cash history.
    const classification =
      classifyPayment(payment);

    // Security transactions are excluded from the
    // rental ledger and reported separately.
    if (
      classification === "deposit_received" ||
      classification === "deposit_refund" ||
      classification === "deposit_adjustment" ||
      classification === "unknown"
    ) {
      continue;
    }

    const amount = toCents(
      payment.amount
    );

    if (amount <= 0) continue;

    const isRefund =
      classification === "bill_refund";

    const date = paymentDate(payment);

    entries.push({
      id: `payment-${id(payment._id)}`,
      date,

      details: isRefund
        ? "Payment Refund"
        : "Payment Received",

      ref:
        payment.paymentNumber ||
        payment.receiptNumber ||
        booking.bookingNumber ||
        "",

      bookingId: id(booking._id),
      paymentId: id(payment._id),

      type: isRefund
        ? "refund"
        : "payment",

      debitCents: isRefund
        ? amount
        : 0,

      creditCents: isRefund
        ? 0
        : amount,

      order: 1,
    });
  }

  entries.sort((a, b) => {
    const dateDifference =
      a.date.getTime() -
      b.date.getTime();

    if (dateDifference !== 0) {
      return dateDifference;
    }

    if (a.order !== b.order) {
      return a.order - b.order;
    }

    return a.id.localeCompare(b.id);
  });

  return entries;
};

// ======================================================
// SECURITY DEPOSITS
// ======================================================

// Booking fields represent the current deposit state.
// This is separate from rental income and ledger credit.

const calculateDepositsHeld = (bookings) => {
  let total = 0;

  for (const booking of bookings) {
    const received = toCents(
      booking.securityReceived
    );

    const refunded = toCents(
      booking.securityRefunded
    );

    const deducted = toCents(
      booking.securityDeduction
    );

    total += Math.max(
      0,
      received - refunded - deducted
    );
  }

  return fromCents(total);
};

// ======================================================
// 1. GET CUSTOMER LEDGER
// GET /api/v1/ledger/customers/:customerId
// ======================================================

export const getCustomerLedger = wrap(
  async (req, res) => {
    const { customerId } = req.params;

    if (
      !mongoose.isValidObjectId(customerId)
    ) {
      throw fail(
        "Invalid customer ID.",
        400
      );
    }

    // Customer must belong to the business and
    // be accessible under its configured scope.
    const customer = await Customer.findOne({
      _id: customerId,
      ...scope(req, "Customer"),
    }).lean();

    if (!customer) {
      throw fail(
        "Customer not found or access denied.",
        404
      );
    }

    const range = parseDateRange(
      req.query
    );

    // Own-scope employees can only see bookings
    // assigned to themselves.
    const bookings = await Booking.find(
      bookingFilter(req, customer._id)
    )
      .populate(
        "carId",
        "name brand model numberPlate images"
      )
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .lean();

    const bookingIds = bookings.map(
      (booking) => booking._id
    );

    const payments = bookingIds.length
      ? await Payment.find({
          ...tenantOnly(req),

          bookingId: {
            $in: bookingIds,
          },

          status: "completed",
        })
          .sort({
            paymentDate: 1,
            createdAt: 1,
            _id: 1,
          })
          .lean()
      : [];

    const entries = createLedgerEntries(
      bookings,
      payments
    );

    // Opening balance stored on Customer.js.
    // Defaults to zero when the field is absent.
    const customerOpening = toCents(
      customer.openingBalance
    );

    // A global customer opening balance is not attributable to one employee.
    let opening = isOwnEmployee(req) ? 0 : customerOpening;

    let totalBill = 0;
    let received = 0;

    const rows = [];

    for (const entry of entries) {
      const difference =
        entry.debitCents -
        entry.creditCents;

      // Transactions before the selected date
      // contribute to opening balance.
      if (beforeRange(entry.date, range)) {
        opening += difference;
        continue;
      }

      if (!inRange(entry.date, range)) {
        continue;
      }

      // Refunds are debit movements, NOT additional rental bills.
      if (entry.type === "bill") {
        totalBill += entry.debitCents;
      }

      // Net received: refunds subtract from receipts.
      received +=
        entry.creditCents -
        (
          entry.type === "refund"
            ? entry.debitCents
            : 0
        );

      rows.push({
        id: entry.id,

        date: entry.date.toISOString(),

        details: entry.details,

        ref: entry.ref,

        bookingId: entry.bookingId,
        paymentId: entry.paymentId,

        type: entry.type,

        debit: fromCents(
          entry.debitCents
        ),

        credit: fromCents(
          entry.creditCents
        ),

        balance: 0,
      });
    }

    // Running balance
    let runningBalance = opening;

    for (const row of rows) {
      runningBalance +=
        toCents(row.debit) -
        toCents(row.credit);

      row.balance = fromCents(
        runningBalance
      );
    }

    // Running balance includes refund debits exactly once.
    const finalBalance = runningBalance;

    // Current deposit liability, NOT an as-of-date historical figure.
    const depositsHeld = calculateDepositsHeld(bookings);
    const unknownPaymentTypes = [...new Set(payments
      .filter((payment) => classifyPayment(payment) === "unknown")
      .map((payment) => String(payment.type || "(missing)")))];

    // Legacy fields are retained for consumers
    // of the original ledger endpoint.
    const chargedAll = entries
      .filter((entry) => entry.type === "bill")
      .reduce(
        (sum, entry) =>
          sum + entry.debitCents,
        0
      );

    const paidAll = entries.reduce(
      (sum, entry) => {
        if (entry.type === "payment") {
          return sum + entry.creditCents;
        }

        if (entry.type === "refund") {
          return sum - entry.debitCents;
        }

        return sum;
      },
      0
    );

    send(
      res,
      {
        customer: formatCustomer(
          customer, req
        ),

        // Frontend summary cards
        opening: fromCents(
          opening
        ),

        totals: {
          totalBill: fromCents(
            totalBill
          ),

          received: fromCents(
            received
          ),

          balance: fromCents(
            finalBalance
          ),

          // Original endpoint compatibility
          charged: fromCents(
            chargedAll
          ),

          paid: fromCents(
            paidAll
          ),

          outstanding: fromCents(
            (isOwnEmployee(req) ? 0 : customerOpening) +
            chargedAll -
            paidAll
          ),
        },

        // Frontend ledger table
        rows,

        // Security is not rental revenue
        depositsHeld,
        depositsHeldAsOf: "current",
        warnings: [
          ...(unknownPaymentTypes.length ? [
            `Unrecognized payment types excluded from totals: ${unknownPaymentTypes.join(", ")}.`,
          ] : []),
          ...(range.from || range.to ? [
            "Security deposit held is the current amount, not a historical as-of-date balance.",
          ] : []),
          ...(isOwnEmployee(req) ? [
            "Own-scope ledger excludes the customer's business-wide opening balance.",
          ] : []),
        ],

        // Customer detail/history consumers
        bookings: bookings.map(
          formatBooking
        ),

        payments: payments.map(
          formatPayment
        ),

        filters: {
          from:
            req.query.from || null,

          to:
            req.query.to || null,
        },

        note:
          "Security deposits are excluded from rental ledger balances.",
      },
      "Customer ledger loaded successfully."
    );
  }
);
