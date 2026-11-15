import mongoose from "mongoose";

import Car from "../models/Car.js";
import { calculateProfit } from "../services/profitService.js";

import { wrap, send, fail } from "../utils/http.js";
import { scope } from "../services/scope.js";

// ======================================================
// HELPERS
// ======================================================

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

// ======================================================
// 1. BUSINESS PROFIT
// GET /api/v1/profit/business
// ======================================================

export const getBusinessProfit = wrap(async (req, res) => {
  const profit = await calculateProfit(req);

  send(res, {
    type: "business",
    ...profit,
  }, "Business profit report loaded successfully.");
});

// ======================================================
// 2. ALL CARS PROFIT
// GET /api/v1/profit/cars
// ======================================================

export const getAllCarsProfit = wrap(async (req, res) => {
  const cars = await Car.find(scope(req, "Car"))
    .select("_id name numberPlate brand model status")
    .sort({ name: 1 })
    .lean();

  const results = await Promise.all(
    cars.map(async (car) => {
      const profit = await calculateProfit(req, car._id);

      return {
        car: {
          id: String(car._id),
          name: car.name,
          numberPlate: car.numberPlate,
          brand: car.brand || "",
          model: car.model || "",
          status: car.status,
        },
        profit,
      };
    })
  );

  // Build summary
  const summary = results.reduce(
    (acc, item) => {
      acc.totalCars += 1;
      acc.earnedRentalRevenue += Number(item.profit?.earnedRentalRevenue || 0);
      acc.cashReceived += Number(item.profit?.cashReceivedForCompletedBookings || 0);
      acc.totalCosts += Number(item.profit?.totalCosts || 0);
      acc.estimatedOperatingProfit += Number(item.profit?.estimatedOperatingProfit || 0);
      return acc;
    },
    {
      totalCars: 0,
      earnedRentalRevenue: 0,
      cashReceived: 0,
      totalCosts: 0,
      estimatedOperatingProfit: 0,
    }
  );

  // Round values
  summary.earnedRentalRevenue = Math.round(summary.earnedRentalRevenue * 100) / 100;
  summary.cashReceived = Math.round(summary.cashReceived * 100) / 100;
  summary.totalCosts = Math.round(summary.totalCosts * 100) / 100;
  summary.estimatedOperatingProfit = Math.round(summary.estimatedOperatingProfit * 100) / 100;

  send(res, {
    type: "all-cars",
    period: {
      from: req.query.from || null,
      to: req.query.to || null,
    },
    summary,
    items: results,
  }, "All cars profit report loaded successfully.");
});

// ======================================================
// 3. SINGLE CAR PROFIT
// GET /api/v1/profit/cars/:carId
// ======================================================

export const getCarProfit = wrap(async (req, res) => {
  const { carId } = req.params;

  if (!isValidObjectId(carId)) {
    throw fail("Invalid car ID.", 400);
  }

  // Just to return nice car info in response
  const car = await Car.findOne({
    _id: carId,
    ...scope(req, "Car"),
  })
    .select("_id name numberPlate brand model status")
    .lean();

  if (!car) {
    throw fail("Car not found or access denied.", 404);
  }

  const profit = await calculateProfit(req, carId);

  send(res, {
    type: "car",
    car: {
      id: String(car._id),
      name: car.name,
      numberPlate: car.numberPlate,
      brand: car.brand || "",
      model: car.model || "",
      status: car.status,
    },
    ...profit,
  }, "Car profit report loaded successfully.");
});