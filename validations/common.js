import Joi from "joi";

export const objectId = Joi.string().hex().length(24).messages({
  "string.hex": "Please select a valid record.",
  "string.length": "Please select a valid record.",
});
export const text = (max = 200) => Joi.string().trim().max(max);
export const optionalText = (max = 200) => text(max).allow("", null);
export const money = Joi.number().min(0).precision(2).messages({
  "number.base": "Please enter a valid amount.",
  "number.min": "Amount cannot be negative.",
});
export const optionalDate = Joi.date().iso().allow(null, "");
export const date = Joi.date().iso().required().messages({
  "any.required": "Please select a date.",
  "date.format": "Please enter a valid date.",
});
export const image = Joi.string().trim().uri({ scheme: ["https"] }).max(2048).allow("", null);
export const images = Joi.array().items(image).max(20);
export const phone = Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,20}$/).messages({
  "string.pattern.base": "Please enter a valid phone number.",
});
export const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } });
export const paymentMethod = Joi.string().valid("cash", "bank", "jazzcash", "easypaisa", "card", "other");
export const requiredId = objectId.required().messages({ "any.required": "Please select a record." });
export const createUpdate = (fields, requiredOnCreate = []) => {
  const createFields = { ...fields };
  for (const key of requiredOnCreate) createFields[key] = fields[key].required();
  return {
    create: Joi.object(createFields).required(),
    update: Joi.object(fields).min(1).required(),
  };
};
