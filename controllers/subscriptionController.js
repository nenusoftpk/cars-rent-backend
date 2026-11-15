import Subscription from "../models/Subscription.js";
import Business from "../models/Business.js";

import { wrap, send, fail, fields } from "../utils/http.js";
import { tenantOnly, requirePlatform } from "../services/scope.js";

// ======================================================
// HELPERS
// ======================================================

const ALLOWED_PLANS = ["trial", "monthly", "yearly", "lifetime"];
const ALLOWED_STATUS = ["trialing", "active", "expired", "suspended"];
const ALLOWED_PAYMENT_STATUS = ["paid", "unpaid"];

const formatSubscription = (subscription) => {
  if (!subscription) return null;

  const item = subscription.toObject
    ? subscription.toObject()
    : { ...subscription };

  const now = new Date();
  const endDate = item.endDate ? new Date(item.endDate) : null;

  let daysRemaining = null;
  if (endDate && !Number.isNaN(endDate.getTime())) {
    daysRemaining = Math.max(
      0,
      Math.ceil((endDate.getTime() - now.getTime()) / 86400000)
    );
  }

  return {
    ...item,
    id: String(item._id),
    businessId: String(item.businessId),
    daysRemaining,
    isLifetime: item.plan === "lifetime",
    isTrial: item.plan === "trial" && item.status === "trialing",
    isActive:
      item.status === "active" ||
      (item.plan === "trial" && item.status === "trialing"),
  };
};

// ======================================================
// 1. GET MY SUBSCRIPTION (Tenant)
// GET /api/v1/subscriptions/me
// ======================================================

export const getMySubscription = wrap(async (req, res) => {
  const subscription = await Subscription.findOne(tenantOnly(req)).lean();

  if (!subscription) {
    throw fail("Subscription not found.", 404);
  }

  send(
    res,
    formatSubscription(subscription),
    "Subscription loaded successfully."
  );
});

// ======================================================
// 2. PLATFORM: GET SUBSCRIPTION BY BUSINESS
// GET /api/v1/platform/subscriptions/:businessId
// ======================================================

export const getPlatformSubscription = wrap(async (req, res) => {
  requirePlatform(req);

  const business = await Business.findById(req.params.businessId)
    .select("_id businessName status")
    .lean();

  if (!business) {
    throw fail("Business not found.", 404);
  }

  const subscription = await Subscription.findOne({
    businessId: business._id,
  }).lean();

  if (!subscription) {
    throw fail("Subscription not found for this business.", 404);
  }

  send(res, {
    business: {
      id: String(business._id),
      businessName: business.businessName,
      status: business.status,
    },
    subscription: formatSubscription(subscription),
  }, "Platform subscription loaded successfully.");
});

// ======================================================
// 3. PLATFORM: UPDATE / SET SUBSCRIPTION
// PATCH /api/v1/platform/subscriptions/:businessId
// ======================================================

export const setPlatformSubscription = wrap(async (req, res) => {
  requirePlatform(req);

  const business = await Business.findById(req.params.businessId);

  if (!business) {
    throw fail("Business not found.", 404);
  }

  const data = fields(req.body, [
    "plan",
    "status",
    "paymentStatus",
    "startDate",
    "endDate",
    "trialDays",
    "trialExtensionDays",
    "notes",
  ]);

  // ---------- Validation ----------
  if (data.plan && !ALLOWED_PLANS.includes(data.plan)) {
    throw fail("Invalid subscription plan.", 400);
  }

  if (data.status && !ALLOWED_STATUS.includes(data.status)) {
    throw fail("Invalid subscription status.", 400);
  }

  if (
    data.paymentStatus &&
    !ALLOWED_PAYMENT_STATUS.includes(data.paymentStatus)
  ) {
    throw fail("Invalid payment status.", 400);
  }

  // Lifetime plans should not have an end date
  if (data.plan === "lifetime") {
    data.endDate = null;
  }

  // Paid plans must have payment confirmation when activated
  if (
    data.plan &&
    data.plan !== "trial" &&
    data.status === "active" &&
    data.paymentStatus !== "paid"
  ) {
    throw fail(
      "Paid plans require verified payment confirmation before activation.",
      400
    );
  }

  // Validate dates
  if (data.startDate) {
    const start = new Date(data.startDate);
    if (Number.isNaN(start.getTime())) {
      throw fail("Invalid start date.", 400);
    }
    data.startDate = start;
  }

  if (data.endDate) {
    const end = new Date(data.endDate);
    if (Number.isNaN(end.getTime())) {
      throw fail("Invalid end date.", 400);
    }
    data.endDate = end;
  }

  if (
    data.startDate &&
    data.endDate &&
    data.endDate <= data.startDate
  ) {
    throw fail("End date must be after start date.", 400);
  }

  // ---------- Update ----------
  const updated = await Subscription.findOneAndUpdate(
    { businessId: business._id },
    {
      $set: {
        ...data,
        updatedBy: req.user.id,
        activatedBy: req.user.id,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updated) {
    throw fail("Subscription not found.", 404);
  }

  send(
    res,
    formatSubscription(updated),
    "Subscription updated successfully."
  );
});

// ======================================================
// 4. PLATFORM: LIST ALL SUBSCRIPTIONS (Optional but useful)
// GET /api/v1/platform/subscriptions
// ======================================================

export const listPlatformSubscriptions = wrap(async (req, res) => {
  requirePlatform(req);

  const filter = {};

  if (req.query.status) {
    if (!ALLOWED_STATUS.includes(req.query.status)) {
      throw fail("Invalid status filter.", 400);
    }
    filter.status = req.query.status;
  }

  if (req.query.plan) {
    if (!ALLOWED_PLANS.includes(req.query.plan)) {
      throw fail("Invalid plan filter.", 400);
    }
    filter.plan = req.query.plan;
  }

  const subscriptions = await Subscription.find(filter)
    .populate("businessId", "businessName email status")
    .sort({ createdAt: -1 })
    .lean();

  const items = subscriptions.map((item) => ({
    ...formatSubscription(item),
    business: item.businessId
      ? {
          id: String(item.businessId._id),
          businessName: item.businessId.businessName,
          email: item.businessId.email,
          status: item.businessId.status,
        }
      : null,
  }));

  send(res, { items }, "Subscriptions loaded successfully.");
});