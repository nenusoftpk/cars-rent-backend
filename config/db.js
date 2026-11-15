
import mongoose from "mongoose";
import logger from "./logger.js";

// ======================================================
// MONGOOSE CONFIGURATION
// ======================================================

mongoose.set("strictQuery", true);

let eventsRegistered = false;

// ======================================================
// DATABASE CONNECTION EVENTS
// ======================================================

const registerDatabaseEvents = () => {
  if (eventsRegistered) return;

  eventsRegistered = true;

  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connection established.");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn(
      "MongoDB disconnected. Database operations may be temporarily unavailable."
    );
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected successfully.");
  });

  mongoose.connection.on("error", (error) => {
    logger.error("MongoDB connection error.", {
      message: error.message,
    });
  });
};

// ======================================================
// FRIENDLY DATABASE ERROR MESSAGES
// ======================================================

const getDatabaseErrorMessage = (error) => {
  const message = error.message || "";

  if (
    error.name === "MongoServerSelectionError" ||
    message.includes("Server selection timed out")
  ) {
    return (
      "Cannot connect to MongoDB Atlas. " +
      "Check your internet connection, Atlas IP access list, " +
      "cluster status, and MongoDB connection string."
    );
  }

  if (
    error.name === "MongoNetworkError" ||
    error.name === "MongoNetworkTimeoutError"
  ) {
    return (
      "MongoDB network connection failed. " +
      "Check your internet connection and Atlas network settings."
    );
  }

  if (
    error.code === 18 ||
    message.includes("Authentication failed") ||
    message.includes("bad auth")
  ) {
    return (
      "MongoDB authentication failed. " +
      "Check your database username and password in MONGODB_URI."
    );
  }

  if (
    message.includes("querySrv") ||
    message.includes("ENOTFOUND")
  ) {
    return (
      "MongoDB cluster address could not be found. " +
      "Check your MongoDB Atlas hostname and DNS connection."
    );
  }

  return "MongoDB connection failed. Please check your database configuration.";
};

// ======================================================
// CONNECT DATABASE
// ======================================================

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error(
        "MONGODB_URI is missing from the environment configuration."
      );
    }

    if (mongoose.connection.readyState === 1) {
      logger.info("MongoDB is already connected.");
      return mongoose.connection;
    }

    registerDatabaseEvents();

    logger.info("Connecting to MongoDB Atlas...");

    const connection = await mongoose.connect(
      process.env.MONGODB_URI,
      {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 20,
        minPoolSize: 0,
        maxIdleTimeMS: 30000,
        retryWrites: true,
      }
    );

    logger.info("MongoDB Atlas connected successfully.", {
      database: connection.connection.name,
      host: connection.connection.host,
    });

    return connection.connection;
  } catch (error) {
    logger.error(getDatabaseErrorMessage(error), {
      errorName: error.name,
      errorCode: error.code,
      details: error.message,
    });

    throw error;
  }
};

// ======================================================
// DISCONNECT DATABASE
// ======================================================

export const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      logger.info("MongoDB is already disconnected.");
      return;
    }

    await mongoose.disconnect();

    logger.info("MongoDB disconnected successfully.");
  } catch (error) {
    logger.error("Failed to disconnect MongoDB.", {
      message: error.message,
    });

    throw error;
  }
};

export default connectDB;
