import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Car from "../models/Car.js";
import CarInspection from "../models/CarInspection.js";
import Booking from "../models/Booking.js";

import { wrap, send, fail, paging } from "../utils/http.js";
import { scope, tenantOnly } from "../services/scope.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// ======================================================
// TYPE MAPPING (exactly what frontend uses)
// ======================================================
const CUSTOMER_MAP = {
  "Customer Photo": { field: "photo", publicId: "photoPublicId", sensitive: false },
  "CNIC Front":     { field: "cnicFront", publicId: "cnicFrontPublicId", sensitive: true },
  "CNIC Back":      { field: "cnicBack", publicId: "cnicBackPublicId", sensitive: true },
  "Driving Licence":{ field: "licenseImage", publicId: "licenseImagePublicId", sensitive: true },
};

const CAR_MAP = {
  "Car Photo":              { field: "images", isArray: true, sensitive: false },
  "Registration Document":  { field: "registrationDocument", sensitive: false },
  "Insurance Document":     { field: "insuranceDocument", sensitive: false },
  "Token Tax Document":     { field: "tokenTaxDocument", sensitive: false },
};

// ======================================================
// HELPERS
// ======================================================
const id = (v) => String(v?._id || v || "");
const tenant = (req) => tenantOnly(req);

const canViewSensitive = (req) => {
  if (["admin", "super-admin"].includes(req.tenant?.role)) return true;
  const perms = req.user?.permissions || [];
  return perms.includes("sensitive.view") || perms.includes("sensitive:view") ||
         perms.includes("documents.sensitive.view");
};

const canEditSensitive = (req) => {
  if (["admin", "super-admin"].includes(req.tenant?.role)) return true;
  const perms = req.user?.permissions || [];
  return perms.includes("documents.create") || perms.includes("documents.edit") ||
         perms.includes("sensitive.edit");
};

// Composite ID format used by frontend:  customer:ID:type   or   car:ID:type   or   inspection:ID:index
const makeId = (ownerType, ownerId, type, extra = "") =>
  `${ownerType}:${ownerId}:${type}${extra ? `:${extra}` : ""}`;

const parseId = (compositeId) => {
  const parts = String(compositeId).split(":");
  if (parts.length < 3) throw fail("Invalid document ID.", 400);
  return {
    ownerType: parts[0],
    ownerId: parts[1],
    type: parts[2],
    extra: parts[3] || null, // for inspection photo index
  };
};

// ======================================================
// 1. LIST DOCUMENTS + SUMMARY
// GET /api/v1/documents
// ======================================================
export const listDocuments = wrap(async (req, res) => {
  const { search, type, ownerType, from, to, sort = "uploadedAt:desc" } = req.query;
  const { page, limit } = paging(req.query);
  const sensitiveAllowed = canViewSensitive(req);

  const items = [];

  // ---------- CUSTOMERS ----------
  if (!ownerType || ownerType === "customer") {
    const customers = await Customer.find(scope(req, "Customer"))
      .select("name photo photoPublicId cnicFront cnicFrontPublicId cnicBack cnicBackPublicId licenseImage licenseImagePublicId updatedAt createdAt")
      .lean();

    for (const c of customers) {
      for (const [label, cfg] of Object.entries(CUSTOMER_MAP)) {
        const url = c[cfg.field];
        if (!url) continue;
        if (cfg.sensitive && !sensitiveAllowed) continue;

        items.push({
          id: makeId("customer", id(c._id), label),
          type: label,
          ownerType: "customer",
          ownerId: id(c._id),
          ownerName: c.name || "Customer",
          name: label,
          url,
          size: 0, // we don't store size; frontend shows "1 KB" as fallback
          uploadedAt: c.updatedAt || c.createdAt,
          sensitive: cfg.sensitive,
          locked: cfg.sensitive && !sensitiveAllowed,
        });
      }
    }
  }

  // ---------- CARS ----------
  if (!ownerType || ownerType === "car") {
    const cars = await Car.find(scope(req, "Car"))
      .select("name numberPlate images registrationDocument insuranceDocument tokenTaxDocument updatedAt createdAt")
      .lean();

    for (const car of cars) {
      // Car photos (array)
      if (Array.isArray(car.images)) {
        car.images.forEach((url, idx) => {
          if (!url) return;
          items.push({
            id: makeId("car", id(car._id), "Car Photo", String(idx)),
            type: "Car Photo",
            ownerType: "car",
            ownerId: id(car._id),
            ownerName: `${car.name || ""} (${car.numberPlate || ""})`.trim(),
            name: `Car Photo ${idx + 1}`,
            url,
            size: 0,
            uploadedAt: car.updatedAt || car.createdAt,
            sensitive: false,
            locked: false,
          });
        });
      }

      // Single documents
      for (const [label, cfg] of Object.entries(CAR_MAP)) {
        if (cfg.isArray) continue;
        const url = car[cfg.field];
        if (!url) continue;

        items.push({
          id: makeId("car", id(car._id), label),
          type: label,
          ownerType: "car",
          ownerId: id(car._id),
          ownerName: `${car.name || ""} (${car.numberPlate || ""})`.trim(),
          name: label,
          url,
          size: 0,
          uploadedAt: car.updatedAt || car.createdAt,
          sensitive: false,
          locked: false,
        });
      }
    }
  }

  // ---------- HANDOVER / RETURN PHOTOS (from inspections) ----------
  if (!ownerType || ownerType === "booking") {
    const inspections = await CarInspection.find(tenant(req))
      .populate("bookingId", "bookingNumber")
      .populate("carId", "name numberPlate")
      .select("type photos bookingId carId inspectionDate")
      .lean();

    for (const insp of inspections) {
      const label = insp.type === "issue" ? "Handover Photo" : "Return Photo";
      (insp.photos || []).forEach((url, idx) => {
        if (!url) return;
        items.push({
          id: makeId("inspection", id(insp._id), label, String(idx)),
          type: label,
          ownerType: "booking",
          ownerId: id(insp.bookingId?._id || insp.bookingId),
          ownerName: insp.bookingId?.bookingNumber
            ? `Booking ${insp.bookingId.bookingNumber}`
            : `Inspection`,
          name: `${label} ${idx + 1}`,
          url,
          size: 0,
          uploadedAt: insp.inspectionDate,
          sensitive: false,
          locked: false,
        });
      });
    }
  }

  // ---------- FILTERS ----------
  let filtered = items;

  if (type) {
    filtered = filtered.filter((d) => d.type === type);
  }
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.ownerName.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q)
    );
  }
  if (from || to) {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    filtered = filtered.filter((d) => {
      const dt = new Date(d.uploadedAt);
      if (fromDate && dt < fromDate) return false;
      if (toDate && dt > toDate) return false;
      return true;
    });
  }

  // ---------- SORT ----------
  const [sortField, sortDir] = String(sort).split(":");
  filtered.sort((a, b) => {
    const av = a[sortField] || a.uploadedAt;
    const bv = b[sortField] || b.uploadedAt;
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // ---------- SUMMARY ----------
  const summary = {
    total: filtered.length,
    sensitive: filtered.filter((d) => d.sensitive).length,
  };

  // ---------- PAGINATION ----------
  const total = filtered.length;
  const start = (page - 1) * limit;
  const pageItems = filtered.slice(start, start + limit);

  send(res, {
    items: pageItems,
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  }, "Documents loaded successfully.");
});

// ======================================================
// 2. UPLOAD (or auto-replace if same type already exists)
// POST /api/v1/documents
// Body: ownerType, ownerId, type + file
// ======================================================
export const uploadDocument = wrap(async (req, res) => {
  const { ownerType, ownerId, type } = req.body;
  const file = req.file;

  if (!file) throw fail("Please select a file.", 400);
  if (!ownerType || !ownerId || !type) throw fail("ownerType, ownerId and type are required.", 400);
  if (!mongoose.isValidObjectId(ownerId)) throw fail("Invalid owner ID.", 400);

  const isSensitive = CUSTOMER_MAP[type]?.sensitive;
  if (isSensitive && !canEditSensitive(req)) {
    throw fail("You do not have permission to upload sensitive documents.", 403);
  }

  // Upload to Cloudinary
  const folder = `rent-a-car/${req.tenant.businessId}/documents`;
  const uploaded = await uploadToCloudinary(
    file.buffer,
    folder,
    file.mimetype === "application/pdf" ? "raw" : "image",
    false
  );

  try {
    if (ownerType === "customer") {
      const cfg = CUSTOMER_MAP[type];
      if (!cfg) throw fail("Invalid customer document type.", 400);

      const customer = await Customer.findOne({
        _id: ownerId,
        ...scope(req, "Customer"),
      }).select(`+${cfg.publicId}`);

      if (!customer) throw fail("Customer not found.", 404);

      // Delete old file if exists
      if (customer[cfg.publicId]) {
        try {
          await deleteFromCloudinary(customer[cfg.publicId], "image", "upload");
        } catch (_) {}
      }

      customer[cfg.field] = uploaded.secure_url;
      customer[cfg.publicId] = uploaded.public_id;
      await customer.save();

      return send(res, {
        id: makeId("customer", ownerId, type),
        type,
        ownerType: "customer",
        ownerId,
        ownerName: customer.name,
        url: uploaded.secure_url,
        name: file.originalname || type,
        size: file.size || 0,
        uploadedAt: new Date(),
        sensitive: cfg.sensitive,
        locked: false,
      }, "Document uploaded successfully.", 201);
    }

    if (ownerType === "car") {
      const cfg = CAR_MAP[type];
      if (!cfg) throw fail("Invalid car document type.", 400);

      const car = await Car.findOne({
        _id: ownerId,
        ...scope(req, "Car"),
      });

      if (!car) throw fail("Car not found.", 404);

      if (cfg.isArray) {
        // Car Photo → push into images (max 5)
        if (car.images.length >= 5) {
          throw fail("A car can have maximum 5 photos.", 400);
        }
        car.images.push(uploaded.secure_url);
      } else {
        // single document field
        car[cfg.field] = uploaded.secure_url;
      }
      await car.save();

      return send(res, {
        id: makeId("car", ownerId, type, cfg.isArray ? String(car.images.length - 1) : ""),
        type,
        ownerType: "car",
        ownerId,
        ownerName: `${car.name} (${car.numberPlate})`,
        url: uploaded.secure_url,
        name: file.originalname || type,
        size: file.size || 0,
        uploadedAt: new Date(),
        sensitive: false,
        locked: false,
      }, "Document uploaded successfully.", 201);
    }

    throw fail("ownerType must be customer or car.", 400);
  } catch (err) {
    // clean up Cloudinary if DB failed
    try {
      await deleteFromCloudinary(uploaded.public_id, file.mimetype === "application/pdf" ? "raw" : "image", "upload");
    } catch (_) {}
    throw err;
  }
});

// ======================================================
// 3. REPLACE
// PATCH /api/v1/documents/:id
// ======================================================
export const replaceDocument = wrap(async (req, res) => {
  const { id: compositeId } = req.params;
  const file = req.file;
  if (!file) throw fail("Please select a file.", 400);

  const { ownerType, ownerId, type, extra } = parseId(compositeId);

  // Re-use upload logic (it already replaces)
  req.body = { ownerType, ownerId, type };
  return uploadDocument(req, res);
});

// ======================================================
// 4. DELETE
// DELETE /api/v1/documents/:id
// ======================================================
export const deleteDocument = wrap(async (req, res) => {
  const { id: compositeId } = req.params;
  const { ownerType, ownerId, type, extra } = parseId(compositeId);

  if (ownerType === "customer") {
    const cfg = CUSTOMER_MAP[type];
    if (!cfg) throw fail("Invalid document type.", 400);
    if (cfg.sensitive && !canEditSensitive(req)) {
      throw fail("You do not have permission to delete sensitive documents.", 403);
    }

    const customer = await Customer.findOne({
      _id: ownerId,
      ...scope(req, "Customer"),
    }).select(`+${cfg.publicId}`);

    if (!customer) throw fail("Document not found.", 404);

    if (customer[cfg.publicId]) {
      try {
        await deleteFromCloudinary(customer[cfg.publicId], "image", "upload");
      } catch (_) {}
    }

    customer[cfg.field] = "";
    customer[cfg.publicId] = "";
    await customer.save();

    return send(res, { id: compositeId }, "Document deleted successfully.");
  }

  if (ownerType === "car") {
    const car = await Car.findOne({
      _id: ownerId,
      ...scope(req, "Car"),
    });
    if (!car) throw fail("Document not found.", 404);

    if (type === "Car Photo" && extra !== null) {
      const idx = Number(extra);
      if (car.images[idx]) {
        car.images.splice(idx, 1);
        await car.save();
      }
    } else {
      const cfg = CAR_MAP[type];
      if (cfg && !cfg.isArray) {
        car[cfg.field] = "";
        await car.save();
      }
    }

    return send(res, { id: compositeId }, "Document deleted successfully.");
  }

  // Inspection photos – we only allow delete of the whole inspection photo array item
  // (you can expand this later if needed)
  throw fail("Deleting handover/return photos is not supported from this page yet. Delete the inspection instead.", 400);
});