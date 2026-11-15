
import "./config/env.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

import connectDB from "./config/db.js";
import logger from "./config/logger.js";
import errorHandler from "./middlewares/error.middleware.js";

// ======================================================
// API ROUTES
// ======================================================

import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";

import businessRoutes from "./routes/businessRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";

import customerRoutes from "./routes/customerRoutes.js";
import carRoutes from "./routes/carRoutes.js";
import driverRoutes from "./routes/driverRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import carInspectionRoutes from "./routes/carInspectionRoutes.js";

import paymentRoutes from "./routes/paymentRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
// import maintenanceRoutes from "./routes/maintenanceRoutes.js";

import dashboardRoutes from "./routes/dashboardRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import ledgerRoutes from "./routes/ledgerRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";

import profitRoutes from "./routes/profitRoutes.js";
import platformRoutes from "./routes/platformRoutes.js";
// import uploadRoutes from "./routes/uploadRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import platformAdminRoutes from "./routes/platformAdminRoutes.js";

// ======================================================
// APP CONFIGURATION
// ======================================================

const app = express();

const PORT = Number(process.env.PORT) || 8000;
const NODE_ENV = process.env.NODE_ENV || "development";
const API_PREFIX = "/api/v1";

const isDevelopment = NODE_ENV === "development";

// ======================================================
// TRUST PROXY
// ======================================================

const trustProxy = process.env.TRUST_PROXY || "false";

if (["true", "1"].includes(trustProxy)) {
  app.set("trust proxy", 1);
} else if (["false", "0"].includes(trustProxy)) {
  app.set("trust proxy", false);
} else {
  throw new Error(
    "Invalid TRUST_PROXY value. Use true, false, 1, or 0."
  );
}

// ======================================================
// SECURITY
// ======================================================

app.disable("x-powered-by");

app.use(helmet());
app.use(compression());

// ======================================================
// CORS
// ======================================================

const allowedOrigins = (
  process.env.CLIENT_URL || "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const error = new Error(
        "This website is not allowed to access the API."
      );

      error.statusCode = 403;

      return callback(error);
    },

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],

    exposedHeaders: [
      "Retry-After",
      "RateLimit",
      "RateLimit-Policy",
    ],

    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// ======================================================
// BODY PARSING
// ======================================================

app.use(express.json({ limit: "2mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  })
);

app.use(cookieParser());

// ======================================================
// REQUEST LOGGING
// ======================================================

app.use(
  morgan(isDevelopment ? "dev" : "combined", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

// ======================================================
// CENTRALIZED RATE LIMITING
// ======================================================

const createLimiter = ({
  windowMs,
  devLimit,
  prodLimit,
  message,
  skipSuccessfulRequests = false,
}) =>
  rateLimit({
    windowMs,

    limit: isDevelopment ? devLimit : prodLimit,

    standardHeaders: "draft-8",
    legacyHeaders: false,

    skipSuccessfulRequests,

    skip: (req) => req.method === "OPTIONS",

    message: {
      success: false,
      message,
      errorType: "RATE_LIMIT_EXCEEDED",
    },
  });

// General API limiter
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  devLimit: 3000,
  prodLimit: 1000,
  message: "Too many API requests. Please try again later.",
});

// Login
const loginLimiter = createLimiter({
  windowMs: 1 * 60 * 1000,
  devLimit: 100,
  prodLimit: 100,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please try again after 15 minutes.",
});

// Signup
const signupLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  devLimit: 100,
  prodLimit: 5,
  message: "Too many registration attempts. Please try again later.",
});

// Password recovery
const recoveryLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  devLimit: 100,
  prodLimit: 5,
  message: "Too many password recovery requests. Please try again later.",
});

// Email verification
const verificationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  devLimit: 100,
  prodLimit: 5,
  message: "Too many verification requests. Please try again later.",
});

// Sensitive account changes
const accountLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  devLimit: 100,
  prodLimit: 10,
  message: "Too many account update requests. Please try again later.",
});

// ======================================================
// APPLY AUTH LIMITERS
// ======================================================

app.use(`${API_PREFIX}/auth/login`, loginLimiter);

app.use(`${API_PREFIX}/auth/signup`, signupLimiter);

app.use(
  [
    `${API_PREFIX}/auth/forgot-password`,
    `${API_PREFIX}/auth/reset-password`,
  ],
  recoveryLimiter
);

app.use(
  [
    `${API_PREFIX}/auth/verify-email`,
    `${API_PREFIX}/auth/resend-verification`,
  ],
  verificationLimiter
);

app.use(
  [
    `${API_PREFIX}/auth/change-password`,
    `${API_PREFIX}/auth/update-email`,
  ],
  accountLimiter
);

// ======================================================
// GLOBAL LIMITER FOR OTHER API ROUTES
// ======================================================

app.use(API_PREFIX, (req, res, next) => {
  // Authentication routes have dedicated limiters.
  if (
    req.path === "/auth" ||
    req.path.startsWith("/auth/")
  ) {
    return next();
  }

  return apiLimiter(req, res, next);
});

// ======================================================
// ROOT
// ======================================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Rent A Car SaaS Backend is running",
    environment: NODE_ENV,
    apiVersion: "v1",
    timestamp: new Date().toISOString(),
  });
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(`${API_PREFIX}/health`, (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    message: dbConnected
      ? "Rent A Car API is healthy"
      : "Database connection is unavailable",
    database: dbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ======================================================
// ROUTES
// ======================================================

// Authentication
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/employees`, employeeRoutes);

// Business
app.use(`${API_PREFIX}/business`, businessRoutes);
app.use(`${API_PREFIX}/subscriptions`, subscriptionRoutes);

// Rent A Car
app.use(`${API_PREFIX}/customers`, customerRoutes);
app.use(`${API_PREFIX}/cars`, carRoutes);
app.use(`${API_PREFIX}/drivers`, driverRoutes);
app.use(`${API_PREFIX}/bookings`, bookingRoutes);
app.use(`${API_PREFIX}/inspections`, carInspectionRoutes);

// Finance
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/expenses`, expenseRoutes);
// app.use(`${API_PREFIX}/maintenance`, maintenanceRoutes);

// Dashboard and reports
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use(`${API_PREFIX}/ledger`, ledgerRoutes);
app.use(`${API_PREFIX}/settings`, settingRoutes);
app.use(`${API_PREFIX}/documents`, documentRoutes);


// Profit
app.use(`${API_PREFIX}/profits`, profitRoutes);

// Super Admin
app.use(`${API_PREFIX}/platform`, platformRoutes);
app.use(`${API_PREFIX}/platform/admins`, platformAdminRoutes);


// Uploads
// app.use(`${API_PREFIX}/uploads`, uploadRoutes);

// ======================================================
// 404 HANDLER
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested API endpoint was not found.",
    path: req.originalUrl,
    method: req.method,
  });
});

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(errorHandler);

// ======================================================
// SERVER STARTUP
// ======================================================

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      logger.info("======================================");
      logger.info("Rent A Car SaaS Backend Started");
      logger.info(`Environment: ${NODE_ENV}`);
      logger.info(`Port: ${PORT}`);
      logger.info(`API Prefix: ${API_PREFIX}`);
      logger.info("======================================");
    });

    let shuttingDown = false;

    const shutdown = (signal) => {
      if (shuttingDown) return;

      shuttingDown = true;

      logger.info(`${signal} received. Shutting down...`);

      server.close(async (error) => {
        if (error) {
          logger.error("HTTP server shutdown error", {
            message: error.message,
          });
        }

        try {
          await mongoose.connection.close();

          logger.info("MongoDB connection closed");
          logger.info("Server stopped successfully");

          process.exit(error ? 1 : 0);
        } catch (dbError) {
          logger.error("MongoDB shutdown failed", {
            message: dbError.message,
          });

          process.exit(1);
        }
      });

      setTimeout(() => {
        logger.error("Forced shutdown after 10 seconds");
        process.exit(1);
      }, 10000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error("Failed to start Rent A Car backend", {
      message: error.message,
      stack: error.stack,
    });

    process.exit(1);
  }
};

startServer();

export default app;
