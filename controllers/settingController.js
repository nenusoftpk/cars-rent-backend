import Setting from "../models/Setting.js";

import { wrap, send, fail, fields } from "../utils/http.js";
import { tenantOnly, requireAdmin } from "../services/scope.js";

// ======================================================
// ALLOWED FIELDS
// ======================================================

const EDITABLE_FIELDS = [
  "invoicePrefix",
  "bookingPrefix",
  "paymentPrefix",
  "customerPrefix",
  "receiptHeader",
  "receiptFooter",
  "receiptLogo",
  "receiptPaperSize",
  "defaultCurrency",
  "timezone",
  "dateFormat",
  "reminderDaysBefore",
  "termsAndConditions",
];

// ======================================================
// HELPERS
// ======================================================

const formatSettings = (settings) => {
  if (!settings) {
    return {
      invoicePrefix: "INV",
      bookingPrefix: "BK",
      paymentPrefix: "PAY",
      customerPrefix: "CUS",
      receiptHeader: "",
      receiptFooter: "Thank you for choosing us",
      receiptLogo: "",
      receiptPaperSize: "a4",
      defaultCurrency: "PKR",
      timezone: "Asia/Karachi",
      dateFormat: "DD/MM/YYYY",
      reminderDaysBefore: 7,
      termsAndConditions: [],
    };
  }

  const data = settings.toObject ? settings.toObject() : { ...settings };

  return {
    ...data,
    id: String(data._id),
    businessId: String(data.businessId),
  };
};

// ======================================================
// 1. GET SETTINGS
// GET /api/v1/settings
// ======================================================

export const getSettings = wrap(async (req, res) => {
  const settings = await Setting.findOne(tenantOnly(req)).lean();

  send(
    res,
    formatSettings(settings),
    "Settings loaded successfully."
  );
});

// ======================================================
// 2. UPDATE SETTINGS
// PATCH /api/v1/settings
// ======================================================

export const updateSettings = wrap(async (req, res) => {
  requireAdmin(req);

  const data = fields(req.body, EDITABLE_FIELDS);

  if (Object.keys(data).length === 0) {
    throw fail("Please provide settings to update.", 400);
  }

  // Basic validation
  // Terms & Conditions validation
  if (data.termsAndConditions !== undefined) {
    if (
      !Array.isArray(data.termsAndConditions) ||
      data.termsAndConditions.some(
        (term) => typeof term !== "string"
      )
    ) {
      throw fail("Invalid Terms & Conditions.", 400);
    }

    data.termsAndConditions = data.termsAndConditions
      .map((term) => term.trim())
      .filter(Boolean);
  }
  if (data.receiptPaperSize && !["a4", "a5", "80mm", "58mm"].includes(data.receiptPaperSize)) {
    throw fail("Invalid receipt paper size.", 400);
  }

  if (data.dateFormat && !["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(data.dateFormat)) {
    throw fail("Invalid date format.", 400);
  }

  if (
    data.reminderDaysBefore !== undefined &&
    (Number(data.reminderDaysBefore) < 0 || Number(data.reminderDaysBefore) > 365)
  ) {
    throw fail("Reminder days must be between 0 and 365.", 400);
  }

  // Prefixes should be uppercase and clean
  for (const key of ["invoicePrefix", "bookingPrefix", "paymentPrefix", "customerPrefix"]) {
    if (data[key]) {
      data[key] = String(data[key]).trim().toUpperCase().slice(0, 10);
    }
  }

  const settings = await Setting.findOneAndUpdate(
    tenantOnly(req),
    {
      $set: {
        ...data,
        updatedBy: req.tenant.userId,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  send(
    res,
    formatSettings(settings),
    "Settings saved successfully."
  );
});

// ======================================================
// 3. RESET SETTINGS TO DEFAULT (Optional but useful)
// POST /api/v1/settings/reset
// ======================================================

export const resetSettings = wrap(async (req, res) => {
  requireAdmin(req);

  const defaults = {
    invoicePrefix: "INV",
    bookingPrefix: "BK",
    paymentPrefix: "PAY",
    customerPrefix: "CUS",
    receiptHeader: "",
    receiptFooter: "Thank you for choosing us",
    receiptLogo: "",
    receiptPaperSize: "a4",
    defaultCurrency: "PKR",
    timezone: "Asia/Karachi",
    dateFormat: "DD/MM/YYYY",
    reminderDaysBefore: 7,
    updatedBy: req.tenant.userId,
  };

  const settings = await Setting.findOneAndUpdate(
    tenantOnly(req),
    { $set: defaults },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  send(
    res,
    formatSettings(settings),
    "Settings have been reset to default."
  );
});