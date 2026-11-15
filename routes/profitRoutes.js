import { Router } from "express";
import mongoose from "mongoose";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";

import {
  getBusinessProfit,
  getAllCarsProfit,
  getCarProfit,
} from "../controllers/profitController.js";

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// Business profit
router.get(
  "/business",
  checkPermission("reports.view"),
  getBusinessProfit
);

// All cars profit
router.get(
  "/cars",
  checkPermission("reports.view"),
  getAllCarsProfit
);

// Single car profit
router.get(
  "/cars/:carId",
  checkPermission("reports.view"),
  (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.carId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid car ID.",
      });
    }
    next();
  },
  getCarProfit
);

export default router;