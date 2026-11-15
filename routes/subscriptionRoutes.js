import { Router } from "express";

import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";

import { getMySubscription } from "../controllers/subscriptionController.js";

const router = Router();

// Tenant can always view their own subscription
// (even if trial or paid plan is expired)
router.use(authenticate, tenantMiddleware);

router.get("/me", getMySubscription);

export default router;