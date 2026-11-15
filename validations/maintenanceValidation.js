import Joi from "joi";
import { createUpdate, objectId, optionalText, money, optionalDate } from "./common.js";
const fields = {
  carId: objectId, serviceType: Joi.string().valid("oil_change", "service", "repair", "tyres", "brakes", "inspection", "other"),
  serviceDate: Joi.date().iso(), nextServiceDate: optionalDate,
  odometer: Joi.number().min(0), nextServiceOdometer: Joi.number().min(0).allow(null),
  cost: money, workshopName: optionalText(200), description: optionalText(1500),
  status: Joi.string().valid("scheduled", "in_progress", "completed", "cancelled"),
};
const schemas = createUpdate(fields, ["carId", "serviceType", "serviceDate"]);
export const createMaintenanceSchema = schemas.create;
export const updateMaintenanceSchema = schemas.update;
