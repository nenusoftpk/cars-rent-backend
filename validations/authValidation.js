
import Joi from "joi";
import { text, email, phone } from "./common.js";

// ======================================================
// COMMON VALIDATION FIELDS
// ======================================================

const nameField = text(120)
  .min(2)
  .messages({
    "string.empty": "Name is required.",
    "string.min": "Name must be at least 2 characters.",
    "string.max": "Name cannot exceed 120 characters.",
    "any.required": "Name is required.",
  });

const businessNameField = text(150)
  .min(2)
  .messages({
    "string.empty": "Business name is required.",
    "string.min": "Business name must be at least 2 characters.",
    "string.max": "Business name cannot exceed 150 characters.",
    "any.required": "Business name is required.",
  });

const emailField = email.messages({
  "string.empty": "Email address is required.",
  "string.email": "Please enter a valid email address.",
  "any.required": "Email address is required.",
});

const phoneField = phone.messages({
  "string.empty": "Phone number is required.",
  "any.required": "Phone number is required.",
});

const optionalPhoneField = Joi.string()
  .trim()
  .max(30)
  .allow("", null)
  .messages({
    "string.max": "Phone number cannot exceed 30 characters.",
  });

const passwordField = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[a-z]/)
  .pattern(/[A-Z]/)
  .pattern(/[0-9]/)
  .pattern(/[^A-Za-z0-9]/)
  .messages({
    "string.empty": "Password is required.",
    "string.min": "Password must be at least 8 characters.",
    "string.max": "Password cannot exceed 128 characters.",
    "string.pattern.base":
      "Password must contain uppercase, lowercase, number and special character.",
    "any.required": "Password is required.",
  });

const confirmPasswordField = Joi.string()
  .valid(Joi.ref("password"))
  .required()
  .messages({
    "any.only": "Passwords do not match.",
    "string.empty": "Please confirm your password.",
    "any.required": "Please confirm your password.",
  });

const newPasswordField = passwordField;

const confirmNewPasswordField = Joi.string()
  .valid(Joi.ref("newPassword"))
  .required()
  .messages({
    "any.only": "New passwords do not match.",
    "string.empty": "Please confirm your new password.",
    "any.required": "Please confirm your new password.",
  });

const photoField = Joi.string()
  .trim()
  .uri({ scheme: ["https"] })
  .allow("")
  .messages({
    "string.uri": "Please provide a valid HTTPS photo URL.",
  });

// ======================================================
// ADMIN SIGNUP
// ======================================================

// Public signup creates an Admin account.
// Role, permissions, subscription and businessId
// must be assigned by the backend, not the client.

export const signupSchema = Joi.object({
  businessName: businessNameField.required(),

  name: nameField.required(),

  email: emailField.required(),

  phone: phoneField.required(),

  password: passwordField.required(),

  confirmPassword: confirmPasswordField,

  // Optional business contact details.

  businessPhone: optionalPhoneField,

  address: Joi.string()
    .trim()
    .max(500)
    .allow(""),

  city: Joi.string()
    .trim()
    .max(100)
    .allow(""),

  country: Joi.string()
    .trim()
    .max(100)
    .default("Pakistan"),
});

// ======================================================
// LOGIN
// ======================================================

// Same login API for Super Admin, Admin and Employee.

export const loginSchema = Joi.object({
  email: emailField.required(),

  password: Joi.string()
    .required()
    .messages({
      "string.empty": "Password is required.",
      "any.required": "Password is required.",
    }),
});

// ======================================================
// GET OWN PROFILE
// ======================================================

// GET /auth/me does not require a request body.
// Authentication middleware identifies the user.

// ======================================================
// UPDATE OWN PROFILE
// ======================================================

// Role, businessId, permissions, status and
// createdBy are intentionally not editable here.

export const updateProfileSchema = Joi.object({
  name: nameField,

  phone: optionalPhoneField,

  photo: photoField,
}).min(1).messages({
  "object.min": "Please provide at least one field to update.",
});

// ======================================================
// CHANGE PASSWORD
// ======================================================

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      "string.empty": "Current password is required.",
      "any.required": "Current password is required.",
    }),

  newPassword: newPasswordField.required(),

  confirmNewPassword: confirmNewPasswordField,
});

// ======================================================
// FORGOT PASSWORD
// ======================================================

export const forgotPasswordSchema = Joi.object({
  email: emailField.required(),
});

// ======================================================
// RESET PASSWORD
// ======================================================

export const resetPasswordSchema = Joi.object({
  token: Joi.string()
    .trim()
    .min(32)
    .max(512)
    .required()
    .messages({
      "string.empty": "Password reset token is required.",
      "any.required": "Password reset token is required.",
      "string.min": "Invalid password reset token.",
    }),

  password: passwordField.required(),

  confirmPassword: confirmPasswordField,
});

// ======================================================
// EMAIL VERIFICATION
// ======================================================

export const verifyEmailSchema = Joi.object({
  token: Joi.string()
    .trim()
    .min(32)
    .max(512)
    .required()
    .messages({
      "string.empty": "Email verification token is required.",
      "any.required": "Email verification token is required.",
    }),
});

// ======================================================
// RESEND EMAIL VERIFICATION
// ======================================================

// Intended for an authenticated user.

export const resendVerificationSchema = Joi.object({});

// ======================================================
// LOGOUT
// ======================================================

// The backend identifies the logged-in user through JWT.
// No userId or tokenVersion should be supplied by the client.

export const logoutSchema = Joi.object({});

// ======================================================
// OPTIONAL: UPDATE EMAIL
// ======================================================

// Email changes should require password confirmation
// and a verification workflow in the controller.

export const updateEmailSchema = Joi.object({
  newEmail: emailField.required(),

  currentPassword: Joi.string()
    .required()
    .messages({
      "string.empty": "Current password is required.",
      "any.required": "Current password is required.",
    }),
});
