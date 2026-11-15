
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";

// ======================================================
// AUTHENTICATE USER
// ======================================================

export const authenticate = async (req, res, next) => {
  try {
    // ==================================================
    // 1. GET AUTHORIZATION HEADER
    // ==================================================

    const authorization = req.headers.authorization;

    if (!authorization || typeof authorization !== "string") {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    // Expected: Authorization: Bearer <token>

    const parts = authorization.trim().split(/\s+/);

    if (
      parts.length !== 2 ||
      parts[0].toLowerCase() !== "bearer" ||
      !parts[1]
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format. Please log in again.",
      });
    }

    const token = parts[1];

    // ==================================================
    // 2. CHECK JWT CONFIGURATION
    // ==================================================

    if (!process.env.JWT_SECRET) {
      const error = new Error("JWT_SECRET is not configured.");
      error.statusCode = 500;
      return next(error);
    }

    // ==================================================
    // 3. VERIFY JWT
    // ==================================================

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Your session has expired. Please log in again.",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Your session is invalid. Please log in again.",
      });
    }

    // ==================================================
    // 4. VALIDATE JWT PAYLOAD
    // ==================================================

    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.sub !== "string" ||
      !mongoose.isObjectIdOrHexString(decoded.sub) ||
      !Number.isSafeInteger(decoded.tokenVersion) ||
      decoded.tokenVersion < 0
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid. Please log in again.",
      });
    }

    // ==================================================
    // 5. GET USER FROM DATABASE
    // ==================================================

    // tokenVersion is select:false in User.js,
    // so explicitly include it in this query.

    const user = await User.findById(decoded.sub)
      .select("+tokenVersion")
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Your account was not found. Please log in again.",
      });
    }

    // ==================================================
    // 6. CHECK ACCOUNT STATUS
    // ==================================================

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is disabled. Please contact your administrator.",
      });
    }

    // ==================================================
    // 7. CHECK JWT SESSION VERSION
    // ==================================================

    // This invalidates previous JWTs after:
    // - Password change
    // - Password reset
    // - Logout
    // - Logout from all devices
    // - Email change (when the controller increments it)

    if (decoded.tokenVersion !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({
        success: false,
        message: "Your session has ended. Please log in again.",
      });
    }

    // ==================================================
    // 8. VALIDATE USER ROLE AND BUSINESS
    // ==================================================

    const allowedRoles = ["super-admin", "admin", "employee"];

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Your account role is invalid. Contact support.",
      });
    }

    // Super Admin belongs to the platform, not a business.

    if (user.role === "super-admin") {
      if (user.businessId) {
        return res.status(403).json({
          success: false,
          message: "Your account setup is invalid. Contact support.",
        });
      }
    }

    // Admin and Employee must belong to a business.

    if (user.role === "admin" || user.role === "employee") {
      if (
        !user.businessId ||
        !mongoose.isObjectIdOrHexString(user.businessId)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your account is not linked to a valid business. Contact support.",
        });
      }
    }

    // ==================================================
    // 9. ATTACH SAFE USER DATA TO REQUEST
    // ==================================================

    // Always read current roles and permissions from MongoDB.
    // Never trust role or permissions included in a JWT.

    req.user = {
      _id: user._id,
      id: String(user._id),

      businessId: user.businessId
        ? String(user.businessId)
        : null,

      name: user.name,
      email: user.email,
      phone: user.phone || "",
      photo: user.photo || "",

      role: user.role,

      permissions:
        user.role === "employee"
          ? user.permissions || []
          : [],

      dataScope:
        user.role === "employee"
          ? user.dataScope || "own"
          : "business",

      status: user.status,

      createdBy: user.createdBy
        ? String(user.createdBy)
        : null,

      isEmailVerified: user.isEmailVerified || false,

      lastLoginAt: user.lastLoginAt || null,
    };

    // ==================================================
    // 10. CONTINUE TO NEXT MIDDLEWARE / CONTROLLER
    // ==================================================

    return next();
  } catch (error) {
    return next(error);
  }
};

// ======================================================
// EXPORT
// ======================================================

export default authenticate;
