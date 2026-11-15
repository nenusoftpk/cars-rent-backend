import mongoose from "mongoose";

const { Schema } = mongoose;

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
    optimisticConcurrency: true
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