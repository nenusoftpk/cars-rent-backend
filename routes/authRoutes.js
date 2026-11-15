
import { Router } from "express";

// ======================================================
// MIDDLEWARES
// ======================================================

import authenticate from "../middlewares/auth.middleware.js";

import validate from "../middlewares/validate.middleware.js";

import {
  uploadImages,
  handleUpload,
} from "../middlewares/upload.middleware.js";

// ======================================================
// CONTROLLERS
// ======================================================

import {
  signup,
  login,
  me,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  resendVerification,
  verifyEmail,
  updateEmail,
  logout,
  logoutAll,
} from "../controllers/authController.js";

// ======================================================
// VALIDATIONS
// ======================================================

import {
  signupSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resendVerificationSchema,
  verifyEmailSchema,
  updateEmailSchema,
  logoutSchema,
} from "../validations/authValidation.js";

// ======================================================
// ROUTER INITIALIZATION
// ======================================================

const router = Router();

// ======================================================
// UPLOAD CONFIGURATIONS
// ======================================================

// Signup accepts two optional images:
// - avatar: Admin profile photo
// - logo: Business logo
//
// Allowed formats: JPG, PNG, WEBP
// Maximum file size: 5 MB each

const signupImageUpload = handleUpload(
  uploadImages.fields([
    {
      name: "avatar",
      maxCount: 1,
    },
    {
      name: "logo",
      maxCount: 1,
    },
  ])
);

// Profile update accepts one optional image:
// - avatar: User profile photo
//
// Available for Super Admin, Admin and Employee.

const profileImageUpload = handleUpload(
  uploadImages.single("avatar")
);

// ======================================================
// PUBLIC ROUTES
// ======================================================

// ------------------------------------------------------
// 1. SIGNUP
// POST /signup
//
// Creates:
// - Business
// - Admin
// - 3-day trial subscription
// - Business settings
//
// Supports:
// - application/json
// - multipart/form-data
// ------------------------------------------------------

router.post(
  "/signup",
  signupImageUpload,
  validate(signupSchema),
  signup
);

// ------------------------------------------------------
// 2. LOGIN
// POST /login
//
// Roles:
// - super-admin
// - admin
// - employee
// ------------------------------------------------------

router.post(
  "/login",
  validate(loginSchema),
  login
);

// ------------------------------------------------------
// 3. FORGOT PASSWORD
// POST /forgot-password
// ------------------------------------------------------

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  forgotPassword
);

// ------------------------------------------------------
// 4. RESET PASSWORD
// POST /reset-password
// ------------------------------------------------------

router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  resetPassword
);

// ------------------------------------------------------
// 5. VERIFY EMAIL
// POST /verify-email
// ------------------------------------------------------

router.post(
  "/verify-email",
  validate(verifyEmailSchema),
  verifyEmail
);

// ======================================================
// PROTECTED ROUTES
// ======================================================

// Every route below requires a valid JWT.

router.use(authenticate);

// ------------------------------------------------------
// 6. GET CURRENT USER
// GET /me
// ------------------------------------------------------

router.get(
  "/me",
  me
);

// ------------------------------------------------------
// 7. UPDATE OWN PROFILE
// PATCH /profile
//
// Allowed:
// - name
// - phone
// - avatar (optional image)
//
// Restricted:
// - role
// - permissions
// - businessId
// - status
// - email
// - password
//
// Supports JSON and multipart/form-data.
// ------------------------------------------------------

router.patch(
  "/profile",
  profileImageUpload,
  validate(updateProfileSchema),
  updateProfile
);

// ------------------------------------------------------
// 8. CHANGE PASSWORD
// PATCH /change-password
// ------------------------------------------------------

router.patch(
  "/change-password",
  validate(changePasswordSchema),
  changePassword
);

// ------------------------------------------------------
// 9. RESEND EMAIL VERIFICATION
// POST /resend-verification
// ------------------------------------------------------

router.post(
  "/resend-verification",
  validate(resendVerificationSchema),
  resendVerification
);

// ------------------------------------------------------
// 10. UPDATE EMAIL
// PATCH /update-email
// ------------------------------------------------------

router.patch(
  "/update-email",
  validate(updateEmailSchema),
  updateEmail
);

// ------------------------------------------------------
// 11. LOGOUT
// POST /logout
// ------------------------------------------------------

router.post(
  "/logout",
  validate(logoutSchema),
  logout
);

// ------------------------------------------------------
// 12. LOGOUT ALL DEVICES
// POST /logout-all
// ------------------------------------------------------

router.post(
  "/logout-all",
  validate(logoutSchema),
  logoutAll
);

export default router;
