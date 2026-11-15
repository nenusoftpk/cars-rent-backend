
import { ALLOWED_PERMISSIONS } from "../config/defaultPermissions.js";

// Allow only selected roles.
export const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this feature.",
      });
    }

    next();
  };
};

// Check one or more employee permissions.
export const checkPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    const { role, permissions = [] } = req.user;

    // Admin controls everything within their own business.
    // Super Admin access to tenant data must be explicitly authorized.
    if (role === "admin") {
      return next();
    }

    if (role === "super-admin") {
      return res.status(403).json({
        success: false,
        message:
          "Please use the authorized platform administration route.",
      });
    }

    if (role !== "employee") {
      return res.status(403).json({
        success: false,
        message: "Your account role is not supported.",
      });
    }

    if (
      requiredPermissions.length === 0 ||
      requiredPermissions.some(
        (permission) => !ALLOWED_PERMISSIONS.includes(permission)
      )
    ) {
      const error = new Error(
        "Route permission configuration is invalid."
      );
      error.statusCode = 500;
      return next(error);
    }

    const missingPermissions = requiredPermissions.filter(
      (permission) => !permissions.includes(permission)
    );

    if (missingPermissions.length > 0) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to perform this action. Please contact your administrator.",
      });
    }

    next();
  };
};

// Require every requested permission.
export const requireAllPermissions = checkPermission;

// Allow an employee if they have at least one requested permission.
export const requireAnyPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    if (req.user.role === "admin") {
      return next();
    }

    if (req.user.role !== "employee") {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this feature.",
      });
    }

    if (
      requiredPermissions.length === 0 ||
      requiredPermissions.some(
        (permission) => !ALLOWED_PERMISSIONS.includes(permission)
      )
    ) {
      const error = new Error(
        "Route permission configuration is invalid."
      );
      error.statusCode = 500;
      return next(error);
    }

    const allowed = requiredPermissions.some((permission) =>
      req.user.permissions.includes(permission)
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to use this feature.",
      });
    }

    next();
  };
};

// For routes that only the platform owner can use.
export const superAdminOnly = allowRoles("super-admin");

// For business administration, such as managing employees.
export const adminOnly = allowRoles("admin");

// For routes that support both business roles.
export const businessUsersOnly = allowRoles("admin", "employee");
