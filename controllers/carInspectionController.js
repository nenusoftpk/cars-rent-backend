import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Car from "../models/Car.js";
import CarInspection from "../models/CarInspection.js";
import { wrap, send, fail } from "../utils/http.js";
import { scope, tenantOnly } from "../services/scope.js";
import {
  uploadMultipleToCloudinary,
  deleteMultipleFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// ======================================================
// CONSTANTS
// ======================================================

const MAX_INSPECTION_IMAGES = 5;

// ======================================================
// HELPERS
// ======================================================

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const bookingFilter = (req) => scope(req, "Booking");
const tenant = (req) => tenantOnly(req);
const own = (req) => req.tenant.role === "employee" && req.tenant.dataScope === "own";
const normalizeFuel = (fuel) =>
  ({ empty: "Empty", quarter: "1/4", half: "1/2", three_quarters: "3/4", full: "Full" })[fuel] || fuel;
const validId = (id) => mongoose.isObjectIdOrHexString(id);

async function getBooking(req, bookingId, session) {
  if (!validId(bookingId)) throw fail("Invalid booking ID.", 400);
  const booking = await Booking.findOne({ _id: bookingId, ...bookingFilter(req) }).session(session || null);
  if (!booking) throw fail("Booking not found or access denied.", 404);
  if (own(req) && String(booking.employeeId) !== String(req.tenant.userId)) {
    throw fail("You can only inspect your own bookings.", 403);
  }
  return booking;
}

async function getCar(req, carId, session) {
  const car = await Car.findOne({ _id: carId, ...tenant(req) }).session(session || null);
  if (!car) throw fail("Car not found in your business.", 404);
  return car;
}

function history(booking, message, userId) {
  booking.history ??= [];
  booking.history.push({ text: message, at: new Date(), by: userId });
}

function serialize(inspection) {
  if (!inspection) return null;
  const item = typeof inspection.toObject === "function" ? inspection.toObject() : inspection;
  return {
    ...item,
    id: String(item._id),
    bookingId: String(item.bookingId),
    carId: String(item.carId),
  };
}

function ensureNotLegacy(booking, type) {
  if (booking[type === "issue" ? "issueInspection" : "returnInspection"]) {
    throw fail("A historical inspection already exists for this booking. Migrate it before creating another.", 409);
  }
}

async function executeTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}

/**
 * Only accepts real files from Multer (req.files).
 * Never trusts URLs from the request body.
 */
async function prepareInspectionPhotos(req) {
  const files = req.files || [];

  if (files.length === 0) {
    return { urls: [], publicIds: [] };
  }

  if (files.length > MAX_INSPECTION_IMAGES) {
    throw fail(`Maximum ${MAX_INSPECTION_IMAGES} inspection photos are allowed.`, 400);
  }

  const folder = `rent-a-car/${req.tenant.businessId}/inspections`;
  const uploaded = await uploadMultipleToCloudinary(files, folder, "image", false);

  return {
    urls: uploaded.map((u) => u.secure_url),
    publicIds: uploaded.map((u) => u.public_id),
  };
}

// ======================================================
// ISSUE CAR
// ======================================================

async function inspectIssue(req) {
  const data = req.body;

  // --------------------------------------------------
  // 1. PRE-CHECKS (before any Cloudinary upload)
  // --------------------------------------------------
  const booking = await getBooking(req, data.bookingId);

  if (booking.status !== "reserved") {
    throw fail("Only reserved bookings can be issued.", 409);
  }
  ensureNotLegacy(booking, "issue");

  if (await CarInspection.exists({ ...tenant(req), bookingId: booking._id, type: "issue" })) {
    throw fail("This booking already has an issue inspection.", 409);
  }

  const car = await getCar(req, booking.carId);
  if (["maintenance", "out_of_service", "on_rent"].includes(car.status)) {
    throw fail("This car is unavailable for handover.", 409);
  }

  const other = await Booking.exists({
    ...tenant(req),
    carId: car._id,
    _id: { $ne: booking._id },
    status: "on_rent",
  });
  if (other) throw fail("This car is already on rent.", 409);

  if (Number(data.meterReading) < Number(car.odometer || 0)) {
    throw fail("Issue meter cannot be lower than the car's recorded meter.", 400);
  }

  // --------------------------------------------------
  // 2. UPLOAD IMAGES (only after authorization)
  // --------------------------------------------------
  let photoData = { urls: [], publicIds: [] };
  let uploadedPublicIds = [];

  try {
    photoData = await prepareInspectionPhotos(req);
    uploadedPublicIds = photoData.publicIds;
  } catch (error) {
    throw error;
  }

  // --------------------------------------------------
  // 3. TRANSACTION
  // --------------------------------------------------
  try {
    return await executeTransaction(async (session) => {
      // Re-fetch with session for race-condition safety
      const bookingTx = await getBooking(req, data.bookingId, session);
      if (bookingTx.status !== "reserved") {
        throw fail("Only reserved bookings can be issued.", 409);
      }

      if (await CarInspection.exists({ ...tenant(req), bookingId: bookingTx._id, type: "issue" }).session(session)) {
        throw fail("This booking already has an issue inspection.", 409);
      }

      const carTx = await getCar(req, bookingTx.carId, session);

      const now = new Date();
      const [inspection] = await CarInspection.create(
        [
          {
            businessId: req.tenant.businessId,
            bookingId: bookingTx._id,
            carId: carTx._id,
            type: "issue",
            inspectionDate: now,
            meterReading: data.meterReading,
            fuelLevel: normalizeFuel(data.fuelLevel),
            condition: data.condition || "good",
            photos: photoData.urls,
            photoPublicIds: photoData.publicIds,
            damageNotes: data.damageNotes || "",
            notes: data.notes || "",
            inspectedBy: req.tenant.userId,
          },
        ],
        { session }
      );

      bookingTx.status = "on_rent";
      bookingTx.actualPickupDate = now;
      bookingTx.handedOverBy = req.tenant.userId;
      history(bookingTx, "Car issued to customer", req.tenant.userId);

      carTx.status = "on_rent";
      carTx.odometer = data.meterReading;

      await bookingTx.save({ session });
      await carTx.save({ session });

      return {
        bookingId: String(bookingTx._id),
        status: bookingTx.status,
        issue: serialize(inspection),
      };
    });
  } catch (error) {
    // Clean up Cloudinary if transaction failed
    if (uploadedPublicIds.length > 0) {
      await deleteMultipleFromCloudinary(uploadedPublicIds, "image", "upload");
    }
    throw error;
  }
}

// ======================================================
// RETURN CAR
// ======================================================

async function inspectReturn(req) {
  const data = req.body;

  // --------------------------------------------------
  // 1. PRE-CHECKS (before any Cloudinary upload)
  // --------------------------------------------------
  const booking = await getBooking(req, data.bookingId);

  if (booking.status !== "on_rent") {
    throw fail("Only active rentals can be returned.", 409);
  }
  ensureNotLegacy(booking, "return");

  if (await CarInspection.exists({ ...tenant(req), bookingId: booking._id, type: "return" })) {
    throw fail("This booking already has a return inspection.", 409);
  }

  const issue = await CarInspection.findOne({
    ...tenant(req),
    bookingId: booking._id,
    type: "issue",
  });
  if (!issue) {
    throw fail("Issue inspection is missing. Migrate historical inspections first.", 409);
  }

  const car = await getCar(req, booking.carId);
  if (Number(data.meterReading) < Number(issue.meterReading)) {
    throw fail("Return meter cannot be less than issue meter.", 400);
  }

  // --------------------------------------------------
  // 2. UPLOAD IMAGES (only after authorization)
  // --------------------------------------------------
  let photoData = { urls: [], publicIds: [] };
  let uploadedPublicIds = [];

  try {
    photoData = await prepareInspectionPhotos(req);
    uploadedPublicIds = photoData.publicIds;
  } catch (error) {
    throw error;
  }

  // --------------------------------------------------
  // 3. TRANSACTION
  // --------------------------------------------------
  try {
    return await executeTransaction(async (session) => {
      const bookingTx = await getBooking(req, data.bookingId, session);
      if (bookingTx.status !== "on_rent") {
        throw fail("Only active rentals can be returned.", 409);
      }

      if (await CarInspection.exists({ ...tenant(req), bookingId: bookingTx._id, type: "return" }).session(session)) {
        throw fail("This booking already has a return inspection.", 409);
      }

      const issueTx = await CarInspection.findOne({
        ...tenant(req),
        bookingId: bookingTx._id,
        type: "issue",
      }).session(session);
      if (!issueTx) {
        throw fail("Issue inspection is missing. Migrate historical inspections first.", 409);
      }

      const carTx = await getCar(req, bookingTx.carId, session);

      const now = new Date();
      const distanceTravelled = Number(data.meterReading) - Number(issueTx.meterReading);
      const lateMs = Math.max(0, now.getTime() - new Date(bookingTx.returnDate).getTime());
      const lateHours = Math.ceil(lateMs / 3600000);
      const lateDays = Math.ceil(lateMs / 86400000);
      const computedLate = lateMs
        ? money((bookingTx.rentType === "hourly" ? lateHours : lateDays) * Number(bookingTx.rentRate || 0))
        : 0;
      const lateCharges = data.lateCharges === undefined ? computedLate : money(data.lateCharges);

      const charges = {
        extraKmCharges: money(data.extraKmCharges ?? bookingTx.extraKmCharges),
        extraDayCharges: money(data.extraDayCharges ?? bookingTx.extraDayCharges),
        lateCharges,
        damageCharges: money(data.damageCharges ?? bookingTx.damageCharges),
        fuelCharges: money(data.fuelCharges ?? bookingTx.fuelCharges),
      };

      const [inspection] = await CarInspection.create(
        [
          {
            businessId: req.tenant.businessId,
            bookingId: bookingTx._id,
            carId: carTx._id,
            type: "return",
            inspectionDate: now,
            meterReading: data.meterReading,
            fuelLevel: normalizeFuel(data.fuelLevel),
            condition: data.condition || "good",
            photos: photoData.urls,
            photoPublicIds: photoData.publicIds,
            damageNotes: data.damageNotes || "",
            notes: data.notes || "",
            extraKilometers: distanceTravelled,
            ...charges,
            inspectedBy: req.tenant.userId,
          },
        ],
        { session }
      );

      Object.assign(bookingTx, charges);
      bookingTx.totalAmount = money(
        Math.max(
          0,
          Number(bookingTx.rentalAmount || 0) +
            Number(bookingTx.extraDayCharges || 0) +
            Number(bookingTx.extraHourCharges || 0) +
            Number(bookingTx.extraKmCharges || 0) +
            Number(bookingTx.lateCharges || 0) +
            Number(bookingTx.damageCharges || 0) +
            Number(bookingTx.fuelCharges || 0) +
            Number(bookingTx.otherCharges || 0) +
            (bookingTx.charges || []).reduce((sum, item) => sum + Number(item.amount || 0), 0) -
            Number(bookingTx.discount || 0)
        )
      );
      bookingTx.status = "completed";
      bookingTx.actualReturnDate = now;
      bookingTx.receivedBackBy = req.tenant.userId;
      history(bookingTx, `Car returned (${distanceTravelled} km travelled)`, req.tenant.userId);

      carTx.odometer = Math.max(Number(carTx.odometer || 0), Number(data.meterReading));

      if (data.markUnderRepair) {
        carTx.status = "maintenance";
        carTx.statusReason = data.repairReason;
        if (data.expectedRepairCompletionDate && carTx.schema.path("expectedRepairCompletionDate")) {
          carTx.expectedRepairCompletionDate = new Date(data.expectedRepairCompletionDate);
        }
      } else if (carTx.status !== "out_of_service") {
        const futureBooking = await Booking.exists({
          ...tenant(req),
          carId: carTx._id,
          _id: { $ne: bookingTx._id },
          status: "reserved",
          returnDate: { $gt: now },
        }).session(session);
        carTx.status = futureBooking ? "booked" : "available";
        carTx.statusReason = "";
      }

      await bookingTx.save({ session });
      await carTx.save({ session });

      return {
        bookingId: String(bookingTx._id),
        status: bookingTx.status,
        distanceTravelled,
        lateHours,
        lateDays,
        lateCharges,
        totalAmount: bookingTx.totalAmount,
        returnInfo: serialize(inspection),
      };
    });
  } catch (error) {
    if (uploadedPublicIds.length > 0) {
      await deleteMultipleFromCloudinary(uploadedPublicIds, "image", "upload");
    }
    throw error;
  }
}

// ======================================================
// EXISTING EXPORTS
// ======================================================

export const issueCar = wrap(async (req, res) =>
  send(res, await inspectIssue(req), "Car issued successfully.", 201)
);

export const returnCar = wrap(async (req, res) =>
  send(res, await inspectReturn(req), "Car returned successfully.", 201)
);

export const createInspection = wrap(async () => {
  throw fail("Use the Issue Car or Return Car endpoint.", 400);
});

export const getBookingInspections = wrap(async (req, res) => {
  const booking = await getBooking(req, req.params.bookingId);
  const inspections = await CarInspection.find({ ...tenant(req), bookingId: booking._id }).lean();
  const issue = inspections.find((i) => i.type === "issue");
  const returned = inspections.find((i) => i.type === "return");
  send(res, {
    bookingId: String(booking._id),
    status: booking.status,
    issue: serialize(issue),
    returnInfo: serialize(returned),
    distanceTravelled: issue && returned ? returned.meterReading - issue.meterReading : null,
  });
});

export const getInspection = wrap(async (req, res) => {
  const booking = await getBooking(req, req.params.bookingId);
  const inspection = await CarInspection.findOne({
    ...tenant(req),
    bookingId: booking._id,
    type: req.params.type,
  }).lean();
  if (!inspection) throw fail("Inspection not found.", 404);
  send(res, serialize(inspection));
});

export const getInspectionById = wrap(async (req, res) => {
  const inspection = await CarInspection.findOne({ ...tenant(req), _id: req.params.id }).lean();
  if (!inspection) throw fail("Inspection not found.", 404);
  await getBooking(req, inspection.bookingId);
  send(res, serialize(inspection));
});

export const listInspections = wrap(async (req, res) => {
  const query = res.locals.validated?.query || req.query;
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const allowedBookings = await Booking.find({
    ...bookingFilter(req),
    ...(query.bookingId ? { _id: query.bookingId } : {}),
    ...(query.carId ? { carId: query.carId } : {}),
  })
    .select("_id employeeId")
    .lean();
  const ids = allowedBookings
    .filter((b) => !own(req) || String(b.employeeId) === String(req.tenant.userId))
    .map((b) => b._id);
  const filter = {
    ...tenant(req),
    bookingId: { $in: ids },
    ...(query.type ? { type: query.type } : {}),
    ...(query.carId ? { carId: query.carId } : {}),
  };
  if (query.from || query.to) {
    filter.inspectionDate = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }
  const [items, total] = await Promise.all([
    CarInspection.find(filter)
      .sort({ inspectionDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CarInspection.countDocuments(filter),
  ]);
  send(res, {
    items: items.map(serialize),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getInspectionStats = wrap(async (req, res) => {
  const bookings = await Booking.find(bookingFilter(req)).select("_id employeeId").lean();
  const ids = bookings
    .filter((b) => !own(req) || String(b.employeeId) === String(req.tenant.userId))
    .map((b) => b._id);
  const [issued, returned] = await Promise.all([
    CarInspection.countDocuments({ ...tenant(req), bookingId: { $in: ids }, type: "issue" }),
    CarInspection.countDocuments({ ...tenant(req), bookingId: { $in: ids }, type: "return" }),
  ]);
  send(res, { issued, returned, pendingReturn: Math.max(0, issued - returned) });
});