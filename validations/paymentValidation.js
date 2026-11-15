import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const amount = Joi.number()
  .positive()
  .precision(2)
  .required()
  .messages({
    "number.base": "Amount must be a number.",
    "number.positive": "Amount must be greater than zero.",
    "number.precision": "Amount may have at most two decimal places.",
    "any.required": "Amount is required.",
  });

const method = Joi.string()
  .valid("cash", "bank", "jazzcash", "easypaisa", "card", "other")
  .required()
  .messages({
    "any.only": "Invalid payment method.",
    "any.required": "Payment method is required.",
  });

const common = {
  idempotencyKey: Joi.string()
    .trim()
    .min(8)
    .max(128)
    .required()
    .messages({
      "string.min": "Idempotency key must be at least 8 characters.",
      "string.max": "Idempotency key cannot exceed 128 characters.",
      "any.required": "Idempotency key is required.",
    }),

  amount,

  method,

  // Optional – kept only for backward compatibility with old clients.
  // New requests should omit it.
  transactionReference: Joi.string()
    .trim()
    .max(150)
    .allow("", null)
    .optional(),

  paymentDate: Joi.date().iso().optional(),

  notes: Joi.string()
    .trim()
    .max(1000)
    .allow("", null)
    .optional(),
};

// ======================================================
// CREATE RENTAL / ADVANCE / FINAL PAYMENT
// ======================================================

export const createPaymentSchema = Joi.object({
  ...common,
  bookingId: objectId.required().messages({
    "string.hex": "Invalid booking ID.",
    "string.length": "Invalid booking ID.",
    "any.required": "Booking ID is required.",
  }),
  type: Joi.string()
    .valid("advance", "rental", "final")
    .required()
    .messages({
      "any.only": "Payment type must be advance, rental or final.",
      "any.required": "Payment type is required.",
    }),
})
  .unknown(false)
  // Explicitly reject any attempt to send Cloudinary fields from the client
  .keys({
    paymentProof: Joi.forbidden(),
    paymentProofPublicId: Joi.forbidden(),
  });

// ======================================================
// RECEIVE SECURITY DEPOSIT
// ======================================================

export const receiveSecuritySchema = Joi.object({
  ...common,
  bookingId: objectId.required().messages({
    "string.hex": "Invalid booking ID.",
    "string.length": "Invalid booking ID.",
    "any.required": "Booking ID is required.",
  }),
})
  .unknown(false)
  .keys({
    paymentProof: Joi.forbidden(),
    paymentProofPublicId: Joi.forbidden(),
  });

// ======================================================
// REFUND SECURITY DEPOSIT
// ======================================================

export const refundSecuritySchema = Joi.object({
  ...common,
  bookingId: objectId.required().messages({
    "string.hex": "Invalid booking ID.",
    "string.length": "Invalid booking ID.",
    "any.required": "Booking ID is required.",
  }),
  originalPaymentId: objectId.allow(null, "").optional(),
})
  .unknown(false)
  .keys({
    paymentProof: Joi.forbidden(),
    paymentProofPublicId: Joi.forbidden(),
  });

// ======================================================
// REFUND RENTAL PAYMENT
// ======================================================

export const refundPaymentSchema = Joi.object({
  ...common,
})
  .unknown(false)
  .keys({
    paymentProof: Joi.forbidden(),
    paymentProofPublicId: Joi.forbidden(),
  });

// ======================================================
// VOID PAYMENT (Admin only)
// ======================================================

export const voidPaymentSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .min(3)
    .max(500)
    .required()
    .messages({
      "string.min": "Void reason must be at least 3 characters.",
      "string.max": "Void reason cannot exceed 500 characters.",
      "any.required": "Void reason is required.",
    }),
}).unknown(false);