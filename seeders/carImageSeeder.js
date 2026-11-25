import "dotenv/config";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Car from "../models/Car.js";

// ======================================================
// CONFIGURATION
// ======================================================

const MONGODB_URI = process.env.MONGODB_URI;
const BUSINESS_ID = process.env.SEED_BUSINESS_ID;

// By default, only cars without images are updated.
const REPLACE_IMAGES =
  process.env.SEED_REPLACE_CAR_IMAGES === "true";

// ======================================================
// IMAGE FOLDER
// ======================================================

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const IMAGES_FOLDER = path.join(
  __dirname,
  "images"
);

// ======================================================
// CLOUDINARY CONFIGURATION
// ======================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ======================================================
// SUPPORTED IMAGE EXTENSIONS
// ======================================================

const supportedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
];

// ======================================================
// CAR IMAGE MAPPING
// ======================================================

const carImageMap = {
  "toyota corolla gli": "toyota-corolla-gli",

  "toyota corolla altis": "toyota-corolla-altis",

  "toyota yaris": "toyota-yaris",

  "toyota fortuner": "toyota-fortuner",

  "toyota hilux revo": "toyota-hilux-revo",

  "honda civic": "honda-civic",

  "honda city": "honda-city",

  "honda br-v": "honda-br-v",

  "suzuki alto": "suzuki-alto",

  "suzuki cultus": "suzuki-cultus",

  "suzuki wagon r": "suzuki-wagon-r",

  "suzuki swift": "suzuki-swift",

  "kia sportage": "kia-sportage",

  "kia picanto": "kia-picanto",

  "hyundai tucson": "hyundai-tucson",

  "hyundai elantra": "hyundai-elantra",

  "mg hs": "mg-hs",

  "changan alsvin": "changan-alsvin",

  "changan oshan x7": "changan-oshan-x7",

  "haval h6": "haval-h6",
};

// ======================================================
// UPLOADED IMAGE CACHE
// ======================================================

const uploadedImages = new Map();

// ======================================================
// NORMALIZE TEXT
// ======================================================

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

// ======================================================
// GET CAR IMAGE KEY
// ======================================================

const getCarImageKey = (car) => {
  return normalizeText(
    `${car.brand} ${car.model}`
  );
};

// ======================================================
// FIND LOCAL IMAGE FILE
// ======================================================

const findImageFile = (imageName) => {
  for (const extension of supportedExtensions) {
    const filename = `${imageName}${extension}`;

    const imagePath = path.join(
      IMAGES_FOLDER,
      filename
    );

    if (fs.existsSync(imagePath)) {
      return imagePath;
    }
  }

  return null;
};

// ======================================================
// CHECK EXISTING CLOUDINARY IMAGE
// ======================================================

const getExistingCloudinaryImage = async (
  publicId
) => {
  try {
    const resource = await cloudinary.api.resource(
      publicId,
      {
        resource_type: "image",
        type: "upload",
      }
    );

    return resource.secure_url || null;

  } catch (error) {
    // Image does not exist.
    if (
      error.http_code === 404 ||
      error.error?.http_code === 404
    ) {
      return null;
    }

    // Do not ignore authentication or network errors.
    throw error;
  }
};

// ======================================================
// UPLOAD OR REUSE CAR IMAGE
// ======================================================

const uploadCarImage = async (imageName) => {
  // Reuse image already processed in this seeder run.
  if (uploadedImages.has(imageName)) {
    return uploadedImages.get(imageName);
  }

  const publicId =
    `rent-a-car/seed-cars/${BUSINESS_ID}/${imageName}`;

  // Reuse existing Cloudinary image from previous runs.
  const existingImage =
    await getExistingCloudinaryImage(publicId);

  if (existingImage) {
    uploadedImages.set(
      imageName,
      existingImage
    );

    console.log(
      `[REUSED] ${imageName}`
    );

    return existingImage;
  }

  // Find the actual local image.
  const imagePath = findImageFile(imageName);

  if (!imagePath) {
    console.warn(
      `[MISSING IMAGE] ${imageName}`
    );

    return null;
  }

  // Upload and optimize image.
  const result = await cloudinary.uploader.upload(
    imagePath,
    {
      public_id: publicId,

      resource_type: "image",

      overwrite: false,

      transformation: [
        {
          width: 1000,
          height: 750,
          crop: "limit",
          quality: "auto:good",
        },
      ],

      format: "webp",

      tags: [
        "rent-a-car",
        "seed-car",
        `business-${BUSINESS_ID}`,
      ],
    }
  );

  if (!result.secure_url) {
    throw new Error(
      `Image upload failed: ${imageName}`
    );
  }

  uploadedImages.set(
    imageName,
    result.secure_url
  );

  console.log(
    `[UPLOADED] ${imageName}`
  );

  return result.secure_url;
};

// ======================================================
// MAIN SEEDER
// ======================================================

const seedCarImages = async () => {
  try {
    console.log("==================================");
    console.log("RENT A CAR - CAR IMAGE SEEDER");
    console.log("==================================");

    // Validate MongoDB configuration.
    if (!MONGODB_URI) {
      throw new Error(
        "MONGODB_URI is missing in .env"
      );
    }

    // Validate business ID.
    if (!mongoose.isValidObjectId(BUSINESS_ID)) {
      throw new Error(
        "Invalid SEED_BUSINESS_ID in .env"
      );
    }

    // Validate Cloudinary configuration.
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error(
        "Cloudinary credentials are missing in .env"
      );
    }

    // Validate image folder.
    if (!fs.existsSync(IMAGES_FOLDER)) {
      throw new Error(
        `Images folder not found: ${IMAGES_FOLDER}`
      );
    }

    // Connect MongoDB.
    await mongoose.connect(MONGODB_URI);

    console.log(
      "MongoDB connected successfully."
    );

    // Verify business.
    const Business = (
      await import("../models/Business.js")
    ).default;

    const business = await Business.findById(
      BUSINESS_ID
    );

    if (!business) {
      throw new Error("Business not found.");
    }

    console.log(
      `Business: ${business.businessName}`
    );

    // Build car filter.
    const filter = {
      businessId: BUSINESS_ID,
    };

    if (REPLACE_IMAGES) {
      // Only replace images on cars with demo identifiers
      // generated by the supplied car seeder.
      filter.chassisNumber = /^CHS-\d+$/;
      filter.engineNumber = /^ENG-\d+$/;

    } else {
      // Only cars without existing images.
      filter["images.0"] = {
        $exists: false,
      };
    }

    // Get cars.
    const cars = await Car.find(filter)
      .select("_id name brand model numberPlate")
      .lean();

    console.log(
      `Cars found: ${cars.length}`
    );

    console.log(
      `Replace existing demo images: ${REPLACE_IMAGES}`
    );

    if (cars.length === 0) {
      console.log(
        "No cars found for image seeding."
      );

      return;
    }

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;

    const missingImages = new Set();

    // Process each car.
    for (const car of cars) {
      try {
        const carKey = getCarImageKey(car);

        const imageName = carImageMap[carKey];

        // Skip unsupported car models.
        if (!imageName) {
          skipped++;

          console.warn(
            `[SKIPPED] No image mapping for ${car.name}`
          );

          continue;
        }

        // Avoid repeated attempts for missing files.
        if (missingImages.has(imageName)) {
          skipped++;
          continue;
        }

        // Upload or reuse matching image.
        const imageUrl = await uploadCarImage(
          imageName
        );

        if (!imageUrl) {
          skipped++;

          missingImages.add(imageName);

          continue;
        }

        // Secure update filter.
        const updateFilter = {
          ...filter,
          _id: car._id,
        };

        // Update car images.
        const result = await Car.updateOne(
          updateFilter,
          {
            $set: {
              images: [imageUrl],
            },
          },
          {
            runValidators: true,
          }
        );

        if (result.modifiedCount > 0) {
          updated++;

          console.log(
            `[${updated}] ${car.name} | ${car.numberPlate} | Image added`
          );

        } else if (result.matchedCount > 0) {
          unchanged++;

        } else {
          skipped++;
        }

      } catch (error) {
        failed++;

        console.error(
          `[FAILED] ${car.brand} ${car.model} ${car.year}:`,
          error?.error?.message ||
          error?.message ||
          error?.cause?.message ||
          "Unknown error"
        );
      }
    }

    // Final report.
    console.log("==================================");
    console.log("CAR IMAGE SEEDING COMPLETED");
    console.log("==================================");

    console.log(
      `Business: ${business.businessName}`
    );

    console.log(
      `Total cars found: ${cars.length}`
    );

    console.log(
      `Cars updated: ${updated}`
    );

    console.log(
      `Cars unchanged: ${unchanged}`
    );

    console.log(
      `Cars skipped: ${skipped}`
    );

    console.log(
      `Cars failed: ${failed}`
    );

    console.log(
      `Unique images uploaded/reused: ${uploadedImages.size}`
    );

    if (missingImages.size > 0) {
      console.log("----------------------------------");
      console.log("MISSING IMAGE FILES:");

      for (const imageName of missingImages) {
        console.log(`- ${imageName}`);
      }
    }

    console.log("==================================");

    if (failed > 0 || skipped > 0) {
      process.exitCode = 1;
    }

  } catch (error) {
    console.error(
      "Car image seeding failed:",
      error.message
    );

    process.exitCode = 1;

  } finally {
    await mongoose.disconnect();

    console.log("MongoDB disconnected.");
  }
};

seedCarImages();