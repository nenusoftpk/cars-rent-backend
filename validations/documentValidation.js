import Joi from "joi";

// ======================================================
// COMMON HELPERS
// ======================================================

const objectId = Joi.string()
  .trim()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({
    "string.empty": "ID is required.",
    "string.pattern.base": "Invalid ID format.",
  });

// Allowed document types (exactly matching frontend)
const CUSTOMER_TYPES = [
  "Customer Photo",
  "CNIC Front",
  "CNIC Back",
  "Driving Licence",
];

const CAR_TYPES = [
  "Car Photo",
  "Registration Document",
  "Insurance Document",
  "Token Tax Document",
];

const ALL_TYPES = [
  ...CUSTOMER_TYPES,
  ...CAR_TYPES,
  "Handover Photo",
  "Return Photo",
];

const OWNER_TYPES = ["customer", "car", "booking"];

// ======================================================
// 1. LIST DOCUMENTS (query params)
// GET /api/v1/documents
// ======================================================

export const listDocumentsQuerySchema = Joi.object({
  search: Joi.string().trim().max(100).allow("", null).messages({
    "string.max": "Search cannot exceed 100 characters.",
  }),

  type: Joi.string()
    .valid(...ALL_TYPES)
    .allow("", null)
    .messages({
      "any.only": "Invalid document type.",
    }),

  ownerType: Joi.string()
    .valid(...OWNER_TYPES)
    .allow("", null)
    .messages({
      "any.only": "Invalid owner type. Allowed: customer, car, booking.",
    }),

  from: Joi.date().iso().allow("", null).messages({
    "date.format": "From date must be a valid date (YYYY-MM-DD).",
  }),

  to: Joi.date().iso().allow("", null).messages({
    "date.format": "To date must be a valid date (YYYY-MM-DD).",
  }),

  sort: Joi.string()
    .pattern(/^(uploadedAt|type|ownerName|name):(asc|desc)$/)
    .default("uploadedAt:desc")
    .messages({
      "string.pattern.base":
        "Invalid sort format. Use field:asc or field:desc (e.g. uploadedAt:desc).",
    }),

  page: Joi.number().integer().min(1).default(1).messages({
    "number.base": "Page must be a number.",
    "number.min": "Page must be at least 1.",
  }),

  limit: Joi.number().integer().min(1).max(3000).default(50).messages({
    "number.base": "Limit must be a number.",
    "number.min": "Limit must be at least 1.",
    "number.max": "Limit cannot exceed 100.",
  }),

  pageSize: Joi.number().integer().min(1).max(100).messages({
    "number.base": "Page size must be a number.",
    "number.min": "Page size must be at least 1.",
    "number.max": "Page size cannot exceed 100.",
  }),
}).unknown(true); // allow extra query params if any

// ======================================================
// 2. UPLOAD DOCUMENT (body)
// POST /api/v1/documents
// ======================================================

export const uploadDocumentSchema = Joi.object({
  ownerType: Joi.string()
    .valid("customer", "car")
    .required()
    .messages({
      "any.required": "Please select who this document belongs to.",
      "any.only": "Owner type must be either customer or car.",
      "string.empty": "Please select who this document belongs to.",
    }),

  ownerId: objectId.required().messages({
    "any.required": "Owner ID is required.",
  }),

  type: Joi.string().trim().required().messages({
    "any.required": "Document type is required.",
    "string.empty": "Document type is required.",
  }),
})
  .custom((value, helpers) => {
    if (value.ownerType === "customer") {
      if (!CUSTOMER_TYPES.includes(value.type)) {
        return helpers.message(
          `Invalid type for customer. Allowed types: ${CUSTOMER_TYPES.join(", ")}`
        );
      }
    }

    if (value.ownerType === "car") {
      if (!CAR_TYPES.includes(value.type)) {
        return helpers.message(
          `Invalid type for car. Allowed types: ${CAR_TYPES.join(", ")}`
        );
      }
    }

    return value;
  });

// ======================================================
// 3. REPLACE DOCUMENT (params)
// PATCH /api/v1/documents/:id
// ======================================================

export const documentIdSchema = Joi.object({
  id: Joi.string()
    .trim()
    .min(5)
    .required()
    .custom((value, helpers) => {
      // Accept composite IDs like:
      // customer:64f1a2b3c4d5e6f7a8b9c0d1:CNIC Front
      // car:64f1a2b3c4d5e6f7a8b9c0d1:Car Photo:0
      const parts = value.split(":");

      if (parts.length < 3) {
        return helpers.message("Invalid document ID format.");
      }

      // Second part must be a valid MongoDB ObjectId
      if (!/^[0-9a-fA-F]{24}$/.test(parts[1])) {
        return helpers.message("Invalid document ID format.");
      }

      return value;
    })
    .messages({
      "any.required": "Document ID is required.",
      "string.empty": "Document ID is required.",
      "string.min": "Invalid document ID.",
    }),
});

// Optional body schema for replace (currently we only need the file)
export const replaceDocumentSchema = Joi.object({}).unknown(true);

// ======================================================
// EXPORT
// ======================================================

export default {
  listDocumentsQuerySchema,
  uploadDocumentSchema,
  documentIdSchema,
  replaceDocumentSchema,
};