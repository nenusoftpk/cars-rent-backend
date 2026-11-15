
import winston from "winston";
import fs from "node:fs";
import path from "node:path";

// ======================================================
// LOGGER CONFIGURATION
// ======================================================

const isProduction = process.env.NODE_ENV === "production";

const logDirectory = path.join(process.cwd(), "logs");

fs.mkdirSync(logDirectory, { recursive: true });

// ======================================================
// LOG FORMATS
// ======================================================

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss",
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const details = Object.keys(meta).length
      ? ` ${JSON.stringify(meta)}`
      : "";

    return `[${timestamp}] ${level}: ${message}${details}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ======================================================
// LOGGER
// ======================================================

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",

  defaultMeta: {
    service: "rent-a-car-backend",
  },

  transports: [
    new winston.transports.Console({
      format: isProduction ? fileFormat : consoleFormat,
    }),

    new winston.transports.File({
      filename: path.join(logDirectory, "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),

    new winston.transports.File({
      filename: path.join(logDirectory, "combined.log"),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],

  exitOnError: false,
});

export default logger;
