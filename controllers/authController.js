
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

import User from "../models/User.js";
import Business from "../models/Business.js";
import Subscription from "../models/Subscription.js";
import Setting from "../models/Setting.js";

import { wrap, send, fail } from "../utils/http.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// ======================================================
// COMMON HELPERS
// ======================================================

const PRIVATE_FIELDS = [
  "password",
  "passwordResetTokenHash",
  "passwordResetExpiresAt",
  "emailVerificationTokenHash",
  "emailVerificationExpiresAt",
  "tokenVersion",
  "failedLoginAttempts",
  "lockUntil",
  "photoPublicId",
].join(" ");

const safeUser = (user) => {
  const data = user.toObject ? user.toObject() : { ...user };

  for (const field of PRIVATE_FIELDS.split(" ")) {
    delete data[field];
  }

  delete data.__v;
  return data;
};

const createToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw fail("JWT_SECRET is not configured.", 500);
  }

  return jwt.sign(
    { tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    {
      subject: String(user._id),
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      algorithm: "HS256",
    }
  );
};

const createRandomToken = () =>
  crypto.randomBytes(32).toString("hex");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const hashPassword = async (password) =>
  bcrypt.hash(password, 12);

const getCurrentUser = async (req) => {
  if (!req.user?.id) {
    throw fail("Please log in to continue.", 401);
  }

  const user = await User.findById(req.user.id);

  if (!user || user.status !== "active") {
    throw fail("Your account is unavailable.", 403);
  }

  return user;
};

const sendEmail = async ({ to, subject, text }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } =
    process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw fail("Email service is not configured.", 503);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
  });
};

const getFrontendUrl = () => {
  const url = process.env.CLIENT_URL;

  if (!url) {
    throw fail("Client_URL is not configured.", 500);
  }

  return url.replace(/\/$/, "");
};

// ======================================================
// 1. ADMIN SIGNUP
// ======================================================


export const signup = wrap(async (req, res) => {
  const {
    businessName,
    name,
    email,
    phone,
    password,
    businessPhone,
    address,
    city,
    country,
  } = req.body;

  const avatarFile = req.files?.avatar?.[0];
  const logoFile = req.files?.logo?.[0];

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.exists({
    email: normalizedEmail,
  });

  if (existingUser) {
    throw fail(
      "This email address is already registered.",
      409
    );
  }

  // Generate Business ID before uploads.
  const businessId = new mongoose.Types.ObjectId();

  const uploadedPublicIds = [];

  let avatarUpload = null;
  let logoUpload = null;

  let createdUser;
  let createdBusiness;
  let createdSubscription;

  let committed = false;

  const session = await mongoose.startSession();

  try {
    // ================================================
    // UPLOAD PROFILE IMAGE
    // ================================================

    if (avatarFile) {
      avatarUpload = await uploadToCloudinary(
        avatarFile.buffer,
        `rent-a-car/${businessId}/profile`,
        "image",
        false
      );

      uploadedPublicIds.push(
        avatarUpload.public_id
      );
    }

    // ================================================
    // UPLOAD BUSINESS LOGO
    // ================================================

    if (logoFile) {
      logoUpload = await uploadToCloudinary(
        logoFile.buffer,
        `rent-a-car/${businessId}/businesses`,
        "image",
        false
      );

      uploadedPublicIds.push(
        logoUpload.public_id
      );
    }

    // ================================================
    // HASH PASSWORD
    // ================================================

    const hashedPassword = await hashPassword(password);

    const now = new Date();

    const trialEnd = new Date(
      now.getTime() + 3 * 86400000
    );

    // ================================================
    // MONGODB TRANSACTION
    // ================================================

    await session.withTransaction(async () => {
      const [business] = await Business.create(
        [
          {
            _id: businessId,
            businessName,
            ownerName: name,
            email: normalizedEmail,
            phone: businessPhone || phone,
            address: address || "",
            city: city || "",
            country: country || "Pakistan",
            logo: logoUpload?.secure_url || "",
            logoPublicId:
              logoUpload?.public_id || "",
            status: "active",
          },
        ],
        { session }
      );

      const [user] = await User.create(
        [
          {
            businessId: business._id,
            name,
            email: normalizedEmail,
            phone,
            password: hashedPassword,

            photo: avatarUpload?.secure_url || "",
            photoPublicId:
              avatarUpload?.public_id || "",

            role: "admin",
            permissions: [],
            dataScope: "business",
            status: "active",
            createdBy: null,
            tokenVersion: 0,
            isEmailVerified: false,
          },
        ],
        { session }
      );

      const [subscription] = await Subscription.create(
        [
          {
            businessId: business._id,
            plan: "trial",
            status: "trialing",
            paymentStatus: "unpaid",
            startDate: now,
            endDate: trialEnd,
            trialDays: 3,
            trialExtensionDays: 0,
          },
        ],
        { session }
      );

      await Setting.create(
        [
          {
            businessId: business._id,
            updatedBy: user._id,
          },
        ],
        { session }
      );

      createdUser = user;
      createdBusiness = business;
      createdSubscription = subscription;
    });

    committed = true;
  } catch (error) {
    // Clean up Cloudinary uploads if registration fails.
    // An unknown commit result requires reconciliation
    // rather than immediate deletion.
    if (
      !committed &&
      !error?.hasErrorLabel?.(
        "UnknownTransactionCommitResult"
      )
    ) {
      const cleanupResults = await Promise.allSettled(
        uploadedPublicIds.map((publicId) =>
          deleteFromCloudinary(
            publicId,
            "image",
            "upload"
          )
        )
      );

      for (const result of cleanupResults) {
        if (result.status === "rejected") {
          console.error(
            "Signup image cleanup failed:",
            result.reason
          );
        }
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }

  const token = createToken(createdUser);

  const businessData = createdBusiness.toObject();
  delete businessData.logoPublicId;
  delete businessData.__v;

  return send(
    res,
    {
      user: safeUser(createdUser),
      business: businessData,
      subscription: createdSubscription,
      token,
    },
    "Account created successfully. Your 3-day free trial has started.",
    201
  );
});


// ======================================================
// 2. LOGIN
// ======================================================

export const login = wrap(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const password = String(req.body.password);

  const user = await User.findOne({ email }).select(
    "+password +tokenVersion +failedLoginAttempts +lockUntil"
  );

  if (!user) {
    throw fail("Email or password is incorrect.", 401);
  }

  if (
    user.lockUntil &&
    user.lockUntil.getTime() > Date.now()
  ) {
    throw fail(
      "Your account is temporarily locked. Please try again later.",
      429
    );
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.password
  );

  if (!passwordMatches) {
    const attempts = (user.failedLoginAttempts || 0) + 1;

    const updates = {
      failedLoginAttempts: attempts,
      lockUntil: null,
    };

    if (attempts >= 5) {
      updates.failedLoginAttempts = 0;
      updates.lockUntil = new Date(Date.now() + 15 * 60000);
    }

    await User.updateOne({ _id: user._id }, { $set: updates });

    throw fail("Email or password is incorrect.", 401);
  }

  if (user.status !== "active") {
    throw fail(
      "Your account is disabled. Please contact your administrator.",
      403
    );
  }

  if (user.role === "super-admin" && user.businessId) {
    throw fail("Your account configuration is invalid.", 403);
  }

  if (user.role !== "super-admin" && !user.businessId) {
    throw fail("Your account is not linked to a business.", 403);
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    }
  );

  const token = createToken(user);

  send(
    res,
    {
      user: safeUser(user),
      token,
    },
    "Logged in successfully."
  );
});

// ======================================================
// 3. GET LOGGED-IN USER PROFILE
// ======================================================

export const me = wrap(async (req, res) => {
  const user = await getCurrentUser(req);

  const data = safeUser(user);

  if (user.businessId) {
    const [business, subscription] = await Promise.all([
      Business.findById(user.businessId).lean(),
      Subscription.findOne({
        businessId: user.businessId,
      }).lean(),
    ]);

    data.business = business;
    data.subscription = subscription;
  }

  send(res, data, "Profile retrieved successfully.");
});

// ======================================================
// 4. UPDATE OWN PROFILE
// ======================================================


export const updateProfile = wrap(async (req, res) => {
  const user = await User.findById(
    req.user.id
  ).select("+photoPublicId");

  if (!user || user.status !== "active") {
    throw fail(
      "Your account is unavailable.",
      403
    );
  }

  const avatarFile = req.file;

  const updates = {};

  for (const field of ["name", "phone"]) {
    if (
      Object.prototype.hasOwnProperty.call(
        req.body,
        field
      )
    ) {
      updates[field] = req.body[field];
    }
  }

  if (
    Object.keys(updates).length === 0 &&
    !avatarFile
  ) {
    throw fail(
      "Please provide profile information to update.",
      400
    );
  }

  const oldPhotoPublicId = user.photoPublicId;

  let uploadedPhoto = null;

  // ================================================
  // UPLOAD NEW PROFILE IMAGE
  // ================================================

  if (avatarFile) {
    const folder = user.businessId
      ? `rent-a-car/${user.businessId}/profile`
      : `rent-a-car/platform/profile`;

    uploadedPhoto = await uploadToCloudinary(
      avatarFile.buffer,
      folder,
      "image",
      false
    );
  }

  // ================================================
  // SAVE PROFILE
  // ================================================

  try {
    Object.assign(user, updates);

    if (uploadedPhoto) {
      user.photo = uploadedPhoto.secure_url;
      user.photoPublicId =
        uploadedPhoto.public_id;
    }

    await user.save();
  } catch (error) {
    if (uploadedPhoto) {
      try {
        await deleteFromCloudinary(
          uploadedPhoto.public_id,
          "image",
          "upload"
        );
      } catch (cleanupError) {
        console.error(
          "New profile photo cleanup failed:",
          cleanupError
        );
      }
    }

    throw error;
  }

  // ================================================
  // DELETE PREVIOUS PROFILE IMAGE
  // ================================================

  if (uploadedPhoto && oldPhotoPublicId) {
    try {
      await deleteFromCloudinary(
        oldPhotoPublicId,
        "image",
        "upload"
      );
    } catch (error) {
      console.error(
        "Old profile image deletion failed:",
        error
      );
    }
  }

  return send(
    res,
    safeUser(user),
    "Your profile has been updated successfully."
  );
});


// ======================================================
// 5. CHANGE PASSWORD
// ======================================================

export const changePassword = wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.id).select(
    "+password +tokenVersion"
  );

  if (!user || user.status !== "active") {
    throw fail("Account not found or unavailable.", 403);
  }

  const matches = await bcrypt.compare(
    currentPassword,
    user.password
  );

  if (!matches) {
    throw fail("Your current password is incorrect.", 400);
  }

  const samePassword = await bcrypt.compare(
    newPassword,
    user.password
  );

  if (samePassword) {
    throw fail(
      "New password must be different from your current password.",
      400
    );
  }

  user.password = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;

  await user.save();

  send(
    res,
    null,
    "Password changed successfully. Please log in again."
  );
});

// ======================================================
// 6. FORGOT PASSWORD
// ======================================================

export const forgotPassword = wrap(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();

  const user = await User.findOne({
    email,
    status: "active",
  });

  const message =
    "If an account exists with this email, password reset instructions will be sent.";

  if (!user) {
    return send(res, null, message);
  }

  const token = createRandomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60000);

  const resetUrl =
    `${getFrontendUrl()}/reset-password?token=` +
    encodeURIComponent(token);

  // Send first, then persist token.
  // This avoids storing an unusable token if email delivery fails.

  await sendEmail({
    to: user.email,
    subject: "Reset your Rent A Car password",
    text:
      `Hello ${user.name},\n\n` +
      `Use this link to reset your password:\n${resetUrl}\n\n` +
      "This link expires in 15 minutes.\n" +
      "If you did not request this, ignore this email.",
  });

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
      },
    }
  );

  send(res, null, message);
});

// ======================================================
// 7. RESET PASSWORD
// ======================================================

export const resetPassword = wrap(async (req, res) => {
  const { token, password } = req.body;

  const tokenHash = hashToken(token);

  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
    status: "active",
  }).select("+tokenVersion");

  if (!user) {
    throw fail(
      "Password reset link is invalid or has expired.",
      400
    );
  }

  const hashedPassword = await hashPassword(password);

  const result = await User.updateOne(
    {
      _id: user._id,
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
      $inc: { tokenVersion: 1 },
    }
  );

  if (!result.modifiedCount) {
    throw fail(
      "Password reset link has already been used or expired.",
      400
    );
  }

  send(
    res,
    null,
    "Password reset successfully. Please log in."
  );
});

// ======================================================
// 8. SEND / RESEND EMAIL VERIFICATION
// ======================================================

export const resendVerification = wrap(async (req, res) => {
  const user = await getCurrentUser(req);

  if (user.isEmailVerified) {
    return send(
      res,
      null,
      "Your email address is already verified."
    );
  }

  const token = createRandomToken();
  const tokenHash = hashToken(token);

  const verifyUrl =
    `${getFrontendUrl()}/verify-email?token=` +
    encodeURIComponent(token);

  await sendEmail({
    to: user.email,
    subject: "Verify your Rent A Car email",
    text:
      `Hello ${user.name},\n\n` +
      `Verify your email address using this link:\n${verifyUrl}\n\n` +
      "This link expires in 24 hours.",
  });

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: new Date(
          Date.now() + 24 * 60 * 60000
        ),
      },
    }
  );

  send(
    res,
    null,
    "Verification instructions have been sent to your email."
  );
});

// ======================================================
// 9. VERIFY EMAIL
// ======================================================

export const verifyEmail = wrap(async (req, res) => {
  const tokenHash = hashToken(req.body.token);

  const user = await User.findOneAndUpdate(
    {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
      status: "active",
    },
    {
      $set: {
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    },
    { new: true }
  );

  if (!user) {
    throw fail(
      "Verification link is invalid or has expired.",
      400
    );
  }

  send(
    res,
    null,
    "Your email address has been verified successfully."
  );
});

// ======================================================
// 10. UPDATE EMAIL ADDRESS
// ======================================================

// Requires current password.
// This changes the login email immediately and marks
// the new email as unverified. A stricter production
// workflow should verify the new address before switching.

export const updateEmail = wrap(async (req, res) => {
  const newEmail = String(req.body.newEmail)
    .trim()
    .toLowerCase();

  const { currentPassword } = req.body;

  const user = await User.findById(req.user.id).select(
    "+password +tokenVersion"
  );

  if (!user || user.status !== "active") {
    throw fail("Account not found or unavailable.", 403);
  }

  const validPassword = await bcrypt.compare(
    currentPassword,
    user.password
  );

  if (!validPassword) {
    throw fail("Current password is incorrect.", 400);
  }

  if (user.email === newEmail) {
    throw fail("This is already your email address.", 400);
  }

  const existing = await User.exists({ email: newEmail });

  if (existing) {
    throw fail("This email address is already registered.", 409);
  }

  user.email = newEmail;
  user.isEmailVerified = false;
  user.emailVerifiedAt = null;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.tokenVersion = (user.tokenVersion || 0) + 1;

  await user.save();

  send(
    res,
    safeUser(user),
    "Email updated. Please log in again and verify your new email."
  );
});

// ======================================================
// 11. LOGOUT FROM ALL DEVICES
// ======================================================

export const logout = wrap(async (req, res) => {
  const result = await User.updateOne(
    {
      _id: req.user.id,
      status: "active",
    },
    {
      $inc: { tokenVersion: 1 },
    }
  );

  if (!result.matchedCount) {
    throw fail("Account not found or unavailable.", 403);
  }

  send(
    res,
    null,
    "Logged out successfully from all devices."
  );
});

// ======================================================
// 12. LOGOUT ALL DEVICES ALIAS
// ======================================================

export const logoutAll = logout;
