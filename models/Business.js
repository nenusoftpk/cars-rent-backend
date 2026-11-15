
import mongoose from "mongoose";

const { Schema } = mongoose;

const businessSchema = new Schema(
  {
    // Business Information
    businessName: {
      type: String,
      required: [true, "Business name is required."],
      trim: true,
      minlength: [2, "Business name must be at least 2 characters."],
      maxlength: [150, "Business name cannot exceed 150 characters."],
    },

    // Business Status (Controlled by Super Admin)
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Index for business listing and searching
businessSchema.index({ businessName: 1 });

export default mongoose.models.Business ||
  mongoose.model("Business", businessSchema);
