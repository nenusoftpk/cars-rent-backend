import mongoose from "mongoose";
const { Schema } = mongoose;
const subscriptionSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, unique: true },
  plan: { type: String, enum: ["trial", "monthly", "yearly", "lifetime"], default: "trial", required: true },
  status: { type: String, enum: ["trialing", "active", "expired", "suspended"], default: "trialing" },
  paymentStatus: { type: String, enum: ["paid", "unpaid"], default: "unpaid" },
  startDate: { type: Date, required: true, default: Date.now },
  endDate: { type: Date, default: function () { return this.plan === "trial" ? new Date(this.startDate.getTime() + 3 * 86400000) : null; } },
  trialDays: { type: Number, min: 0, default: 3 },
  trialExtensionDays: { type: Number, min: 0, default: 0 },
  activatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, trim: true, default: "" },
}, { timestamps: true });
subscriptionSchema.pre("validate", function () {
  if (this.plan === "lifetime") this.endDate = null;
  if (this.plan !== "lifetime" && !this.endDate) this.invalidate("endDate", "End date is required for expiring plans");
  if (this.endDate && this.startDate && this.endDate <= this.startDate) this.invalidate("endDate", "End date must be after start date");
});
export default mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema);
