import Joi from "joi";
import { objectId } from "./common.js";
export const idParamSchema = Joi.object({ id: objectId.required().messages({ "any.required": "Please select a record." }) });
export const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(150).allow(""),
  fromDate: Joi.date().iso(), toDate: Joi.date().iso(),
  sortBy: Joi.string().valid("createdAt", "updatedAt", "name", "date").default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
}).custom((value, helpers) => {
  if (value.fromDate && value.toDate && new Date(value.fromDate) > new Date(value.toDate)) {
    return helpers.message("From date cannot be after To date.");
  }
  return value;
});
