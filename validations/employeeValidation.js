import Joi from "joi";
import { text, optionalText, phone, email } from "./common.js";
import { ALLOWED_PERMISSIONS } from "../config/defaultPermissions.js";

const permissions = Joi.array()
  .items(Joi.string().valid(...ALLOWED_PERMISSIONS))
  .unique()
  .messages({
    "array.unique": "Duplicate permissions are not allowed.",
    "any.only": "One or more permissions are invalid.",
    "array.base": "Permissions must be an array of allowed permission strings.",
  });

const dataScope = Joi.string().valid("own", "business");

const password = Joi.string().min(10).max(128).messages({
  "string.min": "Password must contain at least 10 characters.",
  "string.max": "Password cannot exceed 128 characters.",
});

/**
 * Accept either:
 *   - a real array  (application/json)
 *   - a JSON string that parses to an array  (multipart/form-data)
 * In both cases the final value is validated by the same `permissions` schema.
 */
const permissionsFromMultipart = Joi.any().custom((value, helpers) => {
  let candidate = value;

  // Multipart text field arrives as a string
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return helpers.error("any.invalid");
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return helpers.error("any.invalid");
    }
  }

  // Now run the real permissions schema on the (possibly just-parsed) array
  const { error, value: validated } = permissions.validate(candidate, {
    abortEarly: false,
  });

  if (error) {
    // Re-throw the first meaningful message so the global error middleware
    // can surface it cleanly
    return helpers.message(error.details[0]?.message || "Invalid permissions.");
  }

  return validated; // guaranteed to be a clean, unique, allowed array
}).messages({
  "any.invalid":
    "Permissions must be a valid JSON array of allowed permission strings.",
});

export const createEmployeeSchema = Joi.object({
  name: text(120).min(2).required(),
  email: email.required(),
  phone: phone.allow("", null),
  // photo / photoPublicId are never accepted from the client
  password: password.required(),
  permissions: permissionsFromMultipart.optional(),
  dataScope: dataScope.optional(),
}).unknown(false);

export const updateEmployeeSchema = Joi.object({
  name: text(120).min(2),
  phone: phone.allow("", null),
  // no photo URL / photoPublicId
}).min(0).unknown(false);
// min(0) allows pure image-only updates (avatar file, empty body).
// Controller still rejects a completely empty request (no fields + no file).

export const updateEmployeePermissionsSchema = Joi.object({
  permissions: permissions.required(),
  dataScope: dataScope.required(),
}).unknown(false);

export const updateEmployeeStatusSchema = Joi.object({
  status: Joi.string().valid("active", "disabled").required(),
}).unknown(false);

export const resetEmployeePasswordSchema = Joi.object({
  newPassword: password.required(),
}).unknown(false);