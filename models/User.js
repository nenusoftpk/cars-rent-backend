
import mongoose from "mongoose";
import {
  DEFAULT_EMPLOYEE_PERMISSIONS,
  ALLOWED_PERMISSIONS,
} from "../config/defaultPermissions.js";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    // Business / Tenant
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      default: null,
      index: true,
    },

    // Personal Information
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    photo: {
      type: String,
      default: "",
    },

    photoPublicId: {
      type: String,
      default: "",
      select: false,
    },

    // Roles and Permissions
    role: {
      type: String,
      enum: ["super-admin", "admin", "employee"],
      required: true,
      default: "employee",
    },

    permissions: {
      type: [{ type: String, enum: ALLOWED_PERMISSIONS }],
      default: function () {
        return this.role === "employee"
          ? [...DEFAULT_EMPLOYEE_PERMISSIONS]
          : [];
      },
    },

    dataScope: {
      type: String,
      enum: ["own", "business"],
      default: "own",
    },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Email Verification
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },

    emailVerificationTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    emailVerificationExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    // Password Recovery
    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    // Session Security
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },

    // Login Information
    lastLoginAt: {
      type: Date,
      default: null,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ businessId: 1, role: 1, status: 1 });
userSchema.index({ businessId: 1, createdBy: 1 });

// Database-level role constraints
userSchema.pre("validate", function () {
  if (this.role === "super-admin" && this.businessId) {
    this.invalidate(
      "businessId",
      "Super Admin cannot belong to a business."
    );
  }

  if (this.role !== "super-admin" && !this.businessId) {
    this.invalidate("businessId", "Business is required.");
  }

  if (this.role !== "employee") {
    this.permissions = [];
    this.dataScope = "business";
  }
});

export default mongoose.models.User ||
  mongoose.model("User", userSchema);
