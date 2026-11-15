import Joi from "joi";

export const EXPENSE_CATEGORIES = [
  "fuel", "repair", "service", "oil_change", "tyres", "brakes", "inspection",
  "salary", "driver_payment", "insurance", "tax", "insurance_tax",
  "rent", "utilities", "office_expense", "other",
];

const objectId = Joi.string().hex().length(24);
const optionalId = objectId.allow(null, "");
const amount = Joi.number().positive().precision(2).strict();
const date = Joi.date().iso().allow(null, "");
const optionalText = (max) => Joi.string().trim().max(max).allow("", null);

const fields = {
  carId: optionalId,
  bookingId: optionalId,
  driverId: optionalId,
  title: Joi.string().trim().min(2).max(200),
  category: Joi.string().valid(...EXPENSE_CATEGORIES),
  amount,
  paidTo: optionalText(200),
  paymentMethod: Joi.string().valid("cash", "bank", "jazzcash", "easypaisa", "card", "other"),
  expenseDate: date,
  receiptImage: optionalText(2048),
  description: optionalText(1500),
  workshopName: optionalText(200),
  odometer: Joi.number().min(0).allow(null, ""),
  nextServiceDate: date,
  nextServiceOdometer: Joi.number().min(0).allow(null, ""),
  nextOilChangeDate: date,
  nextOilChangeOdometer: Joi.number().min(0).allow(null, ""),
  idempotencyKey: Joi.string().trim().min(8).max(120),
};

export const createExpenseSchema = Joi.object({
  ...fields,
  title: fields.title.required(),
  category: fields.category.required(),
  amount: Joi.number().positive().precision(2).required(),
}).unknown(false);

export const updateExpenseSchema = Joi.object(
  Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "idempotencyKey"))
).min(1).unknown(false);
