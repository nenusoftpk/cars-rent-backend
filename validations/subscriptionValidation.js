import Joi from "joi";
import { objectId, optionalText } from "./common.js";
// Super-admin only. Subscription is created by the backend during signup.
export const changePlanSchema = Joi.object({
  plan: Joi.string().valid("trial", "monthly", "yearly", "lifetime").required(),
  startDate: Joi.date().iso(), endDate: Joi.date().iso().allow(null),
  paymentStatus: Joi.string().valid("paid", "unpaid"),
  notes: optionalText(1000),
});
export const extendTrialSchema = Joi.object({
  days: Joi.number().integer().min(1).max(365).required().messages({
    "number.min": "Please enter at least 1 day.",
    "number.max": "You can add up to 365 days at a time.",
  }),
});
export const updateSubscriptionStatusSchema = Joi.object({
  status: Joi.string().valid("trialing", "active", "expired", "suspended").required(),
  notes: optionalText(1000),
});
export const updateSubscriptionPaymentSchema = Joi.object({ paymentStatus: Joi.string().valid("paid", "unpaid").required() });
// Always compute trial and plan expiry on the server, not from client dates.
