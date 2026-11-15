
import mongoose from "mongoose";

const { Schema } = mongoose;

// ======================================================
// CAR INSPECTION SCHEMA
// ======================================================

const carInspectionSchema = new Schema(
  {
    // --------------------------------------------------
    // BUSINESS & RELATIONSHIPS
    // --------------------------------------------------

    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      immutable: true,
      index: true,
    },

    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
      index: true,
    },

    carId: {
      type: Schema.Types.ObjectId,
      ref: "Car",
      required: true,
      immutable: true,
      index: true,
    },

    // --------------------------------------------------
    // INSPECTION DETAILS
    // --------------------------------------------------

    type: {
      type: String,
      enum: ["issue", "return"],
      required: true,
      immutable: true,
    },

    inspectionDate: {
      type: Date,
      default: Date.now,
      required: true,
    },

    meterReading: {
      type: Number,
      required: true,
      min: 0,
    },

    fuelLevel: {
      type: String,
      enum: ["Empty", "1/4", "1/2", "3/4", "Full"],
      required: true,
    },

    condition: {
      type: String,
      enum: ["excellent", "good", "fair", "damaged"],
      default: "good",
    },

    // --------------------------------------------------
    // INSPECTION IMAGES
    // --------------------------------------------------

    photos: {
      type: [String],
      default: [],
    },

    photoPublicIds: {
      type: [String],
      default: [],
      select: false,
    },

    // --------------------------------------------------
    // CONDITION NOTES
    // --------------------------------------------------

    damageNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // --------------------------------------------------
    // RETURN INSPECTION CHARGES
    // --------------------------------------------------

    extraKilometers: {
      type: Number,
      min: 0,
      default: 0,
    },

    extraKmCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    extraDayCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    lateCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    damageCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    fuelCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    // --------------------------------------------------
    // STATUS & AUDIT
    // --------------------------------------------------

    status: {
      type: String,
      enum: ["finalized"],
      default: "finalized",
    },

    inspectedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

// ======================================================
// DATABASE INDEXES
// ======================================================

// One issue and one return inspection per booking.
carInspectionSchema.index(
  { businessId: 1, bookingId: 1, type: 1 },
  { unique: true }
);

// Car inspection history.
carInspectionSchema.index({
  businessId: 1,
  carId: 1,
  inspectionDate: -1,
});

// Business inspection listing.
carInspectionSchema.index({
  businessId: 1,
  inspectionDate: -1,
});

// ======================================================
// EXPORT MODEL
// ======================================================

export default mongoose.models.CarInspection ||
  mongoose.model("CarInspection", carInspectionSchema);
