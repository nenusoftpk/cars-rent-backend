import Joi from "joi";

import {
  createUpdate,
  text,
  optionalText,
  phone,
  email,
  money,
  optionalDate,
} from "./common.js";

// ======================================================
// COMMON DRIVER FIELDS (images removed – handled by Multer)
// ======================================================

const fields = {
  name: text(120),
  phone: phone,
  mobile: phone,
  email: email.allow("", null),
  address: optionalText(500),

  // CNIC
  cnic: Joi.string()
    .trim()
    .pattern(/^\d{5}-?\d{7}-?\d$/)
    .allow("", null)
    .messages({
      "string.pattern.base": "Enter a valid 13-digit CNIC number.",
    }),

  // Driving Licence
  licenseNumber: optionalText(80),
  licenseNo: optionalText(80),
  licenseExpiry: optionalDate,

  // Monthly Salary
  salary: money,

  // Driver Payment Type
  paymentType: Joi.string()
    .valid("fixed", "percentage")
    .messages({
      "any.only": "Payment type must be fixed or percentage.",
    }),

  // Default Driver Payment
  paymentRate: Joi.number()
    .min(0)
    .when("paymentType", {
      is: "percentage",
      then: Joi.number().max(100),
      otherwise: Joi.number().min(0),
    })
    .messages({
      "number.base": "Enter a valid driver payment.",
      "number.min": "Driver payment cannot be negative.",
      "number.max": "Percentage payment cannot exceed 100%.",
    }),

  // Driver Status
  status: Joi.string()
    .valid("available", "assigned", "inactive", "Active", "Inactive")
    .messages({
      "any.only": "Please select a valid driver status.",
    }),
};

// ======================================================
// CREATE AND UPDATE VALIDATIONS
// ======================================================

const schemas = createUpdate(fields, ["name", "phone"]);

export const createDriverSchema = schemas.create;

// Allow empty body for image-only updates
export const updateDriverSchema = schemas.update.min(0);