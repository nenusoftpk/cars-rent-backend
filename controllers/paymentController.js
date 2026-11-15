import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import { wrap, send, fail, paging } from "../utils/http.js";
import { scope, tenantOnly } from "../services/scope.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// ======================================================
// MONEY HELPERS (integer cents)
// ======================================================

const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => Math.round(value) / 100;

const rentalTypes = new Set(["advance", "rental", "final"]);

const METHODS_REQUIRING_PROOF = new Set([
  "bank",
  "jazzcash",
  "easypaisa",
]);

const own = (req) =>
  req.tenant.role === "employee" && req.tenant.dataScope === "own";

const tenant = (req) => tenantOnly(req);

const bookingFilter = (req, id) => ({
  ...scope(req, "Booking"),
  ...(id ? { _id: id } : {}),
});

const id = (value) => String(value?._id || value || "");

const numberFor = () =>
  `PAY-${Date.now()}-${randomUUID().slice(0, 12).toUpperCase()}`;

// ======================================================
// VALIDATION HELPERS
// ======================================================

const requireId = (value, label = "ID") => {
  if (!mongoose.isValidObjectId(value)) {
    throw fail(`Invalid ${label}.`, 400);
  }
};

const validAmount = (value) => {
  const n = Number(value);
  if (
    value === "" ||
    value == null ||
    !Number.isFinite(n) ||
    cents(n) <= 0 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.000001
  ) {
    throw fail(
      "Amount must be positive and have at most two decimal places.",
      400
    );
  }
  return money(cents(n));
};

// ======================================================
// PAYMENT PROOF RULES
// ======================================================

const assertProofRules = (method, file) => {
  if (method === "cash") {
    if (file) {
      throw fail(
        "Cash payments must not include a payment screenshot.",
        400
      );
    }
    return;
  }

  if (METHODS_REQUIRING_PROOF.has(method)) {
    if (!file) {
      throw fail(
        "Please upload a payment screenshot for bank, JazzCash or Easypaisa payments.",
        400
      );
    }
    return;
  }

  // card / other → optional
};

// ======================================================
// BOOKING + RECORDS HELPERS
// ======================================================

const assertBooking = async (req, bookingId, session = null) => {
  requireId(bookingId, "booking ID");
  const q = Booking.findOne(bookingFilter(req, bookingId));
  if (session) q.session(session);
  const booking = await q;
  if (!booking) throw fail("Booking not found or access denied.", 404);
  return booking;
};

const recordsFor = (req, bookingId, session = null) => {
  const q = Payment.find({ ...tenant(req), bookingId });
  if (session) q.session(session);
  return q.lean();
};

const totalsFor = (records) => {
  const totals = {
    rentalReceived: 0,
    rentalRefunded: 0,
    securityReceived: 0,
    securityRefunded: 0,
  };

  for (const payment of records) {
    if (payment.status !== "completed") continue;
    const value = cents(payment.amount);

    if (rentalTypes.has(payment.type)) totals.rentalReceived += value;
    else if (payment.type === "refund") totals.rentalRefunded += value;
    else if (payment.type === "security_deposit")
      totals.securityReceived += value;
    else if (payment.type === "security_refund")
      totals.securityRefunded += value;
  }

  return totals;
};

const balanceFor = (booking, records) => {
  const t = totalsFor(records);
  const netRental = t.rentalReceived - t.rentalRefunded;
  const held =
    t.securityReceived -
    t.securityRefunded -
    cents(booking.securityDeduction);

  return {
    totalAmount: money(cents(booking.totalAmount)),
    paid: money(netRental),
    received: money(t.rentalReceived),
    refunded: money(t.rentalRefunded),
    outstanding: money(
      Math.max(0, cents(booking.totalAmount) - netRental)
    ),
    securityRequired: money(cents(booking.securityDeposit)),
    securityReceived: money(t.securityReceived),
    securityRefunded: money(t.securityRefunded),
    securityDeduction: money(cents(booking.securityDeduction)),
    securityHeld: money(Math.max(0, held)),
    securityStillDue: money(
      Math.max(0, cents(booking.securityDeposit) - t.securityReceived)
    ),
  };
};

const securitySnapshot = (booking, records) => {
  const b = balanceFor(booking, records);
  const held =
    cents(b.securityReceived) -
    cents(b.securityRefunded) -
    cents(b.securityDeduction);

  let status = "none";
  if (cents(b.securityRequired) > 0 && cents(b.securityReceived) === 0) {
    status = "pending";
  } else if (held > 0 && cents(b.securityRefunded) > 0) {
    status = "partially_refunded";
  } else if (held > 0) {
    status = "held";
  } else if (
    cents(b.securityReceived) > 0 &&
    cents(b.securityDeduction) > 0 &&
    cents(b.securityRefunded) === 0
  ) {
    status = "forfeited";
  } else if (cents(b.securityReceived) > 0) {
    status = "refunded";
  }

  return {
    securityReceived: b.securityReceived,
    securityRefunded: b.securityRefunded,
    securityStatus: status,
  };
};

// ======================================================
// IDEMPOTENCY FINGERPRINT
// ======================================================

const fingerprint =
  (body, type, originalId = null) =>
  (payment) =>
    payment.type === type &&
    id(payment.bookingId) === id(body.bookingId) &&
    cents(payment.amount) === cents(body.amount) &&
    payment.method === body.method &&
    id(payment.originalPaymentId) === id(originalId) &&
    String(payment.transactionReference || "") ===
      String(body.transactionReference || "") &&
    String(payment.notes || "") === String(body.notes || "") &&
    new Date(payment.paymentDate).getTime() ===
      new Date(body.paymentDate || payment.paymentDate).getTime();

const replayFor = async (req, key, matches) => {
  const payment = await Payment.findOne({
    ...tenant(req),
    idempotencyKey: key,
  }).lean();

  if (!payment) return null;
  if (!matches(payment)) {
    throw fail(
      "Idempotency key already used for a different transaction.",
      409
    );
  }
  return payment;
};

// ======================================================
// SAFE CLOUDINARY + MONGODB TRANSACTION
// ======================================================

/**
 * Flow:
 * 1. Validate body + proof rules
 * 2. Check idempotency (replay → no new upload)
 * 3. Upload proof OUTSIDE the MongoDB transaction
 * 4. Run the existing booking-locked financial transaction
 * 5. On definitive failure → delete the unused image
 * 6. On uncertain commit / success → keep the image
 */
const withBookingTransaction = async (
  req,
  body,
  type,
  originalId,
  build
) => {
  if (!body.idempotencyKey?.trim()) {
    throw fail("Idempotency key is required.", 400);
  }

  requireId(body.bookingId, "booking ID");

  const normalized = {
    ...body,
    amount: validAmount(body.amount),
  };

  // Conditional screenshot rules
  assertProofRules(normalized.method, req.file);

  const matches = fingerprint(normalized, type, originalId);

  // Fast path: already exists → return it, never upload again
  const replay = await replayFor(
    req,
    normalized.idempotencyKey,
    matches
  );
  if (replay) {
    return { payment: replay, replay: true };
  }

  // --------------------------------------------------
  // Upload proof (if any) BEFORE the MongoDB transaction
  // --------------------------------------------------
  let uploadedProof = null;

  if (req.file) {
    try {
      uploadedProof = await uploadToCloudinary(
        req.file.buffer,
        `rent-a-car/${req.tenant.businessId}/payments`,
        "image",
        false
      );
    } catch (error) {
      throw fail(
        error.message || "Failed to upload payment screenshot.",
        error.statusCode || error.status || 400
      );
    }
  }

  const session = await mongoose.startSession();
  let created = null;
  let committed = false;

  try {
    await session.withTransaction(async () => {
      // Write lock MUST precede reading the balance
      const lock = await Booking.updateOne(
        bookingFilter(req, normalized.bookingId),
        { $inc: { __v: 1 } },
        { session }
      );

      if (!lock.matchedCount) {
        throw fail("Booking not found or access denied.", 404);
      }

      const booking = await assertBooking(
        req,
        normalized.bookingId,
        session
      );
      const records = await recordsFor(req, booking._id, session);
      const changes = await build(booking, records, normalized);

      const [payment] = await Payment.create(
        [
          {
            businessId: req.tenant.businessId,
            bookingId: booking._id,
            paymentNumber: numberFor(),
            idempotencyKey: normalized.idempotencyKey,
            amount: normalized.amount,
            method: normalized.method,
            type,
            originalPaymentId: originalId || null,
            transactionReference:
              normalized.transactionReference || "",
            paymentDate: normalized.paymentDate || new Date(),
            notes: normalized.notes || "",
            receivedBy: req.tenant.userId,
            paymentProof: uploadedProof?.secure_url || "",
            paymentProofPublicId: uploadedProof?.public_id || "",
          },
        ],
        { session }
      );

      if (changes && Object.keys(changes).length) {
        await Booking.updateOne(
          bookingFilter(req, booking._id),
          { $set: changes },
          { session, runValidators: true }
        );
      }

      created = payment.toObject();
    });

    committed = true;
  } catch (error) {
    // Definite failure → clean up the unused image
    if (
      !committed &&
      uploadedProof?.public_id &&
      !error?.hasErrorLabel?.("UnknownTransactionCommitResult")
    ) {
      try {
        await deleteFromCloudinary(
          uploadedProof.public_id,
          "image",
          "upload"
        );
      } catch (cleanupError) {
        console.error(
          "Payment proof cleanup failed:",
          cleanupError
        );
      }
    }

    // Duplicate key (concurrent retry) → try to return the existing record
    if (error.code === 11000) {
      const existing = await replayFor(
        req,
        normalized.idempotencyKey,
        matches
      );
      if (existing) {
        // Another request already committed this payment.
        // Our image is unused → clean it up.
        if (uploadedProof?.public_id) {
          try {
            await deleteFromCloudinary(
              uploadedProof.public_id,
              "image",
              "upload"
            );
          } catch (cleanupError) {
            console.error(
              "Duplicate payment proof cleanup failed:",
              cleanupError
            );
          }
        }
        return { payment: existing, replay: true };
      }
      throw fail(
        "Duplicate payment number or idempotency key.",
        409
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }

  return { payment: created, replay: false };
};

// ======================================================
// ACCESS HELPERS
// ======================================================

const accessibleFilter = async (req, extra = {}) => {
  const filter = { ...tenant(req), ...extra };
  if (!own(req)) return filter;

  const bookingIds = await Booking.distinct(
    "_id",
    scope(req, "Booking")
  );
  return {
    $and: [filter, { bookingId: { $in: bookingIds } }],
  };
};

const dateRange = (q) => {
  if (!q.from && !q.to) return {};
  const range = {};
  for (const key of ["from", "to"]) {
    if (!q[key]) continue;
    const date = new Date(q[key]);
    if (Number.isNaN(date.getTime())) {
      throw fail(`Invalid ${key} date.`, 400);
    }
    if (key === "from") range.$gte = date;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(q[key])) {
      date.setUTCDate(date.getUTCDate() + 1);
      range.$lt = date;
    } else {
      range.$lte = date;
    }
  }
  if (
    range.$gte &&
    (range.$lt || range.$lte) &&
    range.$gte >= (range.$lt || range.$lte)
  ) {
    throw fail("Invalid date range.", 400);
  }
  return { paymentDate: range };
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ======================================================
// PUBLIC RESPONSE SHAPE
// (never expose paymentProofPublicId)
// ======================================================

const publicPayment = (doc) => {
  if (!doc) return null;
  const value = doc.toObject ? doc.toObject() : { ...doc };
  delete value.paymentProofPublicId;
  delete value.__v;
  return value;
};

// ======================================================
// LIST PAYMENTS
// ======================================================

export const listPayments = wrap(async (req, res) => {
  const q = req.query;
  const extra = { ...dateRange(q) };

  for (const field of ["bookingId", "type", "method", "status"]) {
    if (q[field]) extra[field] = q[field];
  }
  if (q.bookingId) requireId(q.bookingId, "booking ID");

  if (q.search?.trim()) {
    const pattern = escapeRegex(q.search.trim().slice(0, 80));
    extra.$or = ["paymentNumber", "transactionReference"].map(
      (field) => ({
        [field]: { $regex: pattern, $options: "i" },
      })
    );
  }

  const filter = await accessibleFilter(req, extra);
  const { page, limit } = paging({
    ...q,
    limit: q.pageSize || q.limit,
  });

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  send(
    res,
    {
      items: items.map(publicPayment),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
    "Payments loaded successfully."
  );
});

// ======================================================
// GET ONE PAYMENT
// ======================================================

export const getPayment = wrap(async (req, res) => {
  requireId(req.params.id, "payment ID");

  const payment = await Payment.findOne(
    await accessibleFilter(req, { _id: req.params.id })
  ).lean();

  if (!payment) {
    throw fail("Payment not found or access denied.", 404);
  }

  send(res, publicPayment(payment), "Payment loaded successfully.");
});

// ======================================================
// BOOKING BALANCE
// ======================================================

export const bookingBalance = wrap(async (req, res) => {
  const booking = await assertBooking(req, req.params.bookingId);
  send(
    res,
    balanceFor(booking, await recordsFor(req, booking._id)),
    "Booking balance loaded."
  );
});

// ======================================================
// BOOKING PAYMENTS
// ======================================================

export const bookingPayments = wrap(async (req, res) => {
  const booking = await assertBooking(req, req.params.bookingId);
  const { page, limit } = paging(req.query);
  const filter = { ...tenant(req), bookingId: booking._id };

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  send(
    res,
    {
      items: items.map(publicPayment),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
    "Booking payments loaded."
  );
});

// ======================================================
// PAYMENT STATS
// ======================================================

export const paymentStats = wrap(async (req, res) => {
  const filter = await accessibleFilter(req, {
    status: "completed",
    ...dateRange(req.query),
  });

  const records = await Payment.find(filter)
    .select("amount type status")
    .lean();

  const t = totalsFor(records);

  send(
    res,
    {
      totalTransactions: records.length,
      rentalReceived: money(t.rentalReceived),
      rentalRefunded: money(t.rentalRefunded),
      netRentalReceived: money(t.rentalReceived - t.rentalRefunded),
      securityReceived: money(t.securityReceived),
      securityRefunded: money(t.securityRefunded),
      securityHeldBeforeDeductions: money(
        t.securityReceived - t.securityRefunded
      ),
    },
    "Payment statistics loaded."
  );
});

// ======================================================
// CREATE RENTAL / ADVANCE / FINAL PAYMENT
// ======================================================

export const createPayment = wrap(async (req, res) => {
  const body = req.body;

  if (!rentalTypes.has(body.type)) {
    throw fail("Invalid rental payment type.", 400);
  }

  const result = await withBookingTransaction(
    req,
    body,
    body.type,
    null,
    async (booking, records, b) => {
      if (booking.status === "cancelled") {
        throw fail(
          "Cannot collect rental payment for a cancelled booking.",
          409
        );
      }
      if (
        cents(b.amount) >
        cents(balanceFor(booking, records).outstanding)
      ) {
        throw fail(
          "Payment exceeds booking outstanding amount.",
          409
        );
      }
    }
  );

  send(
    res,
    publicPayment(result.payment),
    result.replay
      ? "Existing payment returned (idempotent replay)."
      : "Payment recorded successfully.",
    result.replay ? 200 : 201
  );
});

// ======================================================
// RECEIVE SECURITY DEPOSIT
// ======================================================

export const receiveSecurity = wrap(async (req, res) => {
  const body = req.body;

  const result = await withBookingTransaction(
    req,
    body,
    "security_deposit",
    null,
    async (booking, records, b) => {
      if (booking.status === "cancelled") {
        throw fail(
          "Cannot receive security for a cancelled booking.",
          409
        );
      }
      if (
        cents(b.amount) >
        cents(balanceFor(booking, records).securityStillDue)
      ) {
        throw fail(
          "Security receipt exceeds required deposit.",
          409
        );
      }

      const projected = [
        ...records,
        {
          type: "security_deposit",
          status: "completed",
          amount: b.amount,
        },
      ];

      return {
        ...securitySnapshot(booking, projected),
        securityReceivedAt: new Date(),
        securityMethod: b.method,
      };
    }
  );

  send(
    res,
    publicPayment(result.payment),
    result.replay
      ? "Existing deposit receipt returned."
      : "Security deposit received.",
    result.replay ? 200 : 201
  );
});

// ======================================================
// REFUND SECURITY DEPOSIT
// ======================================================

export const refundSecurity = wrap(async (req, res) => {
  const body = req.body;

  if (body.originalPaymentId) {
    requireId(body.originalPaymentId, "original payment ID");
  }

  const originalId = body.originalPaymentId || null;

  const result = await withBookingTransaction(
    req,
    body,
    "security_refund",
    originalId,
    async (booking, records, b) => {
      if (!["completed", "cancelled"].includes(booking.status)) {
        throw fail(
          "Security refunds require a completed or cancelled booking.",
          409
        );
      }
      if (
        cents(b.amount) >
        cents(balanceFor(booking, records).securityHeld)
      ) {
        throw fail(
          "Refund exceeds refundable security balance.",
          409
        );
      }
      if (
        originalId &&
        !records.some(
          (p) =>
            id(p._id) === id(originalId) &&
            p.type === "security_deposit" &&
            p.status === "completed"
        )
      ) {
        throw fail("Original security receipt not found.", 404);
      }

      const projected = [
        ...records,
        {
          type: "security_refund",
          status: "completed",
          amount: b.amount,
        },
      ];

      return {
        ...securitySnapshot(booking, projected),
        securityRefundedAt: new Date(),
      };
    }
  );

  send(
    res,
    publicPayment(result.payment),
    result.replay
      ? "Existing security refund returned."
      : "Security refunded successfully.",
    result.replay ? 200 : 201
  );
});

// ======================================================
// REFUND RENTAL PAYMENT
// ======================================================

export const refundPayment = wrap(async (req, res) => {
  requireId(req.params.id, "payment ID");

  const original = await Payment.findOne(
    await accessibleFilter(req, { _id: req.params.id })
  ).lean();

  if (!original) {
    throw fail("Payment not found or access denied.", 404);
  }
  if (
    !rentalTypes.has(original.type) ||
    original.status !== "completed"
  ) {
    throw fail(
      "Only completed rental receipts can be refunded here.",
      409
    );
  }

  const body = {
    ...req.body,
    bookingId: original.bookingId,
  };

  const result = await withBookingTransaction(
    req,
    body,
    "refund",
    original._id,
    async (_booking, records, b) => {
      const liveOriginal = records.find(
        (p) =>
          id(p._id) === id(original._id) &&
          p.status === "completed" &&
          rentalTypes.has(p.type)
      );

      if (!liveOriginal) {
        throw fail(
          "Original payment is no longer refundable.",
          409
        );
      }

      const alreadyRefunded = records
        .filter(
          (p) =>
            p.status === "completed" &&
            p.type === "refund" &&
            id(p.originalPaymentId) === id(original._id)
        )
        .reduce((sum, p) => sum + cents(p.amount), 0);

      if (
        cents(b.amount) >
        cents(liveOriginal.amount) - alreadyRefunded
      ) {
        throw fail(
          "Refund exceeds remaining refundable amount.",
          409
        );
      }
    }
  );

  send(
    res,
    publicPayment(result.payment),
    result.replay
      ? "Existing refund returned."
      : "Rental refund recorded.",
    result.replay ? 200 : 201
  );
});

// ======================================================
// VOID PAYMENT (Admin only)
// ======================================================

export const voidPayment = wrap(async (req, res) => {
  requireId(req.params.id, "payment ID");

  const session = await mongoose.startSession();
  let updated;

  try {
    await session.withTransaction(async () => {
      // First lookup establishes the booking; all checks are repeated after the lock.
      const initial = await Payment.findOne(
        await accessibleFilter(req, { _id: req.params.id })
      ).session(session);

      if (!initial) {
        throw fail("Payment not found or access denied.", 404);
      }

      const lock = await Booking.updateOne(
        bookingFilter(req, initial.bookingId),
        { $inc: { __v: 1 } },
        { session }
      );

      if (!lock.matchedCount) {
        throw fail("Booking not found or access denied.", 404);
      }

      const booking = await assertBooking(
        req,
        initial.bookingId,
        session
      );

      const payment = await Payment.findOne({
        ...tenant(req),
        _id: initial._id,
      }).session(session);

      if (!payment || payment.status === "void") {
        throw fail("Payment is already void or unavailable.", 409);
      }

      const records = await recordsFor(req, booking._id, session);

      if (
        records.some(
          (p) =>
            p.status === "completed" &&
            id(p.originalPaymentId) === id(payment._id)
        )
      ) {
        throw fail(
          "Cannot void a payment that has active refunds. Void those refunds first.",
          409
        );
      }

      const projected = records.map((p) =>
        id(p._id) === id(payment._id)
          ? { ...p, status: "void" }
          : p
      );

      if (
        payment.type === "security_deposit" ||
        payment.type === "security_refund"
      ) {
        const before = balanceFor(booking, records);
        const after = balanceFor(booking, projected);

        if (
          cents(after.securityReceived) -
            cents(after.securityRefunded) <
          cents(booking.securityDeduction)
        ) {
          throw fail(
            "Cannot void security that is already refunded or deducted.",
            409
          );
        }

        const changes = securitySnapshot(booking, projected);

        if (
          payment.type === "security_deposit" &&
          cents(after.securityReceived) === 0
        ) {
          changes.securityReceivedAt = null;
          changes.securityMethod = "";
        }
        if (
          payment.type === "security_refund" &&
          cents(after.securityRefunded) === 0
        ) {
          changes.securityRefundedAt = null;
        }

        await Booking.updateOne(
          bookingFilter(req, booking._id),
          { $set: changes },
          { session, runValidators: true }
        );
      }

      payment.status = "void";
      payment.voidReason = req.body.reason;
      payment.voidedBy = req.tenant.userId;
      payment.voidedAt = new Date();
      await payment.save({ session });

      updated = payment.toObject();
    });
  } finally {
    await session.endSession();
  }

  // Original screenshot is intentionally preserved for audit.
  send(res, publicPayment(updated), "Payment voided successfully.");
});