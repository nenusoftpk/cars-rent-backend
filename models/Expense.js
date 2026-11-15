import mongoose from "mongoose";

const { Schema } = mongoose;

export const EXPENSE_CATEGORIES = [
  "fuel", "repair", "service", "oil_change", "tyres", "brakes", "inspection",
  "salary", "driver_payment", "insurance", "tax", "insurance_tax",
  "rent", "utilities", "office_expense", "other",
];

const expenseSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, immutable: true, index: true },
  carId: { type: Schema.Types.ObjectId, ref: "Car", default: null },
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
  driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  paidTo: { type: String, trim: true, default: "", maxlength: 200 },
  paymentMethod: { type: String, enum: ["cash", "bank", "jazzcash", "easypaisa", "card", "other"], default: "cash" },
  expenseDate: { type: Date, default: Date.now },
  receiptImage: { type: String, default: "" },
  description: { type: String, trim: true, default: "", maxlength: 1500 },
  workshopName: { type: String, trim: true, default: "", maxlength: 200 },
  odometer: { type: Number, min: 0, default: null },
  nextServiceDate: { type: Date, default: null },
  nextServiceOdometer: { type: Number, min: 0, default: null },
  nextOilChangeDate: { type: Date, default: null },
  nextOilChangeOdometer: { type: Number, min: 0, default: null },
  idempotencyKey: { type: String, trim: true, maxlength: 120, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true, optimisticConcurrency: true });

expenseSchema.index({ businessId: 1, expenseDate: -1, category: 1 });
expenseSchema.index({ businessId: 1, carId: 1, expenseDate: -1 });
expenseSchema.index({ businessId: 1, bookingId: 1, expenseDate: -1 });
expenseSchema.index({ businessId: 1, driverId: 1, category: 1, expenseDate: -1 });
expenseSchema.index({ businessId: 1, createdBy: 1, expenseDate: -1 });
expenseSchema.index({ businessId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });

export default mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
