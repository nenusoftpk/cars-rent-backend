import mongoose from "mongoose";

import Car from "../models/Car.js";
import Booking from "../models/Booking.js";
import Expense from "../models/Expense.js";
import Payment from "../models/Payment.js";
import Setting from "../models/Setting.js";

import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";

import {
  wrap,
  send,
  fail,
  paging,
  dateWindow,
} from "../utils/http.js";

import {
  scope,
  tenantOnly,
} from "../services/scope.js";

// ======================================================
// CONFIGURATION
// ======================================================

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const MANUAL_STATUSES = [
  "available",
  "maintenance",
  "out_of_service",
];

const ALL_STATUSES = [
  "available",
  "booked",
  "on_rent",
  "maintenance",
  "out_of_service",
];

const EDITABLE_FIELDS = [
  "name",
  "brand",
  "model",
  "year",
  "numberPlate",
  "chassisNumber",
  "engineNumber",
  "color",
  "fuelType",
  "transmission",
  "seatingCapacity",
  "dailyRent",
  "hourlyRent",
  "registrationDocument",
  "insuranceDocument",
  "tokenTaxDocument",
  "registrationExpiry",
  "insuranceExpiry",
  "tokenTaxExpiry",
  "odometer",
  "nextServiceDate",
  "nextOilChangeDate",
  "nextServiceOdometer",
  "nextOilChangeOdometer",
  "statusReason",
  "expectedRepairCompletionDate",
  "notes",
];

const FIELD_ALIASES = {
  plate: "numberPlate",
  fuel: "fuelType",
  seats: "seatingCapacity",
  dailyRate: "dailyRent",
  hourlyRate: "hourlyRent",
  registrationDoc: "registrationDocument",
  insuranceDoc: "insuranceDocument",
  tokenExpiry: "tokenTaxExpiry",
};

const SEARCH_FIELDS = [
  "name",
  "brand",
  "model",
  "numberPlate",
  "chassisNumber",
  "engineNumber",
];

const SORT_FIELDS = [
  "createdAt",
  "name",
  "brand",
  "model",
  "year",
  "dailyRent",
  "hourlyRent",
  "odometer",
  "status",
];

// ======================================================
// HELPERS
// ======================================================

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

const roundMoney = (value) =>
  Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

const toId = (value) =>
  value == null ? "" : String(value);

const normalizeStatus = (value) => {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (status === "under_repair") return "maintenance";
  if (status === "on_rent") return "on_rent";
  if (status === "out_of_service") return "out_of_service";

  return status;
};

const displayStatus = (status) => {
  const labels = {
    available: "Available",
    booked: "Booked",
    on_rent: "On Rent",
    maintenance: "Under Repair",
    out_of_service: "Out of Service",
  };

  return labels[status] || "Available";
};

const normalizeFuel = (value) =>
  String(value || "").trim().toLowerCase();

const normalizeTransmission = (value) =>
  String(value || "").trim().toLowerCase();

const normalizeDate = (value) => {
  if (value === "" || value === null) return null;
  return value;
};

const validateId = (id, label = "Car") => {
  if (!mongoose.isValidObjectId(id)) {
    throw fail(`Invalid ${label.toLowerCase()} ID.`, 400);
  }
};

const carFilter = (req, id) => ({
  _id: id,
  ...scope(req, "Car"),
});

const getCarOrFail = async (req) => {
  validateId(req.params.id);

  const car = await Car.findOne(
    carFilter(req, req.params.id)
  );

  if (!car) {
    throw fail(
      "Car not found or access denied.",
      404
    );
  }

  return car;
};

const pickCarData = (body = {}) => {
  const data = {};

  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }
  }

  for (const [alias, actual] of Object.entries(FIELD_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(body, alias)) {
      data[actual] = body[alias];
    }
  }

  if (data.numberPlate !== undefined) {
    data.numberPlate = String(data.numberPlate)
      .trim()
      .toUpperCase();
  }

  if (data.fuelType !== undefined) {
    data.fuelType = normalizeFuel(data.fuelType);
  }

  if (data.transmission !== undefined) {
    data.transmission = normalizeTransmission(
      data.transmission
    );
  }

  const numericFields = [
    "year",
    "seatingCapacity",
    "dailyRent",
    "hourlyRent",
    "odometer",
    "nextServiceOdometer",
    "nextOilChangeOdometer",
  ];

  for (const field of numericFields) {
    if (
      data[field] !== undefined &&
      data[field] !== null &&
      data[field] !== ""
    ) {
      const number = Number(data[field]);

      if (!Number.isFinite(number)) {
        throw fail(`Invalid value for ${field}.`, 400);
      }

      data[field] = number;
    }
  }

  const dateFields = [
    "registrationExpiry",
    "insuranceExpiry",
    "tokenTaxExpiry",
    "nextServiceDate",
    "nextOilChangeDate",
    "expectedRepairCompletionDate",
  ];

  for (const field of dateFields) {
    if (data[field] !== undefined) {
      data[field] = normalizeDate(data[field]);
    }
  }

  return data;
};

const ensureUniquePlate = async (
  req,
  numberPlate,
  excludeId = null
) => {
  if (numberPlate === undefined) return;

  if (!numberPlate) {
    throw fail("Car number plate is required.", 400);
  }

  const filter = {
    ...tenantOnly(req),
    numberPlate,
  };

  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  const exists = await Car.exists(filter);

  if (exists) {
    throw fail(
      "A car with this number plate already exists.",
      409
    );
  }
};

const hasActiveBooking = async (req, carId) => {
  return Booking.exists({
    ...tenantOnly(req),
    carId,
    status: {
      $in: ["reserved", "on_rent"],
    },
  });
};

const checkImageFile = (file) => {
  if (!file?.buffer) {
    throw fail("Invalid image file.", 400);
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw fail(
      "Only JPG, PNG and WEBP images are allowed.",
      400
    );
  }

  if (file.size > MAX_IMAGE_SIZE) {
    throw fail(
      "Each image must be 5 MB or smaller.",
      400
    );
  }
};

const uploadFile = async (
  file,
  req,
  folder = "cars"
) => {
  if (folder === "car-documents") {
    if (!file?.buffer || !ALLOWED_DOCUMENT_TYPES.includes(file.mimetype) || file.size > MAX_IMAGE_SIZE) throw fail("Only JPG, PNG, WEBP or PDF documents up to 5 MB are allowed.", 400);
  } else {
    checkImageFile(file);
  }

  const path = `rent-a-car/${req.tenant.businessId}/${folder}`;

  const result = await uploadToCloudinary(
    file.buffer,
    path,
    folder === "car-documents" && file.mimetype === "application/pdf" ? "raw" : "image",
    false
  );

  return result.secure_url;
};

const canViewFinancials = (req) => {
  const role = String(
    req.tenant?.role || req.user?.role || ""
  ).toLowerCase();

  if (["admin", "super-admin"].includes(role)) {
    return true;
  }

  const permissions = req.user?.permissions || [];

  return (
    Array.isArray(permissions) &&
    (
      permissions.includes("reports.view") ||
      permissions.includes("reports:view") ||
      permissions.includes("payments.view") ||
      permissions.includes("payments:view")
    )
  );
};

// ======================================================
// FRONTEND RESPONSE FORMAT
// ======================================================

const formatCar = (car, extra = {}) => {
  const c = car?.toObject
    ? car.toObject()
    : { ...car };

  const images = Array.isArray(c.images)
    ? c.images
    : [];

  return {
    ...c,

    id: toId(c._id),

    plate: c.numberPlate || "",

    fuel: c.fuelType
      ? c.fuelType.charAt(0).toUpperCase() +
        c.fuelType.slice(1)
      : "Petrol",

    transmission: c.transmission
      ? c.transmission.charAt(0).toUpperCase() +
        c.transmission.slice(1)
      : "Manual",

    seats: c.seatingCapacity || 0,

    dailyRate: toNumber(c.dailyRent),

    hourlyRate: toNumber(c.hourlyRent),

    image: images[0] || "",

    images,

    registrationDoc: c.registrationDocument || "",

    insuranceDoc: c.insuranceDocument || "",

    tokenExpiry: c.tokenTaxExpiry || null,

    status: displayStatus(c.status),

    manualStatus: displayStatus(c.status),

    rawStatus: c.status,

    nextServiceDate: c.nextServiceDate || null,

    nextOilChangeDate: c.nextOilChangeDate || null,
    expectedRepairCompletionDate: c.expectedRepairCompletionDate || null,

    ...extra,
  };
};

// ======================================================
// CAR FINANCIALS
// ======================================================

const calculateCarFinancials = async (
  req,
  carId
) => {
  const tenant = tenantOnly(req);

  const bookings = await Booking.find({
    ...tenant,
    carId,
  }).lean();

  const bookingIds = bookings.map(
    (booking) => booking._id
  );

  const [payments, expenses] = await Promise.all([
    bookingIds.length
      ? Payment.find({
          ...tenant,
          bookingId: { $in: bookingIds },
          status: "completed",
        }).lean()
      : [],

    Expense.find({
      ...tenant,
      carId,
    }).lean(),
  ]);

  let totalReceived = 0;

  for (const payment of payments) {
    const type = String(payment.type || "")
      .toLowerCase();

    if (type === "refund") {
      totalReceived -= toNumber(payment.amount);
    } else if (
      ![
        "security_deposit",
        "deposit",
        "deposit_refund",
        "security_refund",
      ].includes(type)
    ) {
      totalReceived += toNumber(payment.amount);
    }
  }

  const totalExpenses = expenses.reduce(
    (sum, expense) =>
      sum + toNumber(expense.amount),
    0
  );

  const totalIncome = roundMoney(totalReceived);
  const expensesTotal = roundMoney(totalExpenses);

  return {
    bookings,
    expenses,

    totalBookings: bookings.length,

    totalIncome,
    totalReceived: totalIncome,

    totalExpenses: expensesTotal,

    netCashFlow: roundMoney(
      totalIncome - expensesTotal
    ),

    paymentCount: payments.length,
    expenseCount: expenses.length,
  };
};

// ======================================================
// 1. GET ALL CARS
// GET /api/v1/cars
// ======================================================

export const listCars = wrap(async (req, res) => {
  const filter = {
    ...scope(req, "Car"),
    ...dateWindow(req.query, "createdAt"),
  };

  const {
    search,
    brand,
    model,
    status,
    fuel,
    fuelType,
    transmission,
    minRent,
    maxRent,
  } = req.query;

  if (search) {
    const regex = escapeRegex(
      String(search).trim().slice(0, 80)
    );

    filter.$or = SEARCH_FIELDS.map((field) => ({
      [field]: {
        $regex: regex,
        $options: "i",
      },
    }));
  }

  if (brand) {
    filter.brand = {
      $regex: `^${escapeRegex(brand)}$`,
      $options: "i",
    };
  }

  if (model) {
    filter.model = {
      $regex: `^${escapeRegex(model)}$`,
      $options: "i",
    };
  }

  if (status) {
    const normalized = normalizeStatus(status);

    if (!ALL_STATUSES.includes(normalized)) {
      throw fail("Invalid car status.", 400);
    }

    filter.status = normalized;
  }

  if (fuel || fuelType) {
    filter.fuelType = normalizeFuel(
      fuelType || fuel
    );
  }

  if (transmission) {
    filter.transmission =
      normalizeTransmission(transmission);
  }

  if (
    minRent !== undefined ||
    maxRent !== undefined
  ) {
    filter.dailyRent = {};

    if (minRent !== undefined) {
      const min = Number(minRent);

      if (!Number.isFinite(min) || min < 0) {
        throw fail("Invalid minimum rent.", 400);
      }

      filter.dailyRent.$gte = min;
    }

    if (maxRent !== undefined) {
      const max = Number(maxRent);

      if (!Number.isFinite(max) || max < 0) {
        throw fail("Invalid maximum rent.", 400);
      }

      filter.dailyRent.$lte = max;
    }
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const sortText = String(
    req.query.sort || "createdAt:desc"
  );

  const [sortField, sortDirection] =
    sortText.split(":");

  const sort = SORT_FIELDS.includes(sortField)
    ? {
        [sortField]:
          sortDirection === "asc" ? 1 : -1,
      }
    : { createdAt: -1 };

  const [cars, total] = await Promise.all([
    Car.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    Car.countDocuments(filter),
  ]);

  const items = cars.map((car) =>
    formatCar(car)
  );

  send(
    res,
    {
      items,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
    "Cars loaded successfully."
  );
});

// ======================================================
// 2. GET SINGLE CAR
// GET /api/v1/cars/:id
// ======================================================

export const getCar = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const tenant = tenantOnly(req);

  const financialAllowed = canViewFinancials(req);
  const maintenance = financialAllowed ? await Expense.find({
    ...tenant, carId: car._id, category: { $in: MAINTENANCE_CATEGORIES },
  }).sort({ expenseDate: -1 }).limit(100).lean() : [];

  let financials = {
    bookings: [],
    expenses: [],
    totalBookings: 0,
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
  };

  if (financialAllowed) {
    financials = await calculateCarFinancials(
      req,
      car._id
    );
  } else {
    financials.bookings = await Booking.find({
      ...tenant,
      carId: car._id,
    })
      .sort({ pickupDate: -1 })
      .limit(100)
      .lean();

    financials.totalBookings =
      financials.bookings.length;
  }

  const formatted = formatCar(car, {
    bookings: financials.bookings.map(
      (booking) => ({
        ...booking,
        id: toId(booking._id),
        total:
          toNumber(
            booking.totalAmount ??
            booking.total ??
            booking.grandTotal ??
            0
          ),
      })
    ),

    expenses: financialAllowed
      ? financials.expenses.map((expense) => ({
          ...expense,
          id: toId(expense._id),
        }))
      : [],

    maintenance,

    totalBookings: financials.totalBookings,

    totalIncome: financialAllowed
      ? financials.totalIncome
      : 0,

    totalExpenses: financialAllowed
      ? financials.totalExpenses
      : 0,

    netCashFlow: financialAllowed
      ? financials.netCashFlow
      : 0,

    financialLocked: !financialAllowed,
  });

  send(
    res,
    formatted,
    "Car details loaded successfully."
  );
});

// ======================================================
// 3. CREATE CAR
// POST /api/v1/cars
// ======================================================

export const createCar = wrap(async (req, res) => {
  const data = pickCarData(req.body);

  if (
    !data.brand ||
    !data.model ||
    !data.numberPlate
  ) {
    throw fail(
      "Brand, model and number plate are required.",
      400
    );
  }

  if (!data.name) {
    data.name = `${data.brand} ${data.model}`;
  }

  await ensureUniquePlate(
    req,
    data.numberPlate
  );

  const requestedStatus = normalizeStatus(
    req.body.status || "available"
  );

  if (!MANUAL_STATUSES.includes(requestedStatus)) {
    throw fail(
      "New cars can only be Available, Under Repair or Out of Service.",
      400
    );
  }

  const car = await Car.create({
    ...data,
    ...tenantOnly(req),
    status: requestedStatus,
    images: [],
    createdBy: req.tenant.userId,
  });

  send(
    res,
    formatCar(car),
    "Car created successfully.",
    201
  );
});

// ======================================================
// 4. UPDATE CAR
// PATCH /api/v1/cars/:id
// ======================================================

export const updateCar = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const data = pickCarData(req.body);

  if (
    !Object.keys(data).length &&
    req.body.status === undefined
  ) {
    throw fail(
      "Please provide car information to update.",
      400
    );
  }

  await ensureUniquePlate(
    req,
    data.numberPlate,
    car._id
  );

  if (req.body.status !== undefined) {
    throw fail("Use the car status endpoint to change status.", 400);
  }
  if (data.statusReason !== undefined || data.expectedRepairCompletionDate !== undefined) {
    throw fail("Use the car status endpoint to update repair details.", 400);
  }
  if (data.odometer !== undefined && data.odometer < car.odometer) {
    throw fail("Odometer cannot be reduced through ordinary car editing.", 400);
  }

  Object.assign(car, data);

  car.updatedBy = req.tenant.userId;

  await car.save();

  send(
    res,
    formatCar(car),
    "Car updated successfully."
  );
});

// ======================================================
// 5. DELETE CAR
// DELETE /api/v1/cars/:id
// ======================================================

export const deleteCar = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const tenant = tenantOnly(req);

  const [booking, expense] =
    await Promise.all([
      Booking.exists({
        ...tenant,
        carId: car._id,
      }),

      Expense.exists({
        ...tenant,
        carId: car._id,
      }),
    ]);

  if (booking || expense) {
    throw fail(
      "This car has history and cannot be deleted. Mark it Out of Service instead.",
      409
    );
  }

  await Car.deleteOne(
    carFilter(req, car._id)
  );

  send(
    res,
    { id: toId(car._id) },
    "Car deleted successfully."
  );
});

// ======================================================
// 6. UPLOAD CAR IMAGES
// POST /api/v1/cars/:id/images
// Multipart field: images
// ======================================================

export const uploadCarImages = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const files = req.files || [];

  if (!Array.isArray(files) || !files.length) {
    throw fail(
      "Please select car images.",
      400
    );
  }

  if (
    files.length > MAX_IMAGES ||
    car.images.length + files.length > MAX_IMAGES
  ) {
    throw fail(
      "A car can have a maximum of 5 images.",
      400
    );
  }

  const uploadedImages = [];

  for (const file of files) {
    const url = await uploadFile(
      file,
      req,
      "cars"
    );

    uploadedImages.push(url);
  }

  const updated = await Car.findOneAndUpdate(
    {
      ...carFilter(req, car._id),
      $expr: {
        $lte: [
          { $size: "$images" },
          MAX_IMAGES - uploadedImages.length,
        ],
      },
    },
    {
      $push: {
        images: {
          $each: uploadedImages,
        },
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updated) {
    throw fail(
      "Car images changed during upload. Please retry.",
      409
    );
  }

  send(
    res,
    {
      car: formatCar(updated),
      uploadedImages,
    },
    "Car images uploaded successfully.",
    201
  );
});

// ======================================================
// 7. REMOVE CAR IMAGE
// DELETE /api/v1/cars/:id/images
// Body: { url: "..." }
// ======================================================

export const removeCarImage = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const url = req.body?.url;

  if (
    typeof url !== "string" ||
    !car.images.includes(url)
  ) {
    throw fail(
      "Image does not belong to this car.",
      400
    );
  }

  const updated = await Car.findOneAndUpdate(
    carFilter(req, car._id),
    {
      $pull: {
        images: url,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  send(
    res,
    formatCar(updated),
    "Car image removed successfully."
  );
});

// ======================================================
// 8. UPLOAD CAR DOCUMENT
// POST /api/v1/cars/:id/documents
// Multipart field: file
// Body: type = registration | insurance | token
// ======================================================

export const uploadCarDocument = wrap(
  async (req, res) => {
    const car = await getCarOrFail(req);

    const type = String(
      req.body?.type || ""
    ).toLowerCase();

    const documentFields = {
      registration: "registrationDocument",
      insurance: "insuranceDocument",
      token: "tokenTaxDocument",
    };

    const field = documentFields[type];

    if (!field) {
      throw fail(
        "Document type must be registration, insurance or token.",
        400
      );
    }

    if (!req.file) {
      throw fail(
        "Please select a document.",
        400
      );
    }

    const url = await uploadFile(
      req.file,
      req,
      "car-documents"
    );

    car[field] = url;
    car.updatedBy = req.tenant.userId;

    await car.save();

    send(
      res,
      formatCar(car),
      "Car document uploaded successfully."
    );
  }
);

// ======================================================
// 9. UPDATE CAR STATUS
// PATCH /api/v1/cars/:id/status
// ======================================================

export const setCarStatus = wrap(async (req, res) => {
  const car = await getCarOrFail(req);
  const status = normalizeStatus(req.body.status);
  if (!MANUAL_STATUSES.includes(status)) throw fail("Invalid manual car status.", 400);
  if (car.status === "booked" || car.status === "on_rent" || await hasActiveBooking(req, car._id)) {
    throw fail("Manage existing reservations or rental before changing car status.", 409);
  }
  const reason = String(req.body.statusReason ?? "").trim();
  if (status !== "available" && reason.length < 3) {
    throw fail("Please provide a reason for making this car unavailable.", 400);
  }
  car.status = status;
  car.statusReason = status === "available" ? "" : reason;
  car.expectedRepairCompletionDate = status === "maintenance"
    ? (req.body.expectedRepairCompletionDate || null)
    : null;
  car.updatedBy = req.tenant.userId;
  await car.save();
  send(res, formatCar(car), "Car status updated successfully.");
});

// ======================================================
// 10. CAR HISTORY
// GET /api/v1/cars/:id/history
// ======================================================

export const getCarHistory = wrap(async (req, res) => {
  const car = await getCarOrFail(req);

  const tenant = tenantOnly(req);

  const [bookings, maintenance] =
    await Promise.all([
      Booking.find({
        ...tenant,
        carId: car._id,
      })
        .sort({ pickupDate: -1 })
        .limit(100)
        .lean(),

      Expense.find({
        ...tenant, carId: car._id, category: { $in: MAINTENANCE_CATEGORIES },
      })
        .sort({ expenseDate: -1 })
        .limit(100)
        .lean(),
    ]);

  send(
    res,
    {
      car: formatCar(car),
      bookings,
      maintenance: canViewFinancials(req) ? maintenance : [],
    },
    "Car history loaded successfully."
  );
});

// ======================================================
// 11. CAR REMINDERS
// GET /api/v1/cars/reminders?days=30
// ======================================================

const DEFAULT_REMINDER_DAYS_BEFORE = 7;
const DEFAULT_REMINDER_WINDOW_DAYS = 30;
const MAX_REMINDER_DAYS = 365;

// Odometer-based reminders are measured in kilometres, not days.
const ODOMETER_DUE_SOON_KM = 500;
const ODOMETER_UPCOMING_KM = 1500;

const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_DATE_RULES = [
  {
    field: "insuranceExpiry",
    type: "insurance",
    label: "Insurance Expiry",
    subject: "Insurance",
    kind: "expiry",
  },
  {
    field: "tokenTaxExpiry",
    type: "token",
    label: "Token Tax Expiry",
    subject: "Token tax",
    kind: "expiry",
  },
  {
    field: "registrationExpiry",
    type: "registration",
    label: "Registration Expiry",
    subject: "Registration",
    kind: "expiry",
  },
  {
    field: "nextServiceDate",
    type: "service",
    label: "Next Service",
    subject: "Service",
    kind: "maintenance",
  },
  {
    field: "nextOilChangeDate",
    type: "oil_change",
    label: "Next Oil Change",
    subject: "Oil change",
    kind: "maintenance",
  },
];

const REMINDER_ODOMETER_RULES = [
  {
    field: "nextServiceOdometer",
    type: "service_odometer",
    label: "Service Due (Odometer)",
    subject: "Service",
  },
  {
    field: "nextOilChangeOdometer",
    type: "oil_change_odometer",
    label: "Oil Change Due (Odometer)",
    subject: "Oil change",
  },
];

const CATEGORY_RANK = { overdue: 0, due_soon: 1, upcoming: 2 };
const CATEGORY_PRIORITY = { overdue: "high", due_soon: "medium", upcoming: "low" };

// Legacy `status` values used by the existing frontend.
const LEGACY_REMINDER_STATUS = {
  overdue: "overdue",
  due_soon: "urgent",
  upcoming: "upcoming",
};

const CAR_REMINDER_FIELDS = [
  "name",
  "brand",
  "model",
  "numberPlate",
  "status",
  "images",
  "odometer",
  ...REMINDER_DATE_RULES.map((rule) => rule.field),
  ...REMINDER_ODOMETER_RULES.map((rule) => rule.field),
].join(" ");

// Returns an integer 0..365, or null when the value is missing/invalid.
const normalizeReminderDays = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);

  return Number.isInteger(number) &&
    number >= 0 &&
    number <= MAX_REMINDER_DAYS
    ? number
    : null;
};

// Returns a finite number, or null when the value is missing/invalid.
const toFiniteOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

const resolveReminderDaysBefore = async (req, explicitValue) => {
  const explicit = normalizeReminderDays(explicitValue);

  if (explicit !== null) return explicit;

  try {
    const setting = await Setting.findOne(tenantOnly(req))
      .select("reminderDaysBefore")
      .lean();

    const stored = normalizeReminderDays(setting?.reminderDaysBefore);

    if (stored !== null) return stored;
  } catch (error) {
    console.warn(
      "Could not load reminderDaysBefore setting. Using default.",
      error?.message
    );
  }

  return DEFAULT_REMINDER_DAYS_BEFORE;
};

const categorizeReminder = (remaining, dueSoonLimit) => {
  if (remaining < 0) return "overdue";
  if (remaining <= dueSoonLimit) return "due_soon";
  return "upcoming";
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const buildDateReminderMessage = (rule, carLabel, daysRemaining) => {
  const abs = Math.abs(daysRemaining);

  if (rule.kind === "expiry") {
    if (daysRemaining < 0) {
      return `${rule.subject} for ${carLabel} expired ${plural(abs, "day")} ago.`;
    }

    if (daysRemaining === 0) {
      return `${rule.subject} for ${carLabel} expires today.`;
    }

    return `${rule.subject} for ${carLabel} expires in ${plural(abs, "day")}.`;
  }

  if (daysRemaining < 0) {
    return `${rule.subject} for ${carLabel} is overdue by ${plural(abs, "day")}.`;
  }

  if (daysRemaining === 0) {
    return `${rule.subject} for ${carLabel} is due today.`;
  }

  return `${rule.subject} for ${carLabel} is due in ${plural(abs, "day")}.`;
};

const buildOdometerReminderMessage = (
  rule,
  carLabel,
  remainingKm,
  dueOdometer
) => {
  const target = dueOdometer.toLocaleString("en-US");
  const abs = Math.abs(remainingKm).toLocaleString("en-US");

  if (remainingKm < 0) {
    return `${rule.subject} for ${carLabel} is overdue by ${abs} km (due at ${target} km).`;
  }

  if (remainingKm === 0) {
    return `${rule.subject} for ${carLabel} is due now (${target} km reached).`;
  }

  return `${rule.subject} for ${carLabel} is due at ${target} km (${abs} km remaining).`;
};

/**
 * Collect car reminders as plain data (no `res`), so it can be reused by
 * the cars endpoint and by dashboardController.js (centralized GET /reminders).
 *
 * Tenant isolation and employee data-scope come from scope(req, "Car").
 *
 * @param {import("express").Request} req
 *   Must already have passed authenticate + tenantMiddleware.
 * @param {number} [daysBefore]
 *   "Due soon" threshold in days. When omitted or invalid, the business
 *   Setting.reminderDaysBefore is used, falling back to 7.
 * @param {object} [options]
 * @param {number}  [options.windowDays]      Date look-ahead horizon in days
 *   (0..365). Default: max(30, daysBefore). Overdue items are always included.
 * @param {boolean} [options.includeOdometer] Include odometer-based reminders.
 *   Default: true.
 * @param {Date}    [options.now]             Override "now" (testing).
 *
 * @returns {Promise<{
 *   items: object[], total: number,
 *   counts: { overdue: number, due_soon: number, upcoming: number },
 *   from: Date, until: Date, daysBefore: number, windowDays: number
 * }>}
 */
export async function collectCarReminders(req, daysBefore, options = {}) {
  const opts = options && typeof options === "object" ? options : {};

  const threshold = await resolveReminderDaysBefore(req, daysBefore);

  const windowDays =
    normalizeReminderDays(opts.windowDays) ??
    Math.max(DEFAULT_REMINDER_WINDOW_DAYS, threshold);

  const includeOdometer = opts.includeOdometer !== false;

  const now =
    opts.now instanceof Date && !Number.isNaN(opts.now.getTime())
      ? opts.now
      : new Date();

  const until = new Date(now.getTime() + windowDays * DAY_MS);

  const cars = await Car.find(scope(req, "Car"))
    .select(CAR_REMINDER_FIELDS)
    .lean();

  const items = [];

  for (const car of cars) {
    const carId = toId(car._id);
    const plate = car.numberPlate || "";
    const carName = car.name || [car.brand, car.model].filter(Boolean).join(" ");
    const carLabel = plate ? `${carName} (${plate})` : carName;

    const carDetails = {
      id: carId,
      name: carName,
      plate,
      brand: car.brand || "",
      model: car.model || "",
      status: car.status || "",
      image: Array.isArray(car.images) ? car.images[0] || "" : "",
    };

    // ---------- Date-based reminders ----------
    for (const rule of REMINDER_DATE_RULES) {
      const raw = car[rule.field];

      if (!raw) continue;

      const dueDate = new Date(raw);

      if (Number.isNaN(dueDate.getTime())) continue;
      if (dueDate > until) continue;

      const daysRemaining =
        Math.ceil((dueDate.getTime() - now.getTime()) / DAY_MS) || 0;

      const category = categorizeReminder(daysRemaining, threshold);

      items.push({
        id: `${carId}-${rule.type}`,
        carId,
        carName: car.name,
        plate: car.numberPlate,
        type: rule.type,
        label: rule.label,
        dueDate,
        daysRemaining,
        status: LEGACY_REMINDER_STATUS[category],

        // Additive fields
        kind: "date",
        category,
        priority: CATEGORY_PRIORITY[category],
        message: buildDateReminderMessage(rule, carLabel, daysRemaining),
        dueOdometer: null,
        currentOdometer: null,
        remainingKm: null,
        car: carDetails,
      });
    }

    // ---------- Odometer-based reminders ----------
    if (!includeOdometer) continue;

    const currentOdometer = toFiniteOrNull(car.odometer);

    if (currentOdometer === null || currentOdometer < 0) continue;

    for (const rule of REMINDER_ODOMETER_RULES) {
      const dueOdometer = toFiniteOrNull(car[rule.field]);

      // 0 / null / invalid means "not set".
      if (dueOdometer === null || dueOdometer <= 0) continue;

      const remainingKm = dueOdometer - currentOdometer;

      if (remainingKm > ODOMETER_UPCOMING_KM) continue;

      const category = categorizeReminder(remainingKm, ODOMETER_DUE_SOON_KM);

      items.push({
        id: `${carId}-${rule.type}`,
        carId,
        carName: car.name,
        plate: car.numberPlate,
        type: rule.type,
        label: rule.label,
        dueDate: null,
        daysRemaining: null,
        status: LEGACY_REMINDER_STATUS[category],

        // Additive fields
        kind: "odometer",
        category,
        priority: CATEGORY_PRIORITY[category],
        message: buildOdometerReminderMessage(
          rule,
          carLabel,
          remainingKm,
          dueOdometer
        ),
        dueOdometer,
        currentOdometer,
        remainingKm,
        car: carDetails,
      });
    }
  }

  // Overdue -> due soon -> upcoming. Within a group: date reminders by due
  // date, then odometer reminders by remaining km. Id is the stable tie-break.
  items.sort((a, b) => {
    if (CATEGORY_RANK[a.category] !== CATEGORY_RANK[b.category]) {
      return CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    }

    if (a.kind !== b.kind) return a.kind === "date" ? -1 : 1;

    if (a.kind === "date") {
      const diff = a.dueDate.getTime() - b.dueDate.getTime();
      if (diff !== 0) return diff;
    } else if (a.remainingKm !== b.remainingKm) {
      return a.remainingKm - b.remainingKm;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const counts = { overdue: 0, due_soon: 0, upcoming: 0 };

  for (const item of items) counts[item.category] += 1;

  return {
    items,
    total: items.length,
    counts,
    from: now,
    until,
    daysBefore: threshold,
    windowDays,
  };
}

export const getCarReminders = wrap(async (req, res) => {
  const days = Number(
    req.query.days ?? 30
  );

  if (
    !Number.isInteger(days) ||
    days < 0 ||
    days > 365
  ) {
    throw fail(
      "Days must be between 0 and 365.",
      400
    );
  }

  // Odometer reminders have no due date, so they are opt-in on this
  // endpoint to keep the original response items unchanged by default.
  const includeOdometer =
    String(req.query.includeOdometer ?? "").toLowerCase() === "true";

  const result = await collectCarReminders(req, undefined, {
    windowDays: days,
    includeOdometer,
  });

  send(
    res,
    {
      items: result.items,
      total: result.total,
      from: result.from,
      until: result.until,
      counts: result.counts,
      daysBefore: result.daysBefore,
    },
    "Car reminders loaded successfully."
  );
});

// ======================================================
// 12. CAR FINANCIAL SUMMARY
// GET /api/v1/cars/:id/financials
// ======================================================

export const getCarFinancials = wrap(
  async (req, res) => {
    const car = await getCarOrFail(req);

    if (!canViewFinancials(req)) {
      throw fail(
        "You do not have permission to view car financials.",
        403
      );
    }

    const financials =
      await calculateCarFinancials(
        req,
        car._id
      );

    send(
      res,
      {
        carId: toId(car._id),
        carName: car.name,
        plate: car.numberPlate,

        totalBookings: financials.totalBookings,

        totalIncome: financials.totalIncome,

        totalReceived: financials.totalReceived,

        totalExpenses: financials.totalExpenses,

        netCashFlow: financials.netCashFlow,

        paymentCount: financials.paymentCount,

        expenseCount: financials.expenseCount,
      },
      "Car financial summary loaded successfully."
    );
  }
);

// ======================================================
// 13. CHECK CAR AVAILABILITY
// GET /api/v1/cars/:id/availability
// ======================================================

export const checkCarAvailability = wrap(
  async (req, res) => {
    const car = await getCarOrFail(req);

    const {
      pickupDate,
      returnDate,
      excludeBookingId,
    } = req.query;

    if (!pickupDate || !returnDate) {
      throw fail(
        "Pickup and return dates are required.",
        400
      );
    }

    const start = new Date(pickupDate);
    const end = new Date(returnDate);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw fail(
        "Invalid pickup or return dates.",
        400
      );
    }

    const filter = {
      ...tenantOnly(req),
      carId: car._id,
      status: {
        $in: ["reserved", "on_rent"],
      },
      pickupDate: { $lt: end },
      returnDate: { $gt: start },
    };

    if (excludeBookingId) {
      validateId(
        excludeBookingId,
        "Booking"
      );

      filter._id = {
        $ne: excludeBookingId,
      };
    }

    const overlap = await Booking.exists(
      filter
    );

    const blocked = [
      "maintenance",
      "out_of_service",
    ].includes(car.status);

    const available = !blocked && !overlap;

    send(
      res,
      {
        carId: toId(car._id),
        available,
        pickupDate: start,
        returnDate: end,
        reason: blocked
          ? "Car is unavailable due to its status."
          : overlap
            ? "Car is already booked for these dates."
            : null,
      },
      available
        ? "Car is available."
        : "Car is not available."
    );
  }
);

// ======================================================
// 14. CAR STATISTICS
// GET /api/v1/cars/stats
// ======================================================

export const getCarStats = wrap(async (req, res) => {
  const cars = await Car.find(
    scope(req, "Car")
  )
    .select("status")
    .lean();

  const counts = {
    available: 0,
    booked: 0,
    on_rent: 0,
    maintenance: 0,
    out_of_service: 0,
  };

  for (const car of cars) {
    if (
      Object.prototype.hasOwnProperty.call(
        counts,
        car.status
      )
    ) {
      counts[car.status] += 1;
    }
  }

  const totalCars = cars.length;

  send(
    res,
    {
      totalCars,
      ...counts,
      availableCars: counts.available,
      bookedCars: counts.booked,
      onRentCars: counts.on_rent,
      underRepairCars: counts.maintenance,
    },
    "Car statistics loaded successfully."
  );
});

const MAINTENANCE_CATEGORIES = ["repair", "service", "oil_change", "tyres", "brakes", "inspection"];
const SERVICE_LABELS = { "Service": "service", "Oil Change": "oil_change", "Repair": "repair", "Tyres": "tyres", "Brakes": "brakes", "Inspection": "inspection" };

export const addCarServiceRecord = wrap(async (req, res) => {
  const car = await getCarOrFail(req);
  if (!canViewFinancials(req)) throw fail("You do not have permission to record expenses.", 403);
  const { category, date, details, amount, method, supplier, odometer, nextDue } = req.body;
  const type = SERVICE_LABELS[category] || String(category || "").toLowerCase();
  if (!MAINTENANCE_CATEGORIES.includes(type)) throw fail("Invalid maintenance category.", 400);
  if (!String(details || "").trim()) throw fail("Service details are required.", 400);
  const cost = Number(amount);
  if (!Number.isFinite(cost) || cost < 0) throw fail("Invalid maintenance amount.", 400);
  const serviceDate = new Date(date);
  if (!date || Number.isNaN(serviceDate.getTime())) throw fail("Invalid service date.", 400);
  const km = odometer === undefined || odometer === "" ? null : Number(odometer);
  if (km !== null && (!Number.isFinite(km) || km < car.odometer)) throw fail("Service odometer must not be below the current car odometer.", 400);
  const nextDate = nextDue ? new Date(nextDue) : null;
  if (nextDate && Number.isNaN(nextDate.getTime())) throw fail("Invalid next service date.", 400);
  const allowedMethods = ["cash", "bank", "jazzcash", "easypaisa", "card", "other"];
  const paymentMethod = String(method || "cash").toLowerCase();
  if (!allowedMethods.includes(paymentMethod)) throw fail("Invalid payment method.", 400);
  const expense = await Expense.create({
    ...tenantOnly(req), carId: car._id, title: String(details).trim().slice(0, 200),
    category: type, amount: cost, paymentMethod, expenseDate: serviceDate,
    description: String(details).trim().slice(0, 1500),
    ...(Expense.schema.path("paidTo") ? { paidTo: String(supplier || "").trim() } : {}),
    ...(Expense.schema.path("workshopName") ? { workshopName: String(supplier || "").trim() } : {}),
    ...(Expense.schema.path("odometer") && km !== null ? { odometer: km } : {}),
    ...(Expense.schema.path("nextServiceDate") && nextDate ? { nextServiceDate: nextDate } : {}),
    createdBy: req.tenant.userId,
  });
  if (km !== null || nextDate) {
    if (km !== null) car.odometer = km;
    if (nextDate && type === "service") car.nextServiceDate = nextDate;
    if (nextDate && type === "oil_change") car.nextOilChangeDate = nextDate;
    car.updatedBy = req.tenant.userId;
    await car.save();
  }
  send(res, { ...expense.toObject(), id: toId(expense._id), date: serviceDate, details, supplier, nextDue: nextDate }, "Maintenance expense recorded successfully.", 201);
});

export const getCarServiceRecords = wrap(async (req, res) => {
  const car = await getCarOrFail(req);
  if (!canViewFinancials(req)) throw fail("You do not have permission to view expenses.", 403);
  const { page, limit } = paging({ ...req.query, limit: req.query.pageSize || req.query.limit });
  const filter = { ...tenantOnly(req), carId: car._id, category: { $in: MAINTENANCE_CATEGORIES }, ...dateWindow(req.query, "expenseDate") };
  if (req.query.category) {
    const category = String(req.query.category).toLowerCase();
    if (!MAINTENANCE_CATEGORIES.includes(category)) throw fail("Invalid maintenance category.", 400);
    filter.category = category;
  }
  const [records, total, totals] = await Promise.all([
    Expense.find(filter).sort({ expenseDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);
  send(res, { items: records.map(r => ({ ...r, id: toId(r._id) })), totalAmount: roundMoney(totals[0]?.total || 0), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, "Car maintenance expenses loaded successfully.");
});