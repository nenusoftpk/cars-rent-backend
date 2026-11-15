import Joi from "joi";

// ======================================================
// COMMON VALIDATIONS
// ======================================================

const objectId = Joi.string()
  .hex()
  .length(24)
  .messages({
    "string.hex": "Invalid ID format.",
    "string.length": "Invalid ID format.",
    "any.required": "ID is required.",
  });

const fuelLevel = Joi.string()
  .valid(
    "Empty",
    "1/4",
    "1/2",
    "3/4",
    "Full",
    "empty",
    "quarter",
    "half",
    "three_quarters",
    "full"
  )
  .messages({
    "any.only": "Please select a valid fuel level.",
    "any.required": "Fuel level is required.",
  });

const amount = Joi.number()
  .min(0)
  .precision(2)
  .messages({
    "number.base": "Please enter a valid amount.",
    "number.min": "Amount cannot be negative.",
  });

// ======================================================
// COMMON INSPECTION FIELDS (no photos – files come via Multer)
// ======================================================

const inspectionFields = {
  bookingId: objectId.required(),

  meterReading: Joi.number()
    .min(0)
    .required()
    .messages({
      "number.base": "Meter reading must be a number.",
      "number.min": "Meter reading cannot be negative.",
      "any.required": "Meter reading is required.",
    }),

  fuelLevel: fuelLevel.required(),

  condition: Joi.string()
    .valid("excellent", "good", "fair", "damaged")
    .default("good"),

  damageNotes: Joi.string()
    .trim()
    .max(2000)
    .allow("")
    .default(""),

  notes: Joi.string()
    .trim()
    .max(2000)
    .allow("")
    .default(""),
};

// ======================================================
// ISSUE CAR INSPECTION
// ======================================================

export const issueInspectionSchema = Joi.object({
  ...inspectionFields,
}).unknown(false);

// ======================================================
// RETURN CAR INSPECTION
// ======================================================

export const returnInspectionSchema = Joi.object({
  ...inspectionFields,

  extraKmCharges: amount.optional(),
  extraDayCharges: amount.optional(),
  lateCharges: amount.optional(),
  damageCharges: amount.optional(),
  fuelCharges: amount.optional(),

  markUnderRepair: Joi.boolean().default(false),

  repairReason: Joi.when("markUnderRepair", {
    is: true,
    then: Joi.string()
      .trim()
      .min(3)
      .max(500)
      .required()
      .messages({
        "any.required": "Repair reason is required.",
        "string.min": "Repair reason must be at least 3 characters.",
      }),
    otherwise: Joi.forbidden(),
  }),

  expectedRepairCompletionDate: Joi.date()
    .iso()
    .allow(null)
    .optional(),
}).unknown(false);

// ======================================================
// CREATE INSPECTION (legacy)
// ======================================================

export const createInspectionSchema = Joi.object({
  ...inspectionFields,
  type: Joi.string().valid("issue", "return").required(),
}).unknown(false);

// ======================================================
// PARAMS & QUERY
// ======================================================

export const bookingInspectionParamsSchema = Joi.object({
  bookingId: objectId.required(),
}).unknown(false);

export const inspectionParamsSchema = Joi.object({
  bookingId: objectId.required(),
  type: Joi.string().valid("issue", "return").required(),
}).unknown(false);

export const inspectionIdParamsSchema = Joi.object({
  id: objectId.required(),
}).unknown(false);

export const listInspectionQuerySchema = Joi.object({
  bookingId: objectId.optional(),
  carId: objectId.optional(),
  type: Joi.string().valid("issue", "return").optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().min(Joi.ref("from")).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);