import "dotenv/config";
import mongoose from "mongoose";
import Car from "../models/Car.js";

// ======================================================
// CONFIGURATION
// ======================================================

const MONGODB_URI = process.env.MONGODB_URI;
const BUSINESS_ID = process.env.SEED_BUSINESS_ID;
const USER_ID = process.env.SEED_USER_ID;

const TOTAL_CARS = Number(
  process.env.SEED_CAR_COUNT || 100
);

// ======================================================
// CAR DATA
// ======================================================

const carModels = [
  {
    brand: "Toyota",
    model: "Corolla GLI",
    dailyRent: 6500,
    minYear: 2018,
    maxYear: 2019,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Toyota",
    model: "Corolla Altis",
    dailyRent: 8000,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Toyota",
    model: "Yaris",
    dailyRent: 6000,
    minYear: 2020,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Toyota",
    model: "Fortuner",
    dailyRent: 25000,
    minYear: 2018,
    fuelType: "diesel",
    transmissions: ["automatic"],
    seatingCapacity: 7,
  },
  {
    brand: "Toyota",
    model: "Hilux Revo",
    dailyRent: 22000,
    minYear: 2018,
    fuelType: "diesel",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Honda",
    model: "Civic",
    dailyRent: 10000,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Honda",
    model: "City",
    dailyRent: 6500,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Honda",
    model: "BR-V",
    dailyRent: 11000,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 7,
  },
  {
    brand: "Suzuki",
    model: "Alto",
    dailyRent: 3500,
    minYear: 2019,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 4,
  },
  {
    brand: "Suzuki",
    model: "Cultus",
    dailyRent: 4500,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Suzuki",
    model: "Wagon R",
    dailyRent: 4000,
    minYear: 2018,
    maxYear: 2025,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Suzuki",
    model: "Swift",
    dailyRent: 5500,
    minYear: 2018,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Kia",
    model: "Sportage",
    dailyRent: 15000,
    minYear: 2019,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Kia",
    model: "Picanto",
    dailyRent: 4500,
    minYear: 2019,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Hyundai",
    model: "Tucson",
    dailyRent: 16000,
    minYear: 2020,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Hyundai",
    model: "Elantra",
    dailyRent: 11000,
    minYear: 2021,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "MG",
    model: "HS",
    dailyRent: 16000,
    minYear: 2020,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Changan",
    model: "Alsvin",
    dailyRent: 6000,
    minYear: 2021,
    fuelType: "petrol",
    transmissions: ["manual", "automatic"],
    seatingCapacity: 5,
  },
  {
    brand: "Changan",
    model: "Oshan X7",
    dailyRent: 16000,
    minYear: 2022,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 7,
  },
  {
    brand: "Haval",
    model: "H6",
    dailyRent: 20000,
    minYear: 2021,
    fuelType: "petrol",
    transmissions: ["automatic"],
    seatingCapacity: 5,
  },
];

// ======================================================
// COLORS
// ======================================================

const colors = [
  "White",
  "Black",
  "Silver",
  "Grey",
  "Blue",
  "Red",
];

// ======================================================
// NUMBER PLATE CONFIGURATION
// ======================================================

const numberPlatePrefixes = [
  "LEA",
  "LEB",
  "LEC",
  "LED",
  "LEE",
  "LEF",
  "LEG",
  "LEH",
  "LEJ",
  "LEK",
  "LEL",
  "LEM",
  "LEN",
  "LEP",
  "LER",
  "LES",
  "LET",
  "LEU",
  "LEV",
  "LEW",
  "LEX",
  "LEY",
  "LEZ",
  "LHR",
  "ISB",
  "RIL",
];

const NUMBER_PLATE_REGEX = /^[A-Z]{3}-[0-9]{4}$/;

const usedNumberPlates = new Set();

// ======================================================
// HELPERS
// ======================================================

const randomItem = (items) => {
  return items[
    Math.floor(Math.random() * items.length)
  ];
};

const randomNumber = (min, max) => {
  return (
    Math.floor(Math.random() * (max - min + 1)) +
    min
  );
};

const futureDate = (months) => {
  const date = new Date();

  date.setMonth(date.getMonth() + months);

  return date;
};

// ======================================================
// SHUFFLE ARRAY
// ======================================================

const shuffleArray = (items) => {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i],
    ];
  }

  return result;
};

// ======================================================
// GENERATE UNIQUE NUMBER PLATE
// ======================================================

const generateNumberPlate = () => {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const prefix = randomItem(numberPlatePrefixes);

    const number = String(
      randomNumber(1000, 9999)
    );

    const numberPlate = `${prefix}-${number}`;

    if (
      NUMBER_PLATE_REGEX.test(numberPlate) &&
      !usedNumberPlates.has(numberPlate)
    ) {
      usedNumberPlates.add(numberPlate);

      return numberPlate;
    }
  }

  throw new Error(
    "Unable to generate a unique number plate."
  );
};

// ======================================================
// LOAD EXISTING NUMBER PLATES
// ======================================================

const loadExistingNumberPlates = async () => {
  const existingPlates = await Car.distinct(
    "numberPlate"
  );

  usedNumberPlates.clear();

  for (const plate of existingPlates) {
    if (plate) {
      usedNumberPlates.add(
        String(plate).trim().toUpperCase()
      );
    }
  }

  console.log(
    `Existing number plates loaded: ${usedNumberPlates.size}`
  );
};

// ======================================================
// GENERATE CAR STATUSES
// ======================================================

const generateStatuses = () => {
  const availableCount = Math.round(
    TOTAL_CARS * 0.9
  );

  const maintenanceCount =
    TOTAL_CARS - availableCount;

  return shuffleArray([
    ...Array(availableCount).fill("available"),
    ...Array(maintenanceCount).fill("maintenance"),
  ]);
};

// ======================================================
// GENERATE CAR
// ======================================================

const generateCar = (
  index,
  batchId,
  status,
  selectedCar
) => {
  const currentYear = new Date().getFullYear();

  const year = randomNumber(
    selectedCar.minYear,
    Math.min(
      selectedCar.maxYear || currentYear,
      currentYear
    )
  );

  const dailyRent =
    selectedCar.dailyRent +
    randomNumber(0, 4) * 500;

  const hourlyRent = Math.round(dailyRent / 6);

  const uniqueCode =
    `${batchId}${String(index).padStart(5, "0")}`;

  const numberPlate = generateNumberPlate();

  return {
    businessId: BUSINESS_ID,

    name:
      `${selectedCar.brand} ${selectedCar.model} ${year}`,

    brand: selectedCar.brand,

    model: selectedCar.model,

    year,

    numberPlate,

    chassisNumber: `CHS-${uniqueCode}`,

    engineNumber: `ENG-${uniqueCode}`,

    color: randomItem(colors),

    fuelType: selectedCar.fuelType,

    transmission: randomItem(
      selectedCar.transmissions
    ),

    seatingCapacity: selectedCar.seatingCapacity,

    dailyRent,

    hourlyRent,

    images: [],

    registrationDocument: "",

    insuranceDocument: "",

    tokenTaxDocument: "",

    registrationExpiry: futureDate(
      randomNumber(6, 36)
    ),

    insuranceExpiry: futureDate(
      randomNumber(2, 18)
    ),

    tokenTaxExpiry: futureDate(
      randomNumber(1, 12)
    ),

    odometer: randomNumber(5000, 120000),

    status,

    createdBy: USER_ID,
  };
};

// ======================================================
// MAIN SEEDER
// ======================================================

const seedCars = async () => {
  try {
    console.log("==================================");
    console.log("RENT A CAR - CAR SEEDER");
    console.log("==================================");

    if (!MONGODB_URI) {
      throw new Error(
        "MONGODB_URI is missing in .env"
      );
    }

    if (
      !mongoose.isValidObjectId(BUSINESS_ID) ||
      !mongoose.isValidObjectId(USER_ID)
    ) {
      throw new Error(
        "Please provide valid SEED_BUSINESS_ID and SEED_USER_ID."
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

    // Connect MongoDB
    await mongoose.connect(MONGODB_URI);

    console.log(
      "MongoDB connected successfully."
    );

    // Import required models
    const Business = (
      await import("../models/Business.js")
    ).default;

    const User = (
      await import("../models/User.js")
    ).default;

    // Verify business and user
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

    if (
      String(user.businessId) !==
      String(BUSINESS_ID)
    ) {
      throw new Error(
        "Selected user does not belong to the selected business."
      );
    }

    if (
      !["admin", "employee"].includes(user.role)
    ) {
      throw new Error(
        "Seeder user must be a business admin or employee."
      );
    }

    console.log(
      `Business: ${business.businessName}`
    );

    console.log(
      `Creating ${TOTAL_CARS} test cars...`
    );

    // Prevent duplicate number plates
    await loadExistingNumberPlates();

    // Unique batch for chassis and engine numbers
    const batchId =
      `${Date.now()}${randomNumber(100, 999)}`;

    // Prepare statuses
    const statuses = generateStatuses();

    const cars = [];

    // Distribute all car models evenly
    const shuffledModels = shuffleArray(carModels);

    for (let i = 0; i < TOTAL_CARS; i++) {
      const selectedCar =
        shuffledModels[i % shuffledModels.length];

      cars.push(
        generateCar(
          i + 1,
          batchId,
          statuses[i],
          selectedCar
        )
      );
    }

    // Insert cars into MongoDB
    const result = await Car.insertMany(cars, {
      ordered: true,
    });

    // Calculate inserted status counts
    const availableCount = result.filter(
      (car) => car.status === "available"
    ).length;

    const maintenanceCount = result.filter(
      (car) => car.status === "maintenance"
    ).length;

    console.log("==================================");
    console.log("CAR SEEDING COMPLETED");
    console.log("==================================");

    console.log(
      `Business: ${business.businessName}`
    );

    console.log(
      `Total cars inserted: ${result.length}`
    );

    console.log(
      `Available cars: ${availableCount}`
    );

    console.log(
      `Maintenance cars: ${maintenanceCount}`
    );

    console.log("Out of service cars: 0");

    console.log("==================================");

  } catch (error) {
    console.error(
      "Car seeding failed:",
      error.message
    );

    process.exitCode = 1;

  } finally {
    await mongoose.disconnect();

    console.log("MongoDB disconnected.");
  }
};

seedCars();