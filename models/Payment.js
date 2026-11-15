import mongoose from "mongoose";
const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
      immutable: true,
    },

    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      immutable: true,
    },

    paymentNumber: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
      immutable: true,
    },

    method: {
      type: String,
      enum: ["cash", "bank", "jazzcash", "easypaisa", "card", "other"],
      required: true,
      immutable: true,
    },

    type: {
      type: String,
      enum: [
        "advance",
        "rental",
        "final",
        "refund",
        "security_deposit",
        "security_refund",
      ],
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      enum: ["completed", "void"],
      default: "completed",
    },

    // Kept for historical records. New payments do not require it.
    transactionReference: {
      type: String,
      trim: true,
      default: "",
      immutable: true,
    },

    paymentDate: {
      type: Date,
      default: Date.now,
      immutable: true,
    },

    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    originalPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
      immutable: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
      immutable: true,
    },

    // --------------------------------------------------
    // Payment proof (Cloudinary)
    // Set only by the server after a successful upload.
    // Never accept these values from the client body.
    // --------------------------------------------------
    paymentProof: {
      type: String,
      default: "",
      immutable: true,
    },

    paymentProofPublicId: {
      type: String,
      default: "",
      select: false,
      immutable: true,
    },

    voidReason: {
      type: String,
      trim: true,
      default: "",
    },

    voidedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    voidedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// INDEXES (unchanged)
// ======================================================

paymentSchema.index({ businessId: 1, paymentNumber: 1 }, { unique: true });
paymentSchema.index({ businessId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ businessId: 1, bookingId: 1, paymentDate: -1 });
paymentSchema.index({ businessId: 1, type: 1, status: 1, paymentDate: -1 });
paymentSchema.index({ businessId: 1, originalPaymentId: 1 });

export default mongoose.models.Payment ||
  mongoose.model("Payment", paymentSchema);