
import Business from "../models/Business.js";
import Subscription from "../models/Subscription.js";

// Check whether the business has permission to use the software.
export const checkSubscription = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    if (req.user.role === "super-admin") {
      return res.status(403).json({
        success: false,
        message:
          "Please use the authorized platform administration route.",
      });
    }

    const businessId = req.user.businessId;

    if (!businessId) {
      return res.status(403).json({
        success: false,
        message: "Your account is not linked to a business.",
      });
    }

    const [business, subscription] = await Promise.all([
      Business.findById(businessId)
        .select("_id businessName status")
        .lean(),

      Subscription.findOne({ businessId })
        .select(
          "businessId plan status paymentStatus startDate endDate trialDays trialExtensionDays"
        )
        .lean(),
    ]);

    if (!business) {
      return res.status(403).json({
        success: false,
        message:
          "Your business account could not be found. Please contact support.",
      });
    }

    if (business.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Your business account is temporarily suspended. Please contact support.",
      });
    }

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message:
          "Your subscription has not been set up. Please contact support.",
      });
    }

    if (subscription.status === "suspended") {
      return res.status(403).json({
        success: false,
        message:
          "Your subscription is suspended. Please contact support.",
      });
    }

    if (subscription.status === "expired") {
      return res.status(403).json({
        success: false,
        message:
          "Your subscription has expired. Please renew it to continue.",
      });
    }

    const now = new Date();
    const startDate = subscription.startDate
      ? new Date(subscription.startDate)
      : null;

    const endDate = subscription.endDate
      ? new Date(subscription.endDate)
      : null;

    if (
      !startDate ||
      Number.isNaN(startDate.getTime()) ||
      startDate > now
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your subscription has not started yet. Please contact support.",
      });
    }

    const isTrial =
      subscription.plan === "trial" &&
      subscription.status === "trialing";

    const isPaidPlan =
      ["monthly", "yearly", "lifetime"].includes(subscription.plan) &&
      subscription.status === "active" &&
      subscription.paymentStatus === "paid";

    if (!isTrial && !isPaidPlan) {
      return res.status(403).json({
        success: false,
        message:
          "Your subscription is not active. Please contact support to activate your plan.",
      });
    }

    // Trials, monthly plans, and yearly plans must have an end date.
    if (subscription.plan !== "lifetime") {
      if (!endDate || Number.isNaN(endDate.getTime())) {
        return res.status(403).json({
          success: false,
          message:
            "Your subscription expiry date is missing. Please contact support.",
        });
      }

      if (now >= endDate) {
        return res.status(403).json({
          success: false,
          message: isTrial
            ? "Your free trial has ended. Please choose a subscription plan to continue."
            : "Your subscription has expired. Please renew it to continue.",
        });
      }
    }

    // Make subscription information available to the controller.
    req.subscription = {
      id: String(subscription._id),
      businessId,
      plan: subscription.plan,
      status: subscription.status,
      paymentStatus: subscription.paymentStatus,
      startDate,
      endDate,
      isTrial,
      isLifetime: subscription.plan === "lifetime",
      daysRemaining: endDate
        ? Math.max(
            0,
            Math.ceil((endDate.getTime() - now.getTime()) / 86400000)
          )
        : null,
    };

    req.business = business;

    next();
  } catch (error) {
    next(error);
  }
};

export default checkSubscription;
