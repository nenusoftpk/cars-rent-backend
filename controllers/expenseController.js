import mongoose from "mongoose";
import Expense from "../models/Expense.js";
import Booking from "../models/Booking.js";
import Driver from "../models/Driver.js";
import Car from "../models/Car.js";
import { wrap, send, fail, fields, paging, dateWindow } from "../utils/http.js";
import { scope, tenantOnly, checkRef } from "../services/scope.js";

const CATEGORIES = ["fuel", "repair", "service", "oil_change", "tyres", "brakes", "inspection", "salary", "driver_payment", "insurance", "tax", "insurance_tax", "rent", "utilities", "office_expense", "other"];
const MAINTENANCE = ["repair", "service", "oil_change", "tyres", "brakes", "inspection"];
const EDITABLE = ["title", "category", "amount", "paidTo", "paymentMethod", "expenseDate", "receiptImage", "description", "carId", "bookingId", "driverId", "workshopName", "odometer", "nextServiceDate", "nextServiceOdometer", "nextOilChangeDate", "nextOilChangeOdometer", "idempotencyKey"];
const SEARCHABLE = ["title", "category", "paidTo", "description", "workshopName"];
const REMINDERS = ["nextServiceDate", "nextServiceOdometer", "nextOilChangeDate", "nextOilChangeOdometer"];
const tenant = (req) => tenantOnly(req);
const expenseScope = (req) => scope(req, "Expense");
const bookingScope = (req) => scope(req, "Booking");
const id = (value) => String(value?._id || value || "");
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ownEmployee = (req) => req.tenant.role === "employee" && req.tenant.dataScope === "own";
const validId = (value, label = "ID") => {
  if (!mongoose.isValidObjectId(value)) throw fail(`Invalid ${label}.`, 400);
};
const normalize = (data) => {
  for (const key of ["carId", "bookingId", "driverId"]) {
    if (data[key] === "" || data[key] === null) data[key] = null;
  }
  for (const key of [...REMINDERS, "odometer"]) {
    if (data[key] === "") data[key] = null;
  }
  return data;
};
const format = (value) => {
  const e = value?.toObject ? value.toObject() : value;
  return { ...e, id: id(e._id), date: e.expenseDate, details: e.title, supplier: e.paidTo || "", method: e.paymentMethod };
};
const populate = (query) => query
  .populate("carId", "name numberPlate")
  .populate("bookingId", "bookingNumber invoiceNumber status driverPaymentAmount")
  .populate("driverId", "name phone")
  .populate("createdBy", "name");
const ensureAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
    throw fail("Expense amount must be greater than zero and contain at most two decimal places.", 400);
  }
  return money(amount);
};
const readFilters = (req) => {
  const filter = { ...expenseScope(req), ...dateWindow(req.query, "expenseDate") };
  const { search, category, paymentMethod, carId, bookingId, driverId } = req.query;
  if (category) {
    if (!CATEGORIES.includes(category)) throw fail("Invalid expense category.", 400);
    filter.category = category;
  }
  if (paymentMethod) {
    if (!["cash", "bank", "jazzcash", "easypaisa", "card", "other"].includes(paymentMethod)) throw fail("Invalid payment method.", 400);
    filter.paymentMethod = paymentMethod;
  }
  for (const [key, value] of Object.entries({ carId, bookingId, driverId })) {
    if (value) { validId(value, key); filter[key] = value; }
  }
  if (search?.trim()) {
    const regex = new RegExp(escaped(search.trim().slice(0, 80)), "i");
    filter.$or = SEARCHABLE.map((key) => ({ [key]: regex }));
  }
  return filter;
};
const bookingFor = async (req, bookingId, session) => {
  validId(bookingId, "booking ID");
  const booking = await Booking.findOne({ _id: bookingId, ...bookingScope(req) }).session(session);
  if (!booking) throw fail("Booking not found or access denied.", 404);
  return booking;
};
const validateReferences = async (req, data, session) => {
  let car = null;
  let booking = null;
  if (data.carId) {
    validId(data.carId, "car ID");
    car = await Car.findOne({ _id: data.carId, ...tenant(req) }).session(session);
    if (!car) throw fail("Car not found in your business.", 404);
  }
  if (data.bookingId) {
    booking = await bookingFor(req, data.bookingId, session);
    if (data.carId && id(booking.carId) !== id(data.carId)) throw fail("Selected car does not match the booking.", 400);
  }
  if (data.driverId) {
    validId(data.driverId, "driver ID");
    const driver = await Driver.findOne({ _id: data.driverId, ...tenant(req) }).session(session);
    if (!driver) throw fail("Driver not found in your business.", 404);
  }
  if (MAINTENANCE.includes(data.category) && !car) throw fail("Please select a car for this maintenance expense.", 400);
  if (data.category !== "driver_payment" && data.driverId) throw fail("Driver is only allowed for Driver Payment.", 400);
  if (data.category !== "driver_payment" && data.bookingId && ownEmployee(req) && !booking) throw fail("Booking access denied.", 403);
  if (data.category === "driver_payment") {
    if (!booking || !data.driverId) throw fail("Driver payments require a booking and driver.", 400);
    if (id(booking.driverId) !== id(data.driverId)) throw fail("Driver is not assigned to this booking.", 400);
    if (booking.status === "cancelled") throw fail("Cannot pay a driver for a cancelled booking.", 409);
  }
  const hasServiceInfo = ["workshopName", "odometer", ...REMINDERS].some((key) => data[key] !== null && data[key] !== undefined && data[key] !== "");
  if (hasServiceInfo && !MAINTENANCE.includes(data.category)) throw fail("Maintenance details require a maintenance category.", 400);
  if (car && data.odometer != null && data.odometer < car.odometer) throw fail("Maintenance odometer cannot be lower than the car's current odometer.", 409);
  if (data.nextServiceOdometer != null && data.odometer != null && data.nextServiceOdometer < data.odometer) throw fail("Next service odometer must not be lower than service mileage.", 400);
  if (data.nextOilChangeOdometer != null && data.odometer != null && data.nextOilChangeOdometer < data.odometer) throw fail("Next oil-change odometer must not be lower than service mileage.", 400);
  return { booking, car };
};
const driverBalance = async (req, booking, session) => {
  const expenses = await Expense.find({ ...tenant(req), bookingId: booking._id, driverId: booking.driverId, category: "driver_payment" }).select("amount").session(session).lean();
  const payable = money(booking.driverPaymentAmount);
  const paid = money(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
  return { payable, paid, remaining: money(Math.max(0, payable - paid)) };
};
const syncReminders = async (req, carId, session) => {
  if (!carId) return;
  const car = await Car.findOne({ _id: carId, ...tenant(req) }).session(session);
  if (!car) throw fail("Car not found in your business.", 404);
  const expenses = await Expense.find({ ...tenant(req), carId, category: { $in: MAINTENANCE } })
    .sort({ expenseDate: -1, createdAt: -1, _id: -1 })
    .select([...REMINDERS, "category"].join(" "))
    .session(session).lean();
  const updates = {};
  for (const field of REMINDERS) {
    const source = expenses.find((expense) => expense[field] != null);
    if (source) updates[field] = source[field];
  }
  if (Object.keys(updates).length) {
    await Car.updateOne({ _id: carId, ...tenant(req) }, { $set: updates }, { session });
  }
};
const transact = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
};

export const listExpenses = wrap(async (req, res) => {
  const filter = readFilters(req);
  const { page, limit } = paging(req.query);
  const [expenses, total] = await Promise.all([
    populate(Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
    Expense.countDocuments(filter),
  ]);
  send(res, { items: expenses.map(format), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, "Expense records loaded successfully.");
});

export const getExpenseStats = wrap(async (req, res) => {
  const filter = readFilters(req);
  const [summary, categories] = await Promise.all([
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalRecords: { $sum: 1 }, averageAmount: { $avg: "$amount" } } }]),
    Expense.aggregate([{ $match: filter }, { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
  ]);
  const driverPayments = categories.find((item) => item._id === "driver_payment");
  send(res, { totalAmount: money(summary[0]?.totalAmount), totalRecords: summary[0]?.totalRecords || 0, averageAmount: money(summary[0]?.averageAmount), driverPayments: money(driverPayments?.amount), categories: categories.map((item) => ({ category: item._id, amount: money(item.amount), count: item.count })) });
});

export const getExpense = wrap(async (req, res) => {
  validId(req.params.id, "expense ID");
  const expense = await populate(Expense.findOne({ _id: req.params.id, ...expenseScope(req) })).lean();
  if (!expense) throw fail("Expense not found or access denied.", 404);
  send(res, format(expense));
});

export const getDriverBookingBalance = wrap(async (req, res) => {
  const booking = await bookingFor(req, req.params.bookingId, null);
  if (!booking.driverId) throw fail("No driver is assigned to this booking.", 400);
  const driver = await Driver.findOne({ _id: booking.driverId, ...tenant(req) }).select("name").lean();
  const balance = await driverBalance(req, booking, null);
  send(res, { bookingId: id(booking._id), bookingNumber: booking.bookingNumber, driverId: id(booking.driverId), driverName: driver?.name || "", driverPaymentType: booking.driverPaymentType, ...balance });
});

export const createExpense = wrap(async (req, res) => {
  const data = normalize(fields(req.body, EDITABLE));
  if (!CATEGORIES.includes(data.category)) throw fail("Invalid expense category.", 400);
  data.amount = ensureAmount(data.amount);
  const created = await transact(async (session) => {
    const { booking, car } = await validateReferences(req, data, session);
    if (data.idempotencyKey) {
      const existing = await Expense.findOne({ ...tenant(req), idempotencyKey: data.idempotencyKey }).session(session);
      if (existing) throw fail("This expense request has already been recorded.", 409);
    }
    if (data.category === "driver_payment") {
      const lock = await Booking.updateOne({ _id: booking._id, ...bookingScope(req), status: { $ne: "cancelled" }, driverId: data.driverId }, { $inc: { __v: 1 } }, { session });
      if (!lock.matchedCount) throw fail("Booking changed. Please try again.", 409);
      const balance = await driverBalance(req, booking, session);
      if (data.amount > balance.remaining) throw fail(`Payment exceeds the remaining driver balance of Rs. ${balance.remaining}.`, 409);
      if (!data.paidTo) {
        const driver = await Driver.findOne({ _id: data.driverId, ...tenant(req) }).select("name").session(session);
        data.paidTo = driver?.name || "";
      }
    }
    if (car && MAINTENANCE.includes(data.category)) {
      await Car.updateOne({ _id: car._id, ...tenant(req) }, { $inc: { __v: 1 } }, { session });
    }
    const [expense] = await Expense.create([{ ...data, ...tenant(req), createdBy: req.tenant.userId }], { session });
    if (car && MAINTENANCE.includes(data.category)) await syncReminders(req, car._id, session);
    return expense;
  });
  send(res, format(created), data.category === "driver_payment" ? "Driver payment recorded successfully." : "Expense added successfully.", 201);
});

export const updateExpense = wrap(async (req, res) => {
  validId(req.params.id, "expense ID");
  const patch = normalize(fields(req.body, EDITABLE.filter((key) => key !== "idempotencyKey")));
  if (!Object.keys(patch).length) throw fail("Please provide information to update.", 400);
  const updated = await transact(async (session) => {
    const expense = await Expense.findOne({ _id: req.params.id, ...expenseScope(req) }).session(session);
    if (!expense) throw fail("Expense not found or access denied.", 404);
    if (expense.category === "driver_payment" || patch.category === "driver_payment") throw fail("Driver payments cannot be edited. Use a controlled reversal workflow.", 409);
    const oldCarId = expense.carId;
    const merged = { ...expense.toObject(), ...patch };
    if (!CATEGORIES.includes(merged.category)) throw fail("Invalid expense category.", 400);
    merged.amount = ensureAmount(merged.amount);
    await validateReferences(req, merged, session);
    if (patch.amount !== undefined) patch.amount = merged.amount;
    for (const [key, value] of Object.entries(patch)) expense[key] = value;
    expense.updatedBy = req.tenant.userId;
    await expense.save({ session });
    for (const carId of new Set([id(oldCarId), id(expense.carId)].filter(Boolean))) {
      await Car.updateOne({ _id: carId, ...tenant(req) }, { $inc: { __v: 1 } }, { session });
      await syncReminders(req, carId, session);
    }
    return expense;
  });
  send(res, format(updated), "Expense updated successfully.");
});

export const deleteExpense = wrap(async (req, res) => {
  validId(req.params.id, "expense ID");
  const deletedId = await transact(async (session) => {
    const expense = await Expense.findOne({ _id: req.params.id, ...expenseScope(req) }).session(session);
    if (!expense) throw fail("Expense not found or access denied.", 404);
    if (expense.category === "driver_payment") throw fail("Driver payments cannot be deleted. Use a controlled reversal workflow.", 409);
    const carId = expense.carId;
    if (carId) await Car.updateOne({ _id: carId, ...tenant(req) }, { $inc: { __v: 1 } }, { session });
    await expense.deleteOne({ session });
    if (carId) await syncReminders(req, carId, session);
    return id(expense._id);
  });
  send(res, { id: deletedId }, "Expense deleted successfully.");
});
