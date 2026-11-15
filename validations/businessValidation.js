import Joi from "joi";
import { createUpdate, text, optionalText, phone, email, image } from "./common.js";
const fields = {
  businessName: text(150).min(2), ownerName: text(120).min(2), email,
  phone, address: optionalText(500), city: optionalText(100),
  country: optionalText(100), logo: image, currency: text(10),
};
const schemas = createUpdate(fields, ["businessName", "ownerName", "email", "phone"]);
export const createBusinessSchema = schemas.create;
export const updateBusinessSchema = schemas.update;
// Only super-admin routes should allow changing business status.
export const updateBusinessStatusSchema = Joi.object({ status: Joi.string().valid("active", "suspended").required() });
