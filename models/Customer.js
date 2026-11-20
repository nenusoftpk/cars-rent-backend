import mongoose from "mongoose";

const { Schema } = mongoose;

// Pakistani mobile: 03001234567, +923001234567, 923001234567, 00923001234567
const PK_MOBILE_REGEX = /^(?:\+92|0092|92|0)3\d{9}$/;

// ======================================================
// GUARANTOR (embedded sub-document)
// Used twice: guarantor1 and guarantor2.
// *PublicId fields are select:false so they never leave the
// server unless a controller explicitly asks for them.
// ======================================================

const guarantorSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },

    name: {
      type: String,
      trim: true,
      default: "",
      maxlength: [120, "Guarantor name cannot exceed 120 characters."],
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Guarantor mobile cannot exceed 20 characters."],
      validate: {
        validator: (value) => !value || PK_MOBILE_REGEX.test(value),
        message: "Enter a valid Pakistani mobile number for the guarantor.",
      },
    },

    photo: { type: String, trim: true, default: "" },
    photoPublicId: { type: String, default: "", select: false },

    cnicFront: { type: String, trim: true, default: "" },
    cnicFrontPublicId: { type: String, default: "", select: false },

    cnicBack: { type: String, trim: true, default: "" },
    cnicBackPublicId: { type: String, default: "", select: false },
  },
  { _id: false }
);

// When a guarantor is enabled, all five fields are mandatory.
// (Runs on create()/save(). The controller performs the same check
// for findOneAndUpdate(), where sub-document hooks do not run.)
guarantorSchema.pre("validate", function () {
  if (!this.enabled) return;

  const missing = [];

  if (!this.name?.trim()) missing.push("name");
  if (!this.mobile?.trim()) missing.push("mobile");
  if (!this.photo?.trim()) missing.push("photo");
  if (!this.cnicFront?.trim()) missing.push("CNIC front image");
  if (!this.cnicBack?.trim()) missing.push("CNIC back image");

  if (missing.length) {
    this.invalidate(
      "enabled",
      `Guarantor is enabled but missing: ${missing.join(", ")}.`
    );
  }
});

// ======================================================
// CUSTOMER
// ======================================================

const customerSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },

    customerCode: {
      type: String,
      trim: true,
      default: undefined,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    alternatePhone: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    gender: {
      type: String,
      enum: ["male", "female", "other", ""],
      default: "",
    },

    type: {
      type: String,
      enum: ["", "Regular", "VIP", "Corporate"],
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    cnic: {
      type: String,
      trim: true,
      default: "",
    },

    // Profile photo
    photo: { type: String, default: "" },
    photoPublicId: { type: String, default: "", select: false },

    // CNIC documents
    cnicFront: { type: String, default: "" },
    cnicFrontPublicId: { type: String, default: "", select: false },

    cnicBack: { type: String, default: "" },
    cnicBackPublicId: { type: String, default: "", select: false },

    // Driving licence
    licenseNumber: {
      type: String,
      trim: true,
      default: "",
    },

    licenseImage: { type: String, default: "" },
    licenseImagePublicId: { type: String, default: "", select: false },

    licenseExpiry: {
      type: Date,
      default: null,
    },

    // Optional guarantors (independent of each other)
    guarantor1: {
      type: guarantorSchema,
      default: () => ({}),
    },

    guarantor2: {
      type: guarantorSchema,
      default: () => ({}),
    },

    openingBalance: {
      type: Number,
      default: 0,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

customerSchema.index(
  { businessId: 1, customerCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      customerCode: { $type: "string", $gt: "" },
    },
  }
);

customerSchema.index({ businessId: 1, phone: 1 });
customerSchema.index({ businessId: 1, cnic: 1 });
customerSchema.index({ businessId: 1, createdAt: -1 });
customerSchema.index({ businessId: 1, status: 1 });

export default mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);