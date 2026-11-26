
import Joi from "joi";

// ======================================================
// COMMON VALIDATION FIELDS
// ======================================================

const objectId = Joi.string()
  .hex()
  .length(24)
  .messages({
    "string.base": "Invalid ID.",
    "string.hex": "Invalid ID.",
    "string.length": "Invalid ID.",
  });

const amount = Joi.number()
  .min(0)
  .messages({
    "number.base": "Please enter a valid amount.",
    "number.min": "Amount cannot be negative.",
  });

const date = Joi.date()
  .messages({
    "date.base": "Please enter a valid date.",
  });

const optionalText = Joi.string()
  .trim()
  .allow("");

const optionalId = objectId
  .allow(null, "");

// ======================================================
// CREATE BOOKING
// POST /api/v1/bookings
// ======================================================

export const createBookingSchema = Joi.object({
  customerId: objectId
    .required()
    .messages({
      "any.required": "Please select a customer.",
      "string.empty": "Please select a customer.",
    }),

  carId: objectId
    .required()
    .messages({
      "any.required": "Please select a car.",
      "string.empty": "Please select a car.",
    }),

  driverId: optionalId,

  employeeId: optionalId,

  pickupDate: date
    .required()
    .messages({
      "any.required": "Pickup date is required.",
      "date.base": "Please enter a valid pickup date.",
    }),

  returnDate: date
    .required()
    .greater(Joi.ref("pickupDate"))
    .messages({
      "any.required": "Return date is required.",
      "date.base": "Please enter a valid return date.",
      "date.greater": "Return date must be after pickup date.",
    }),

  pickupLocation: optionalText.max(300),

  returnLocation: optionalText.max(300),

  rentType: Joi.string()
    .valid("daily", "hourly")
    .default("daily")
    .messages({
      "any.only": "Please select daily or hourly rent.",
    }),

  discount: amount.default(0),

  // Optional admin-only override, checked again in controller.
  driverPaymentAmount: amount,

  securityDeposit: amount.default(0),

  specialInstructions: optionalText.max(2000),
})
  .required()
  .messages({
    "object.unknown": "This field is not allowed.",
  });

// ======================================================
// UPDATE BOOKING
// PATCH /api/v1/bookings/:id
// ======================================================

export const updateBookingSchema = Joi.object({
  customerId: objectId,

  carId: objectId,

  driverId: optionalId,

  employeeId: optionalId,

  pickupDate: date,

  returnDate: date,

  pickupLocation: optionalText.max(300),

  returnLocation: optionalText.max(300),

  rentType: Joi.string()
    .valid("daily", "hourly")
    .messages({
      "any.only": "Please select daily or hourly rent.",
    }),

  discount: amount,

  driverPaymentAmount: amount,

  specialInstructions: optionalText.max(2000),
  // Booking-specific Terms & Conditions
  termsAndConditions: Joi.array()
    .items(Joi.string().trim().min(1))
    .optional(),
})
  .min(1)
  .custom((value, helpers) => {
    if (
      value.pickupDate &&
      value.returnDate &&
      new Date(value.returnDate) <=
      new Date(value.pickupDate)
    ) {
      return helpers.message(
        "Return date must be after pickup date."
      );
    }

    return value;
  })
  .messages({
    "object.min": "Please provide something to update.",
    "object.unknown": "This field cannot be updated.",
  });

// ======================================================
// EXTEND BOOKING
// PATCH /api/v1/bookings/:id/extend
// ======================================================

export const extendBookingSchema = Joi.object({
  returnDate: date,

  // Supports the existing frontend field name.
  returnAt: date,
})
  .or("returnDate", "returnAt")
  .oxor("returnDate", "returnAt")
  .messages({
    "object.missing": "New return date is required.",
    "object.oxor": "Please provide only one return date.",
    "object.unknown": "This field is not allowed.",
  });

// ======================================================
// CANCEL BOOKING
// PATCH /api/v1/bookings/:id/cancel
// ======================================================

export const cancelBookingSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .allow("")
    .max(1000)
    .default("Cancelled by staff"),

  refundAdvance: Joi.boolean()
    .default(false),
});

// ======================================================
// BOOKING FILTERS
// GET /api/v1/bookings
// ======================================================

export const bookingFilterSchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      "number.min": "Page must be greater than zero.",
      "number.base": "Invalid page number.",
    }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(3000)
    .default(10)
    .messages({
      "number.min": "Limit must be greater than zero.",
      "number.max": "Maximum 100 records are allowed.",
      "number.base": "Invalid page limit.",
    }),

  search: optionalText.max(150),

  status: Joi.string()
    .valid(
      "reserved",
      "on_rent",
      "completed",
      "cancelled",
      ""
    )
    .messages({
      "any.only": "Please select a valid booking status.",
    }),

  customerId: objectId,

  carId: objectId,

  employeeId: objectId,

  from: date,

  to: date,
})
  .custom((value, helpers) => {
    if (
      value.from &&
      value.to &&
      new Date(value.to) < new Date(value.from)
    ) {
      return helpers.message(
        "End date must be on or after start date."
      );
    }

    return value;
  });

// ======================================================
// CHECK CAR AVAILABILITY
// GET /api/v1/bookings/availability
// ======================================================

export const bookingAvailabilitySchema = Joi.object({
  carId: objectId
    .required()
    .messages({
      "any.required": "Please select a car.",
      "string.empty": "Please select a car.",
    }),

  pickupDate: date
    .required()
    .messages({
      "any.required": "Pickup date is required.",
    }),

  returnDate: date
    .required()
    .greater(Joi.ref("pickupDate"))
    .messages({
      "any.required": "Return date is required.",
      "date.greater": "Return date must be after pickup date.",
    }),

  excludeBookingId: objectId,
});

// ======================================================
// BOOKING ID PARAMETER
// ======================================================

export const bookingIdSchema = Joi.object({
  id: objectId
    .required()
    .messages({
      "any.required": "Booking ID is required.",
      "string.empty": "Booking ID is required.",
    }),
});
