import Joi from "joi";

const nameField = Joi.string()
  .trim()
  .min(2)
  .max(120)
  .messages({
    "string.empty": "Customer name is required.",
    "string.min": "Customer name must contain at least 2 characters.",
    "string.max": "Customer name cannot exceed 120 characters.",
  });

const phoneField = Joi.string()
  .trim()
  .pattern(/^(?:\+92|0092|92|0)3\d{9}$/)
  .messages({
    "string.empty": "Mobile number is required.",
    "string.pattern.base":
      "Enter a valid Pakistani mobile number, for example 03001234567.",
  });

const optionalPhoneField = Joi.string()
  .trim()
  .allow("", null)
  .pattern(/^(?:\+92|0092|92|0)3\d{9}$/)
  .messages({
    "string.pattern.base": "Enter a valid Pakistani mobile number.",
  });

const emailField = Joi.string()
  .trim()
  .lowercase()
  .email({ tlds: { allow: false } })
  .allow("", null)
  .messages({
    "string.email": "Please enter a valid email address.",
  });


const cnicField = Joi.string()
  .trim()
  .pattern(/^\d{5}-?\d{7}-?\d$/)
  .allow("", null)
  .messages({
    "string.pattern.base":
      "Enter a valid 13-digit CNIC number, for example 35202-1234567-1.",
  });


const optionalText = (max = 255) =>
  Joi.string().trim().max(max).allow("", null);

const optionalDate = Joi.date().iso().allow(null, "");

// ======================================================
// GUARANTOR FIELDS (same rules for guarantor 1 and 2)
// These only check the FORMAT of what was sent.
// The controller decides what is REQUIRED (it also checks images
// and the data already saved), so a simple edit never fails here.
// ======================================================

const guarantorFields = (n) => ({
  [`guarantor${n}Enabled`]: Joi.boolean(),

  [`guarantor${n}Name`]: Joi.string()
    .trim()
    .min(2)
    .max(120)
    .allow("", null)
    .messages({
      "string.min": `Guarantor ${n} name must contain at least 2 characters.`,
      "string.max": `Guarantor ${n} name cannot exceed 120 characters.`,
    }),

  [`guarantor${n}Mobile`]: Joi.string()
    .trim()
    .allow("", null)
    .pattern(/^(?:\+92|0092|92|0)3\d{9}$/)
    .messages({
      "string.pattern.base":
        `Enter a valid Pakistani mobile number for guarantor ${n}.`,
    }),
});

const customerFields = {
  customerCode: optionalText(50),
  name: nameField,
  mobile: phoneField,
  phone: phoneField,
  alternatePhone: optionalPhoneField,
  email: emailField,
  gender: Joi.string().valid("male", "female", "other", "").allow(null),
  type: Joi.string().valid("", "Regular", "VIP", "Corporate").allow(null),
  address: optionalText(500),
  city: optionalText(100),
  cnic: cnicField,
  licenseNo: optionalText(80),
  licenseNumber: optionalText(80),
  licenseExpiry: optionalDate,
  openingBalance: Joi.number()
    .min(0)
    .max(999999999999)
    .messages({
      "number.base": "Opening balance must be a number.",
      "number.min": "Opening balance cannot be negative.",
    }),
  notes: optionalText(2000),
  status: Joi.string()
    .valid("active", "inactive", "blocked", "Active", "Inactive", "Blocked")
    .messages({
      "any.only": "Status must be Active, Inactive, or Blocked.",
    }),

  ...guarantorFields(1),
  ...guarantorFields(2),
};

// ======================================================
// CREATE CUSTOMER
// ======================================================

export const createCustomerSchema = Joi.object({
  ...customerFields,
  name: nameField.required(),
})
  .or("mobile", "phone")
  .custom((value, helpers) => {
    if (value.mobile && value.phone && value.mobile !== value.phone) {
      return helpers.message("Mobile and phone cannot have different values.");
    }
    if (
      value.licenseNo &&
      value.licenseNumber &&
      value.licenseNo !== value.licenseNumber
    ) {
      return helpers.message("Driving licence numbers cannot be different.");
    }
    return value;
  })
  .messages({
    "object.missing": "Mobile number is required.",
  });

// ======================================================
// UPDATE CUSTOMER
// Allows empty body when only images are being uploaded
// ======================================================

export const updateCustomerSchema = Joi.object({
  ...customerFields,
})
  .min(0) // ← important: allow empty body (files only)
  .custom((value, helpers) => {
    if (value.mobile && value.phone && value.mobile !== value.phone) {
      return helpers.message("Mobile and phone cannot have different values.");
    }
    if (
      value.licenseNo &&
      value.licenseNumber &&
      value.licenseNo !== value.licenseNumber
    ) {
      return helpers.message("Driving licence numbers cannot be different.");
    }
    return value;
  });