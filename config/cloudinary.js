import { v2 as cloudinary } from "cloudinary";

const requiredEnv = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length) {
  throw new Error(
    `Missing Cloudinary variables: ${missingEnv.join(", ")}`
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

console.log("Cloudinary configuration:", {
  cloudName: cloudinary.config().cloud_name,
  apiKeyExists: Boolean(cloudinary.config().api_key),
  apiSecretExists: Boolean(cloudinary.config().api_secret),
  uploadPrefix: cloudinary.config().upload_prefix,
});

export default cloudinary;