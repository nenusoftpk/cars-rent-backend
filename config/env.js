
import dotenv from "dotenv";

dotenv.config();

const requiredVariables = [
  "MONGODB_URI",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]?.trim()) {
    console.error(
      `[ENV ERROR] ${variable} is missing from your .env file.`
    );

    process.exit(1);
  }
}

const NODE_ENV = process.env.NODE_ENV || "development";

if (!["development", "production", "test"].includes(NODE_ENV)) {
  console.error(
    "[ENV ERROR] NODE_ENV must be development, production, or test."
  );

  process.exit(1);
}

const PORT = Number(process.env.PORT || 8000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(
    "[ENV ERROR] PORT must be a number between 1 and 65535."
  );

  process.exit(1);
}

if (
  !process.env.MONGODB_URI.startsWith("mongodb://") &&
  !process.env.MONGODB_URI.startsWith("mongodb+srv://")
) {
  console.error(
    "[ENV ERROR] MONGODB_URI must be a valid MongoDB connection string."
  );

  process.exit(1);
}

process.env.NODE_ENV = NODE_ENV;
process.env.PORT = String(PORT);

console.log("[ENV] Environment configuration loaded successfully.");
console.log(`[ENV] Running in ${NODE_ENV} mode.`);
