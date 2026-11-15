
import multer from "multer";
import logger from "../config/logger.js";

// ======================================================
// FRIENDLY FIELD NAMES
// ======================================================

const getFieldName = (field = "") => {
  const names = {
    name: "Name",
    email: "Email address",
    phone: "Phone number",
    cnic: "CNIC number",
    numberPlate: "Car number plate",
    chassisNumber: "Chassis number",
    engineNumber: "Engine number",
    licenseNumber: "Driving licence number",
    bookingNumber: "Booking number",
    paymentNumber: "Payment number",
    businessName: "Business name",
    password: "Password",
  };

  const key = String(field).split(".").pop();

  return (
    names[key] ||
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^./, (char) => char.toUpperCase()) ||
    "Field"
  );
};

// ======================================================
// MONGOOSE VALIDATION ERRORS
// ======================================================

const getMongooseErrors = (err) => {
  return Object.values(err.errors || {}).map((error) => {
    const field = error.path || "unknown";
    const fieldName = getFieldName(field);

    let message = error.message;

    if (error.kind === "required") {
      message = `${fieldName} is required.`;
    } else if (error.kind === "minlength") {
      message = `${fieldName} is too short.`;
    } else if (error.kind === "maxlength") {
      message = `${fieldName} is too long.`;
    } else if (error.kind === "min") {
      message = `${fieldName} is below the allowed minimum.`;
    } else if (error.kind === "max") {
      message = `${fieldName} exceeds the allowed maximum.`;
    } else if (error.kind === "enum") {
      message = `Please select a valid ${fieldName.toLowerCase()}.`;
    } else if (error.kind === "ObjectId") {
      message = `Please provide a valid ${fieldName.toLowerCase()}.`;
    }

    return {
      field,
      message,
    };
  });
};

// ======================================================
// JOI VALIDATION ERRORS
// ======================================================

const getJoiErrors = (err) => {
  return (err.details || []).map((detail) => ({
    field: detail.path?.join(".") || "unknown",
    message: detail.message.replace(/"/g, ""),
  }));
};

// ======================================================
// DUPLICATE VALUE ERRORS
// ======================================================

const getDuplicateMessage = (err) => {
  const fields = Object.keys(
    err.keyPattern || err.keyValue || {}
  );

  if (!fields.length) {
    return "This record already exists.";
  }

  const fieldNames = fields.map(getFieldName);

  return `${fieldNames.join(" and ")} already exists. Please use a different value.`;
};

// ======================================================
// FILE UPLOAD ERRORS
// ======================================================

const getUploadError = (err) => {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return "The selected file is too large. Please upload a smaller file.";

    case "LIMIT_FILE_COUNT":
      return "Too many files uploaded. Please select fewer files.";

    case "LIMIT_UNEXPECTED_FILE":
      return "This file is not allowed. Please select a valid file.";

    case "LIMIT_FIELD_COUNT":
      return "Too many form fields were submitted.";

    case "LIMIT_PART_COUNT":
      return "Too much form data was submitted.";

    case "LIMIT_FIELD_VALUE":
      return "One of the form values is too large.";

    case "LIMIT_FIELD_KEY":
      return "One of the form field names is too long.";

    default:
      return "File upload failed. Please check your selected files.";
  }
};

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

const errorHandler = (err, req, res, next) => {
  // Express requires four parameters for error middleware.

  if (res.headersSent) {
    return next(err);
  }

  const isProduction = process.env.NODE_ENV === "production";

  let statusCode =
    Number.isInteger(err.statusCode) &&
    err.statusCode >= 400 &&
    err.statusCode <= 599
      ? err.statusCode
      : Number.isInteger(err.status) &&
          err.status >= 400 &&
          err.status <= 599
        ? err.status
        : 500;

  let message = err.message || "Something went wrong.";
  let errors = null;

  // ====================================================
  // MONGOOSE VALIDATION
  // ====================================================

  if (err.name === "ValidationError" && err.errors) {
    statusCode = 400;
    errors = getMongooseErrors(err);

    message =
      errors[0]?.message ||
      "Please check the information you entered.";
  }

  // ====================================================
  // JOI VALIDATION
  // ====================================================

  else if (
    err.isJoi === true ||
    (err.name === "ValidationError" && err.details)
  ) {
    statusCode = 400;
    errors = getJoiErrors(err);

    message =
      errors[0]?.message ||
      "Please check the information you entered.";
  }

  // ====================================================
  // INVALID MONGODB OBJECT ID
  // ====================================================

  else if (err.name === "CastError") {
    statusCode = 400;

    message = `Invalid ${getFieldName(err.path).toLowerCase()}. Please provide a valid value.`;
  }

  // ====================================================
  // DUPLICATE RECORD
  // ====================================================

  else if (err.code === 11000) {
    statusCode = 409;
    message = getDuplicateMessage(err);
  }

  // ====================================================
  // JWT AUTHENTICATION
  // ====================================================

  else if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid login token. Please log in again.";
  }

  else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Your login session has expired. Please log in again.";
  }

  else if (err.name === "NotBeforeError") {
    statusCode = 401;
    message = "Your login session is not active yet.";
  }

  // ====================================================
  // INVALID JSON
  // ====================================================

  else if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    "body" in err
  ) {
    statusCode = 400;
    message = "Invalid JSON format. Please check your request data.";
  }

  // ====================================================
  // REQUEST BODY TOO LARGE
  // ====================================================

  else if (err.type === "entity.too.large") {
    statusCode = 413;
    message = "Request data is too large. Please reduce its size.";
  }

  // ====================================================
  // FILE UPLOAD
  // ====================================================

  else if (err instanceof multer.MulterError) {
    statusCode = 400;
    message = getUploadError(err);
  }

  // ====================================================
  // MONGODB CONNECTION ERRORS
  // ====================================================

  else if (
    [
      "MongoServerSelectionError",
      "MongoNetworkError",
      "MongoNetworkTimeoutError",
      "MongoServerClosedError",
      "MongooseServerSelectionError",
    ].includes(err.name)
  ) {
    statusCode = 503;

    message =
      "Database connection is temporarily unavailable. Please try again shortly.";
  }

  // ====================================================
  // DATABASE TIMEOUT
  // ====================================================

  else if (
    err.name === "MongooseError" &&
    err.message?.includes("buffering timed out")
  ) {
    statusCode = 503;

    message =
      "The database is taking too long to respond. Please try again.";
  }

  // ====================================================
  // COMMON APPLICATION ERRORS
  // ====================================================

  else if (statusCode === 400) {
    message =
      err.message || "Invalid request. Please check your information.";
  }

  else if (statusCode === 401) {
    message =
      err.message || "Please log in to continue.";
  }

  else if (statusCode === 403) {
    message =
      err.message || "You do not have permission to perform this action.";
  }

  else if (statusCode === 404) {
    message =
      err.message || "The requested record was not found.";
  }

  else if (statusCode === 409) {
    message =
      err.message || "This action conflicts with an existing record.";
  }

  else if (statusCode === 422) {
    message =
      err.message || "The provided information could not be processed.";
  }

  else if (statusCode === 429) {
    message =
      "Too many requests. Please try again later.";
  }

  else if (statusCode === 503) {
    message =
      "Service is temporarily unavailable. Please try again later.";
  }

  // ====================================================
  // PRODUCTION ERROR SAFETY
  // ====================================================

  if (isProduction && statusCode >= 500) {
    if (statusCode === 503) {
      message =
        "Service is temporarily unavailable. Please try again later.";
    } else {
      message =
        "Something went wrong on the server. Please try again later.";
    }
  }

  // ====================================================
  // LOG ERROR
  // ====================================================

  const logDetails = {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    errorName: err.name,
    errorMessage: err.message,
    ...(statusCode >= 500 && { stack: err.stack }),
  };

  if (statusCode >= 500) {
    logger.error("Server request failed.", logDetails);
  } else {
    logger.warn("Request could not be completed.", logDetails);
  }

  // ====================================================
  // SEND JSON RESPONSE
  // ====================================================

  const response = {
    success: false,
    message,
  };

  if (errors?.length) {
    response.errors = errors;
  }

  if (!isProduction) {
    response.errorType = err.name || "Error";

    if (statusCode >= 500) {
      response.stack = err.stack;
    }
  }

  return res.status(statusCode).json(response);
};

export default errorHandler;
