
import "dotenv/config";
import mongoose from "mongoose";
import Car from "../models/Car.js";

// ======================================================
// CONFIGURATION
// ======================================================

const MONGODB_URI = process.env.MONGODB_URI;
const BUSINESS_ID = process.env.SEED_BUSINESS_ID;

// Public sample car images from Unsplash.
// These are remote URLs, not Cloudinary uploads.
// Verify that the URLs work before using them.

const carImages = [
  "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=900",
  "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=900",
  "https://images.unsplash.com/photo-1507136566006-cfc505b114fc?w=900",
  "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=900",
  "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=900",
  "https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=900",
  "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=900",
  "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=900",
  "https://images.unsplash.com/photo-1600705722908-d9c27a1a4c4f?w=900",
  "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=900",
];

// ======================================================
// RANDOM IMAGE HELPER
// ======================================================

const randomImages = () => {
  // Give every car 1 to 3 random images.
  const shuffled = [...carImages].sort(
    () => Math.random() - 0.5
  );

  const count = Math.floor(Math.random() * 3) + 1;

  return shuffled.slice(0, count);
};

// ======================================================
// MAIN SEEDER
// ======================================================

const seedCarImages = async () => {
  try {
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    if (!mongoose.isValidObjectId(BUSINESS_ID)) {
      throw new Error("Invalid SEED_BUSINESS_ID in .env");
    }

    await mongoose.connect(MONGODB_URI);

    console.log("MongoDB connected successfully.");

    // Only find cars belonging to your business
    // that do not already have images.
    const cars = await Car.find({
      businessId: BUSINESS_ID,
      "images.0": { $exists: false },
    });

    console.log(`Found ${cars.length} cars without images.`);

    let updated = 0;

    for (const car of cars) {
      const images = randomImages();

      const result = await Car.updateOne(
        {
          _id: car._id,
          businessId: BUSINESS_ID,
          "images.0": { $exists: false },
        },
        {
          $set: { images },
        }
      );

      if (result.modifiedCount > 0) {
        updated++;
        console.log(
          `[${updated}] Images added to ${car.name}`
        );
      }
    }

    console.log("----------------------------------");
    console.log(`Cars updated: ${updated}`);
    console.log("----------------------------------");
  } catch (error) {
    console.error("Seeder failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedCarImages();
