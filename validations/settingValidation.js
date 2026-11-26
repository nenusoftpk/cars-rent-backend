import Joi from "joi";
import { optionalText, image } from "./common.js";
export const updateSettingSchema = Joi.object({
  invoicePrefix: Joi.string().trim().min(1).max(15),
  bookingPrefix: Joi.string().trim().min(1).max(15),
  paymentPrefix: Joi.string().trim().min(1).max(15),
  customerPrefix: Joi.string().trim().min(1).max(15),
  receiptHeader: optionalText(1000), receiptFooter: optionalText(1000),
  receiptLogo: image,
  receiptPaperSize: Joi.string().valid("a4", "a5", "80mm", "58mm"),
  defaultCurrency: Joi.string().trim().min(3).max(10),
  timezone: Joi.string().trim().max(100),
  dateFormat: Joi.string().valid("DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"),
  reminderDaysBefore: Joi.number().integer().min(0).max(365),
  termsAndConditions: Joi.array()
    .items(Joi.string().trim().min(1))
    .optional(),
}).min(1);
