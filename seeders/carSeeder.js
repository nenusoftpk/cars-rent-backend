
import "dotenv/config";
import mongoose from "mongoose";
import Car from "../models/Car.js";

// ======================================================
// CONFIGURATION
// ======================================================

// Add these in your .env file
const MONGO_URI = process.env.MONGODB_URI;
const BUSINESS_ID = process.env.SEED_BUSINESS_ID;
const USER_ID = process.env.SEED_USER_ID;

// Number of cars to create
const TOTAL_CARS = Number(process.env.SEED_CAR_COUNT || 100);

// ======================================================
// CAR DATA
// ======================================================

const carModels = [
  {
    brand: "Toyota",
    model: "Corolla GLI",
    dailyRent: 6500,
  },
  {
    brand: "Toyota",
    model: "Corolla Altis",
    dailyRent: 8000,
  },
  {
    brand: "Toyota",
    model: "Yaris",
    dailyRent: 6000,
  },
  {
    brand: "Toyota",
    model: "Fortuner",
    dailyRent: 25000,
  },
  {
    brand: "Toyota",
    model: "Hilux Revo",
    dailyRent: 22000,
  },
  {
    brand: "Honda",
    model: "Civic",
    dailyRent: 10000,
  },
  {
    brand: "Honda",
    model: "City",
    dailyRent: 6500,
  },
  {
    brand: "Honda",
    model: "BR-V",
    dailyRent: 11000,
  },
  {
    brand: "Suzuki",
    model: "Alto",
    dailyRent: 3500,
  },
  {
    brand: "Suzuki",
    model: "Cultus",
    dailyRent: 4500,
  },
  {
    brand: "Suzuki",
    model: "Wagon R",
    dailyRent: 4000,
  },
  {
    brand: "Suzuki",
    model: "Swift",
    dailyRent: 5500,
  },
  {
    brand: "Kia",
    model: "Sportage",
    dailyRent: 15000,
  },
  {
    brand: "Kia",
    model: "Picanto",
    dailyRent: 4500,
  },
  {
    brand: "Hyundai",
    model: "Tucson",
    dailyRent: 16000,
  },
  {
    brand: "Hyundai",
    model: "Elantra",
    dailyRent: 11000,
  },
  {
    brand: "MG",
    model: "HS",
    dailyRent: 16000,
  },
  {
    brand: "Changan",
    model: "Alsvin",
    dailyRent: 6000,
  },
  {
    brand: "Changan",
    model: "Oshan X7",
    dailyRent: 16000,
  },
  {
    brand: "Haval",
    model: "H6",
    dailyRent: 20000,
  },
];

const colors = [
  "White",
  "Black",
  "Silver",
  "Grey",
  "Blue",
  "Red",
];

const statuses = [
  "available",
  "maintenance",
  "out_of_service",
];

const numberPlatePrefixes = [
  "LEA",
  "LEB",
  "LEC",
  "LED",
  "LHR",
  "ISB",
  "RIL",
];

// ======================================================
// HELPERS
// ======================================================

const randomItem = (items) => {
  return items[Math.floor(Math.random() * items.length)];
};

const randomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const futureDate = (months) => {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date;
};

// ======================================================
// GENERATE CAR
// ======================================================

const generateCar = (index, batchId) => {
  const selectedCar = randomItem(carModels);

  const year = randomNumber(2018, 2026);

  const dailyRent =
    selectedCar.dailyRent + randomNumber(0, 4) * 500;

  const hourlyRent = Math.round(dailyRent / 6);

  // Unique across repeated seeder runs
  const uniqueCode = `${batchId}${String(index).padStart(5, "0")}`;

  const numberPlate =
    `${randomItem(numberPlatePrefixes)}-${uniqueCode}`;

  const transmission =
    ["Fortuner", "Civic", "Sportage", "Tucson", "H6"].some(
      (name) => selectedCar.model.includes(name)
    )
      ? "automatic"
      : randomItem(["manual", "automatic"]);

  return {
    businessId: BUSINESS_ID,

    name: `${selectedCar.brand} ${selectedCar.model} ${year}`,

    brand: selectedCar.brand,

    model: selectedCar.model,

    year,

    numberPlate,

    chassisNumber: `CHS-${uniqueCode}`,

    engineNumber: `ENG-${uniqueCode}`,

    color: randomItem(colors),

    fuelType: randomItem([
      "petrol",
      "petrol",
      "petrol",
      "hybrid",
      "diesel",
    ]),

    transmission,

    seatingCapacity:
      ["Fortuner", "BR-V", "Oshan X7"].some(
        (name) => selectedCar.model.includes(name)
      )
        ? 7
        : 5,

    dailyRent,

    hourlyRent,

    images: [],

    registrationDocument: "",

    insuranceDocument: "",

    tokenTaxDocument: "",

    registrationExpiry: futureDate(randomNumber(6, 36)),

    insuranceExpiry: futureDate(randomNumber(2, 18)),

    tokenTaxExpiry: futureDate(randomNumber(1, 12)),

    odometer: randomNumber(5000, 120000),

    status: randomItem(statuses),

    createdBy: USER_ID,
  };
};

// ======================================================
// MAIN SEEDER
// ======================================================

const seedCars = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is missing in .env");
    }

    if (
      !mongoose.isValidObjectId(BUSINESS_ID) ||
      !mongoose.isValidObjectId(USER_ID)
    ) {
      throw new Error(
        "Please provide valid SEED_BUSINESS_ID and SEED_USER_ID in .env"
      );
    }

    if (
      !Number.isInteger(TOTAL_CARS) ||
      TOTAL_CARS < 1 ||
      TOTAL_CARS > 10000
    ) {
      throw new Error(
        "SEED_CAR_COUNT must be between 1 and 10000."
      );
    }

    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected successfully.");

    // Confirm the business and user actually exist
    const Business = (await import("../models/Business.js")).default;
    const User = (await import("../models/User.js")).default;

    const [business, user] = await Promise.all([
      Business.findById(BUSINESS_ID),
      User.findById(USER_ID),
    ]);

    if (!business) {
      throw new Error("Business not found.");
    }

    if (!user) {
      throw new Error("User not found.");
    }

    if (String(user.businessId) !== String(BUSINESS_ID)) {
      throw new Error(
        "Selected user does not belong to the selected business."
      );
    }

    if (!["admin", "employee"].includes(user.role)) {
      throw new Error(
        "Seeder user must be a business admin or employee."
      );
    }

    console.log(`Business: ${business.businessName}`);
    console.log(`Creating ${TOTAL_CARS} test cars...`);

    // A new batch identifier prevents number-plate duplicates
    // between separate seeder runs.
    const batchId =
      `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const cars = [];

    for (let i = 1; i <= TOTAL_CARS; i++) {
      cars.push(generateCar(i, batchId));
    }

    const result = await Car.insertMany(cars, {
      ordered: true,
    });

    console.log("----------------------------------");
    console.log("Car seeding completed successfully.");
    console.log(`Inserted cars: ${result.length}`);
    console.log(`Business: ${business.businessName}`);
    console.log("----------------------------------");
  } catch (error) {
    console.error("Car seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedCars();
