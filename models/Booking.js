
import mongoose from "mongoose";

const { Schema } = mongoose;

// ======================================================
// INSPECTION FIELDS (ISSUE AND RETURN)
// ======================================================

const inspectionSchema = new Schema(
  {
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

    damageNotes: {
      type: String,
      trim: true,
      default: "",
    },

    photos: {
      type: [String],
      default: [],
    },

    inspectedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    inspectionDate: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ======================================================
// BOOKING SCHEMA
// ======================================================

const bookingSchema = new Schema(
  {
    // Business
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },

    // Booking Numbers
    bookingNumber: {
      type: String,
      required: true,
      trim: true,
    },

    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
    },

    // References
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    carId: {
      type: Schema.Types.ObjectId,
      ref: "Car",
      required: true,
    },

    driverId: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },
    driverPaymentType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },

    // Snapshot the agreed percentage/fixed rate so extensions do not use a later changed driver rate.
    driverPaymentRate: { type: Number, min: 0 },

    driverPaymentAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Rental Dates
    pickupDate: {
      type: Date,
      required: true,
    },

    returnDate: {
      type: Date,
      required: true,
    },

    actualPickupDate: {
      type: Date,
      default: null,
    },

    actualReturnDate: {
      type: Date,
      default: null,
    },

    pickupLocation: {
      type: String,
      trim: true,
      default: "",
    },

    returnLocation: {
      type: String,
      trim: true,
      default: "",
    },

    // Rental Pricing
    rentType: {
      type: String,
      enum: ["daily", "hourly"],
      default: "daily",
    },

    rentRate: {
      type: Number,
      required: true,
      min: 0,
    },

    rentalUnits: {
      type: Number,
      required: true,
      min: 0,
    },

    rentalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Additional Charges
    extraDayCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    extraHourCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    extraKmCharges: {
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

    otherCharges: {
      type: Number,
      min: 0,
      default: 0,
    },

    discount: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Custom Charges
    charges: {
      type: [
        {
          label: {
            type: String,
            required: true,
            trim: true,
          },

          amount: {
            type: Number,
            required: true,
            min: 0,
          },
        },
      ],
      default: [],
    },

    // Security Deposit
    securityDeposit: {
      type: Number,
      min: 0,
      default: 0,
    },

    securityReceived: {
      type: Number,
      min: 0,
      default: 0,
    },

    securityDeduction: {
      type: Number,
      min: 0,
      default: 0,
    },

    securityRefunded: {
      type: Number,
      min: 0,
      default: 0,
    },

    securityStatus: {
      type: String,
      enum: [
        "none",
        "pending",
        "held",
        "partially_refunded",
        "refunded",
        "forfeited",
      ],
      default: "none",
    },

    securityReceivedAt: {
      type: Date,
      default: null,
    },

    securityRefundedAt: {
      type: Date,
      default: null,
    },

    securityMethod: {
      type: String,
      enum: [
        "cash",
        "bank",
        "jazzcash",
        "easypaisa",
        "card",
        "other",
        "",
      ],
      default: "",
    },

    // Legacy embedded inspections are READ-ONLY compatibility fields.
    // New inspections live exclusively in CarInspection. Do not write these fields.
    // Car Issue
    issueInspection: {
      type: inspectionSchema,
      default: undefined,
    },

    // Car Return
    returnInspection: {
      type: inspectionSchema,
      default: undefined,
    },

    handedOverBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    receivedBackBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Booking Status
    status: {
      type: String,
      enum: [
        "reserved",
        "on_rent",
        "completed",
        "cancelled",
      ],
      default: "reserved",
    },

    // Cancellation
    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: "",
    },

    // Instructions
    specialInstructions: {
      type: String,
      trim: true,
      default: "",
    },

    // Terms & Conditions
    termsAndConditions: {
      type: [String],
      default: [],
    },

    // Booking Activity History
    history: {
      type: [
        {
          text: {
            type: String,
            required: true,
          },

          at: {
            type: Date,
            default: Date.now,
          },

          by: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// DATABASE INDEXES
// ======================================================

bookingSchema.index(
  { businessId: 1, bookingNumber: 1 },
  { unique: true }
);

bookingSchema.index(
  { businessId: 1, invoiceNumber: 1 },
  { unique: true }
);

bookingSchema.index({
  businessId: 1,
  carId: 1,
  pickupDate: 1,
  returnDate: 1,
  status: 1,
});

bookingSchema.index({
  businessId: 1,
  customerId: 1,
  createdAt: -1,
});

bookingSchema.index({
  businessId: 1,
  employeeId: 1,
  status: 1,
});

bookingSchema.index({
  businessId: 1,
  driverId: 1,
  status: 1,
  pickupDate: 1,
  returnDate: 1,
});

// ======================================================
// EXPORT
// ======================================================

export default mongoose.models.Booking ||
  mongoose.model("Booking", bookingSchema);
