import { Router } from "express";
import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validations/listValidation.js";
import { createExpenseSchema, updateExpenseSchema } from "../validations/expenseValidation.js";
import {
  listExpenses, getExpenseStats, getExpense, getDriverBookingBalance,
  createExpense, updateExpense, deleteExpense,
} from "../controllers/expenseController.js";

const router = Router();
router.use(authenticate, tenantMiddleware, checkSubscription);
router.get("/", checkPermission("expenses.view"), listExpenses);
router.get("/stats", checkPermission("expenses.view"), getExpenseStats);
router.get("/driver-balance/:bookingId", checkPermission("expenses.view"), getDriverBookingBalance);
router.post("/", checkPermission("expenses.create"), validate(createExpenseSchema), createExpense);
router.get("/:id", checkPermission("expenses.view"), validate(idParamSchema, "params"), getExpense);
router.patch("/:id", checkPermission("expenses.update"), validate(idParamSchema, "params"), validate(updateExpenseSchema), updateExpense);
router.delete("/:id", checkPermission("expenses.delete"), validate(idParamSchema, "params"), deleteExpense);
export default router;
