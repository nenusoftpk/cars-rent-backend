import mongoose from "mongoose";
const { Schema } = mongoose;
const settingSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, unique: true },
  invoicePrefix: { type: String, trim: true, default: "INV" },
  bookingPrefix: { type: String, trim: true, default: "BK" },
  paymentPrefix: { type: String, trim: true, default: "PAY" },
  customerPrefix: { type: String, trim: true, default: "CUS" },
  receiptHeader: { type: String, trim: true, default: "" },
  receiptFooter: { type: String, trim: true, default: "Thank you for choosing us" },
  receiptLogo: { type: String, default: "" },
  receiptPaperSize: { type: String, enum: ["a4", "a5", "80mm", "58mm"], default: "a4" },
  defaultCurrency: { type: String, trim: true, default: "PKR" },
  timezone: { type: String, trim: true, default: "Asia/Karachi" },
  dateFormat: { type: String, enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"], default: "DD/MM/YYYY" },
  reminderDaysBefore: { type: Number, min: 0, max: 365, default: 7 },
  // Terms & Conditions
  termsAndConditions: {
    type: [String],
    default: [],
  },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
export default mongoose.models.Setting || mongoose.model("Setting", settingSchema);
