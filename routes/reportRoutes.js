import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";

import {
  getReport,
  getIncomeExpenseReport,
  getBookingReport,
  getPaymentReport,
  getExpenseReport,
  getCustomerReport,
  getCarsStatusReport,
  getDriverReport,
} from "../controllers/reportController.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// Unified entry used by the Reports page (name / report query)
router.get(
  "/",
  checkPermission("reports.view"),
  getReport
);

// Explicit endpoints (still available for direct use / older clients)
router.get(
  "/income-expense",
  checkPermission("reports.view"),
  getIncomeExpenseReport
);

router.get(
  "/bookings",
  checkPermission("reports.view"),
  getBookingReport
);

router.get(
  "/payments",
  checkPermission("reports.view"),
  getPaymentReport
);

router.get(
  "/expenses",
  checkPermission("reports.view"),
  getExpenseReport
);

router.get(
  "/customers",
  checkPermission("reports.view"),
  getCustomerReport
);

router.get(
  "/cars-status",
  checkPermission("reports.view"),
  getCarsStatusReport
);

router.get(
  "/drivers",
  checkPermission("reports.view"),
  getDriverReport
);

export default router;