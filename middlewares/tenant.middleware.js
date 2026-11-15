import mongoose from "mongoose";
import Business from "../models/Business.js";

const { Types } = mongoose;

export const tenantMiddleware = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    const { role, businessId, id, dataScope } = req.user;

    if (role === "super-admin") {
      return res.status(403).json({
        success: false,
        message:
          "Please use the Super Admin dashboard for this action.",
      });
    }

    if (!["admin", "employee"].includes(role)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this feature.",
      });
    }

    if (!businessId || !Types.ObjectId.isValid(businessId)) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is not linked to a valid business. Please contact support.",
      });
    }

    const business = await Business.findById(businessId)
      .select("_id businessName status")
      .lean();

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

    req.tenant = Object.freeze({
      businessId: new Types.ObjectId(businessId),
      userId: new Types.ObjectId(id),
      role,
      dataScope: role === "admin" ? "business" : dataScope,
      businessName: business.businessName,
    });

    next();
  } catch (error) {
    next(error);
  }
};

export default tenantMiddleware;