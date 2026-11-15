
import Joi from "joi";

const requiredText = (label, max = 150) =>
  Joi.string()
    .trim()
    .min(2)
    .max(max)
    .messages({
      "string.base": `${label} must be text.`,
      "string.empty": `${label} is required.`,
      "string.min": `${label} must contain at least 2 characters.`,
      "string.max": `${label} cannot exceed ${max} characters.`,
      "any.required": `${label} is required.`,
    });

const optionalText = (label, max = 200) =>
  Joi.string()
    .trim()
    .max(max)
    .allow("", null)
    .messages({
      "string.base": `${label} must be text.`,
      "string.max": `${label} cannot exceed ${max} characters.`,
    });

const nonNegativeNumber = (label) =>
  Joi.number()
    .min(0)
    .messages({
      "number.base": `${label} must be a valid number.`,
      "number.min": `${label} cannot be negative.`,
    });

const optionalDate = (label) =>
  Joi.date()
    .iso()
    .allow(null, "")
    .messages({
      "date.base": `${label} must be a valid date.`,
      "date.format": `${label} must be a valid ISO date.`,
    });

const documentUrl = (label) =>
  Joi.string()
    .trim()
    .max(2048)
    .uri({ scheme: ["https"] })
    .allow("", null)
    .messages({
      "string.uri": `${label} must be a valid HTTPS URL.`,
      "string.max": `${label} URL is too long.`,
    });

const carFields = {
  name: requiredText("Car name", 150),

  brand: requiredText("Car brand", 100),

  model: requiredText("Car model", 100),

  year: Joi.number()
    .integer()
    .min(1900)
    .max(2200)
    .messages({
      "number.base": "Model year must be a valid number.",
      "number.integer": "Model year must be a whole number.",
      "number.min": "Model year cannot be earlier than 1900.",
      "number.max": "Please enter a valid model year.",
    }),

  numberPlate: Joi.string()
    .trim()
    .uppercase()
    .min(2)
    .max(50)
    .messages({
      "string.empty": "Number plate is required.",
      "string.min": "Please enter a valid number plate.",
      "string.max": "Number plate cannot exceed 50 characters.",
      "any.required": "Number plate is required.",
    }),

  chassisNumber: optionalText("Chassis number", 100),

  engineNumber: optionalText("Engine number", 100),

  color: optionalText("Car color", 50),

  fuelType: Joi.string()
    .valid(
      "petrol",
      "diesel",
      "hybrid",
      "electric",
      "cng",
      "other"
    )
    .messages({
      "any.only": "Please select a valid fuel type.",
    }),

  transmission: Joi.string()
    .valid("manual", "automatic", "other")
    .messages({
      "any.only": "Please select a valid transmission type.",
    }),

  seatingCapacity: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .messages({
      "number.base": "Seating capacity must be a number.",
      "number.integer": "Seating capacity must be a whole number.",
      "number.min": "Seating capacity must be at least 1.",
      "number.max": "Seating capacity cannot exceed 100.",
    }),

  dailyRent: nonNegativeNumber("Daily rent"),

  hourlyRent: nonNegativeNumber("Hourly rent"),

  registrationDocument: documentUrl("Registration document"),

  insuranceDocument: documentUrl("Insurance document"),

  tokenTaxDocument: documentUrl("Token tax document"),

  registrationExpiry: optionalDate("Registration expiry date"),

  insuranceExpiry: optionalDate("Insurance expiry date"),

  tokenTaxExpiry: optionalDate("Token tax expiry date"),

  odometer: nonNegativeNumber("Odometer"),

  nextServiceDate: optionalDate("Next service date"),

  nextOilChangeDate: optionalDate("Next oil change date"),

  nextServiceOdometer: nonNegativeNumber(
    "Next service odometer"
  ).allow(null, ""),

  nextOilChangeOdometer: nonNegativeNumber(
    "Next oil change odometer"
  ).allow(null, ""),

  statusReason: optionalText("Status reason", 500),

  expectedRepairCompletionDate: optionalDate(
    "Expected repair completion date"
  ),

  notes: optionalText("Notes", 2000),
};

export const createCarSchema = Joi.object({
  ...carFields,

  name: carFields.name.required(),
  brand: carFields.brand.required(),
  model: carFields.model.required(),
  year: carFields.year.required(),
  numberPlate: carFields.numberPlate.required(),
  seatingCapacity: carFields.seatingCapacity.required(),
  dailyRent: carFields.dailyRent.required(),

  // Allow status ONLY on create
  status: Joi.string()
    .trim()
    .lowercase()
    .valid("available", "maintenance", "out_of_service")
    .default("available")
    .messages({
      "any.only":
        "New cars can only be Available, Under Repair or Out of Service.",
    }),
})
  .unknown(false)
  .messages({
    "object.unknown": "One or more car fields are not allowed.",
  });

export const updateCarSchema = Joi.object({
  ...carFields,
})
  .min(1)
  .unknown(false)
  .messages({
    "object.min": "Please provide information to update.",
    "object.unknown": "This car field cannot be updated here.",
  });

export const updateCarStatusSchema = Joi.object({
  status: Joi.string()
    .trim()
    .lowercase()
    .valid(
      "available",
      "maintenance",
      "out_of_service"
    )
    .required()
    .messages({
      "any.required": "Please select a car status.",
      "any.only":
        "Please select Available, Under Repair or Out of Service.",
    }),

  statusReason: Joi.when("status", {
    is: Joi.valid("maintenance", "out_of_service"),
    then: Joi.string()
      .trim()
      .min(3)
      .max(500)
      .required()
      .messages({
        "any.required":
          "Please provide a reason for making this car unavailable.",
        "string.empty":
          "Please provide a reason for making this car unavailable.",
        "string.min":
          "Status reason must contain at least 3 characters.",
        "string.max":
          "Status reason cannot exceed 500 characters.",
      }),
    otherwise: optionalText("Status reason", 500),
  }),

  expectedRepairCompletionDate: optionalDate(
    "Expected repair completion date"
  ),
})
  .unknown(false);

export const removeCarImageSchema = Joi.object({
  url: Joi.string()
    .trim()
    .uri({ scheme: ["https"] })
    .required()
    .messages({
      "string.empty": "Please select an image to remove.",
      "string.uri": "Please provide a valid image URL.",
      "any.required": "Image URL is required.",
    }),
})
  .unknown(false);

export const carAvailabilitySchema = Joi.object({
  pickupDate: Joi.date()
    .iso()
    .required()
    .messages({
      "any.required": "Pickup date is required.",
      "date.base": "Please enter a valid pickup date.",
    }),

  returnDate: Joi.date()
    .iso()
    .greater(Joi.ref("pickupDate"))
    .required()
    .messages({
      "any.required": "Return date is required.",
      "date.base": "Please enter a valid return date.",
      "date.greater":
        "Return date must be after pickup date.",
    }),
})
  .unknown(false);
