
import mongoose from "mongoose";

const { Schema } = mongoose;

const carSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
      immutable: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    brand: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    model: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    year: {
      type: Number,
      required: true,
      min: 1900,
      max: 2200,
    },

    numberPlate: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },

    chassisNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: "",
    },

    engineNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: "",
    },

    color: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "White",
    },

    fuelType: {
      type: String,
      enum: [
        "petrol",
        "diesel",
        "hybrid",
        "electric",
        "cng",
        "other",
      ],
      default: "petrol",
    },

    transmission: {
      type: String,
      enum: ["manual", "automatic", "other"],
      default: "manual",
    },

    seatingCapacity: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },

    dailyRent: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    hourlyRent: {
      type: Number,
      min: 0,
      default: 0,
    },

images: {
  type: [String],
  default: [],
  validate: {
    validator: (value) =>
      Array.isArray(value) &&
      value.length <= 5 &&
      value.every(
        (url) =>
          typeof url === "string" &&
          url.length <= 2048
      ),
    message: "A car can have a maximum of 5 valid images.",
  },
},

    registrationDocument: {
      type: String,
      trim: true,
      default: "",
    },

    insuranceDocument: {
      type: String,
      trim: true,
      default: "",
    },

    tokenTaxDocument: {
      type: String,
      trim: true,
      default: "",
    },

    registrationExpiry: {
      type: Date,
      default: null,
    },

    insuranceExpiry: {
      type: Date,
      default: null,
    },

    tokenTaxExpiry: {
      type: Date,
      default: null,
    },

    odometer: {
      type: Number,
      min: 0,
      default: 0,
    },

    nextServiceDate: {
      type: Date,
      default: null,
    },

    nextOilChangeDate: {
      type: Date,
      default: null,
    },

    nextServiceOdometer: {
      type: Number,
      min: 0,
      default: null,
    },

    nextOilChangeOdometer: {
      type: Number,
      min: 0,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "available",
        "booked",
        "on_rent",
        "maintenance",
        "out_of_service",
      ],
      default: "available",
      index: true,
    },

    statusReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    expectedRepairCompletionDate: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true },
  }
);

carSchema.index(
  { businessId: 1, numberPlate: 1 },
  { unique: true }
);

carSchema.index({
  businessId: 1,
  status: 1,
  createdAt: -1,
});

carSchema.index({ businessId: 1, brand: 1 });
carSchema.index({ businessId: 1, createdBy: 1 });
carSchema.index({ businessId: 1, insuranceExpiry: 1 });
carSchema.index({ businessId: 1, tokenTaxExpiry: 1 });
carSchema.index({ businessId: 1, registrationExpiry: 1 });
carSchema.index({ businessId: 1, nextServiceDate: 1 });
carSchema.index({ businessId: 1, nextOilChangeDate: 1 });

carSchema.virtual("id").get(function () {
  return this._id?.toString();
});

carSchema.virtual("plate").get(function () {
  return this.numberPlate;
});

carSchema.virtual("fuel").get(function () {
  return this.fuelType;
});

carSchema.virtual("seats").get(function () {
  return this.seatingCapacity;
});

carSchema.virtual("dailyRate").get(function () {
  return this.dailyRent;
});

carSchema.virtual("hourlyRate").get(function () {
  return this.hourlyRent;
});

carSchema.virtual("image").get(function () {
  return this.images?.[0] || "";
});

carSchema.virtual("registrationDoc").get(function () {
  return this.registrationDocument;
});

carSchema.virtual("insuranceDoc").get(function () {
  return this.insuranceDocument;
});

carSchema.virtual("tokenExpiry").get(function () {
  return this.tokenTaxExpiry;
});

export default mongoose.models.Car ||
  mongoose.model("Car", carSchema);
