import mongoose from "mongoose";

const { Schema } = mongoose;

const driverSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    // Profile photo
    photo: { type: String, default: "" },
    photoPublicId: { type: String, default: "", select: false },

    // CNIC
    cnic: {
      type: String,
      trim: true,
      default: "",
    },
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

    salary: {
      type: Number,
      min: 0,
      default: 0,
    },

    paymentType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },

    paymentRate: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator(value) {
          return this.paymentType !== "percentage" || value <= 100;
        },
        message: "Percentage payment cannot exceed 100%.",
      },
    },

    status: {
      type: String,
      enum: ["available", "assigned", "inactive"],
      default: "available",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true, // protects concurrent image updates
  }
);

driverSchema.index({ businessId: 1, status: 1 });
driverSchema.index({ businessId: 1, name: 1 });

export default mongoose.models.Driver ||
  mongoose.model("Driver", driverSchema);