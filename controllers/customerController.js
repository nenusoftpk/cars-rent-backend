import mongoose from "mongoose";
import crypto from "crypto";

import Customer from "../models/Customer.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";

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

import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";

// ======================================================
// CONSTANTS
// ======================================================

const EDITABLE_FIELDS = [
  "customerCode",
  "name",
  "phone",
  "alternatePhone",
  "email",
  "gender",
  "type",
  "address",
  "city",
  "cnic",
  // photo, cnicFront, cnicBack, licenseImage REMOVED
  "licenseNumber",
  "licenseExpiry",
  "openingBalance",
  "notes",
  "status",
];

const SEARCH_FIELDS = [
  "name",
  "phone",
  "alternatePhone",
  "cnic",
  "customerCode",
  "email",
  "licenseNumber",
];

const SORT_FIELDS = [
  "createdAt",
  "name",
  "city",
  "totalBookings",
  "totalSpent",
  "pending",
];

const DB_SORT_FIELDS = ["createdAt", "name", "city"];

const SENSITIVE_FIELDS = [
  "cnic",
  "cnicFront",
  "cnicBack",
  "licenseNumber",
  "licenseImage",
  "licenseExpiry",
];

// ======================================================
// GUARANTOR CONSTANTS
// Request field names (multipart or JSON):
//   guarantor{1|2}Enabled, guarantor{1|2}Name, guarantor{1|2}Mobile
//   files: guarantor{1|2}Photo, guarantor{1|2}CnicFront, guarantor{1|2}CnicBack
// ======================================================

const GUARANTOR_INDEXES = [1, 2];

const GUARANTOR_IMAGE_FIELDS = [
  { key: "photo", suffix: "Photo", label: "photo" },
  { key: "cnicFront", suffix: "CnicFront", label: "CNIC front image" },
  { key: "cnicBack", suffix: "CnicBack", label: "CNIC back image" },
];

const PK_MOBILE_REGEX = /^(?:\+92|0092|92|0)?3\d{9}$/;

// Select string that loads the hidden Cloudinary ids of both guarantors
const GUARANTOR_PUBLIC_ID_SELECT = GUARANTOR_INDEXES.flatMap((index) =>
  GUARANTOR_IMAGE_FIELDS.map(
    ({ key }) => `+guarantor${index}.${key}PublicId`
  )
).join(" ");
// Select string that loads the hidden encrypted thumb for both guarantors
const GUARANTOR_BIOMETRIC_SELECT = GUARANTOR_INDEXES.map(
  (index) => `+guarantor${index}.biometric.thumbImage`
).join(" ");

// Biometric / fingerprint (AES-256-GCM)
const BIOMETRIC_KEY_ENV = "BIOMETRIC_ENCRYPTION_KEY";
const FINGERPRINT_MAX_BYTES = 1024 * 1024; // 1 MB
const FINGERPRINT_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

// ======================================================
// HELPERS
// ======================================================

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const parseMoney = (value, fieldName = "amount") => {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw fail(`Invalid ${fieldName}. Please provide a valid number.`, 400);
  }
  return n;
};

const roundMoney = (value) => {
  const n = number(value);
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

const normalizeStatus = (value) => {
  const status = String(value || "").toLowerCase();
  if (["active", "inactive", "blocked"].includes(status)) return status;
  return "";
};

const normalizeType = (value) => {
  const type = String(value || "").toLowerCase();
  if (type === "vip") return "VIP";
  if (type === "regular") return "Regular";
  if (type === "corporate") return "Corporate";
  return "";
};

const getEditableData = (body = {}) => {
  const data = {};

  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }
  }

  if (body.mobile !== undefined) data.phone = body.mobile;
  if (body.licenseNo !== undefined) data.licenseNumber = body.licenseNo;

  if (data.status !== undefined) {
    const normalized = normalizeStatus(data.status);
    if (!normalized) {
      throw fail("Invalid customer status. Allowed values: active, inactive, blocked.", 400);
    }
    data.status = normalized;
  }

  if (data.type !== undefined) {
    if (data.type === "" || data.type === null) {
      data.type = "";
    } else {
      const normalized = normalizeType(data.type);
      if (!normalized) {
        throw fail("Invalid customer type. Allowed values: Regular, VIP, Corporate.", 400);
      }
      data.type = normalized;
    }
  }

  if (data.gender !== undefined) {
    const gender = String(data.gender || "").toLowerCase();
    if (gender && !["male", "female", "other"].includes(gender)) {
      throw fail("Invalid gender. Allowed values: male, female, other.", 400);
    }
    data.gender = gender;
  }

  if (data.openingBalance !== undefined) {
    data.openingBalance = parseMoney(data.openingBalance, "opening balance");
  }

  return data;
};

// ---------- Permission helpers ----------

const canViewSensitive = (req) => {
  const role = String(req.tenant?.role || req.user?.role || "").toLowerCase();
  if (role === "admin") return true;

  const permissions = req.user?.permissions || [];
  return (
    Array.isArray(permissions) &&
    (permissions.includes("customers.documents.view") ||
      permissions.includes("sensitive.view") ||
      permissions.includes("sensitive:view"))
  );
};

// Employees with customers.create / customers.update can upload documents.
// Viewing documents still requires customers.documents.view.
const canEditSensitive = (req) => {
  const role = String(req.tenant?.role || req.user?.role || "").toLowerCase();
  if (role === "admin") return true;

  const permissions = req.user?.permissions || [];
  if (!Array.isArray(permissions)) return false;

  return (
    permissions.includes("customers.create") ||
    permissions.includes("customers.update") ||
    permissions.includes("sensitive.edit") ||
    permissions.includes("sensitive:edit")
  );
};

// ---------- Guarantor helpers ----------

const hasOwn = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj || {}, key);

const toPlain = (value) => {
  if (!value) return {};
  return typeof value.toObject === "function" ? value.toObject() : { ...value };
};

const emptyGuarantor = () => ({
  enabled: false,
  name: "",
  mobile: "",
  photo: "",
  photoPublicId: "",
  cnicFront: "",
  cnicFrontPublicId: "",
  cnicBack: "",
  cnicBackPublicId: "",
  biometric: {
    thumbImage: "",
    scannedAt: null,
  },
});

const parseFlag = (value, label) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(text)) return true;
  if (["false", "0", "off", "no"].includes(text)) return false;
  throw fail(`${label}: invalid enabled flag.`, 400);
};

const collectGuarantorPublicIds = (guarantor) => {
  const g = toPlain(guarantor);
  return GUARANTOR_IMAGE_FIELDS.map(({ key }) => g[`${key}PublicId`]).filter(
    Boolean
  );
};

const readGuarantorInput = (req, index) => {
  const prefix = `guarantor${index}`;
  const body = req.body || {};
  const files = req.files || {};

  const enabled = parseFlag(body[`${prefix}Enabled`], `Guarantor ${index}`);

  const name = hasOwn(body, `${prefix}Name`)
    ? String(body[`${prefix}Name`] ?? "").trim()
    : undefined;

  const mobile = hasOwn(body, `${prefix}Mobile`)
    ? String(body[`${prefix}Mobile`] ?? "").replace(/[\s-]/g, "")
    : undefined;

  const imageFiles = {};
  for (const { key, suffix } of GUARANTOR_IMAGE_FIELDS) {
    imageFiles[key] = files[`${prefix}${suffix}`]?.[0] || null;
  }

  const thumbFile = files[`${prefix}ThumbImage`]?.[0] || null;

  const touched =
    enabled !== undefined ||
    name !== undefined ||
    mobile !== undefined ||
    Object.values(imageFiles).some(Boolean) ||
    Boolean(thumbFile);

  return {
    key: prefix,
    index,
    enabled,
    name,
    mobile,
    files: imageFiles,
    thumbFile,
    touched,
  };
};

const hasGuarantorInput = (req) =>
  GUARANTOR_INDEXES.some((index) => readGuarantorInput(req, index).touched);

// Validates one guarantor against what is already stored.
// Runs BEFORE any Cloudinary upload so bad requests cost nothing.
const resolveGuarantor = (input, current) => {
  const label = `Guarantor ${input.index}`;
  const base = {
    key: input.key,
    index: input.index,
    touched: input.touched,
    files: input.files,
    current,
  };

  if (!input.touched) return { ...base, enabled: Boolean(current.enabled) };

  const enabled =
    input.enabled !== undefined ? input.enabled : Boolean(current.enabled);

  // Disabled → any submitted guarantor data is ignored; stored data is removed.
  if (!enabled) return { ...base, enabled: false };

  const name =
    input.name !== undefined ? input.name : String(current.name || "").trim();
  const mobile =
    input.mobile !== undefined
      ? input.mobile
      : String(current.mobile || "").trim();

  if (!name) throw fail(`${label}: full name is required.`, 400);
  if (name.length < 2 || name.length > 120) {
    throw fail(`${label}: name must be between 2 and 120 characters.`, 400);
  }
  if (!mobile) throw fail(`${label}: mobile number is required.`, 400);
  if (!PK_MOBILE_REGEX.test(mobile)) {
    throw fail(
      `${label}: enter a valid Pakistani mobile number, for example 03001234567.`,
      400
    );
  }

  for (const { key, label: imageLabel } of GUARANTOR_IMAGE_FIELDS) {
    if (!input.files[key] && !current[key]) {
      throw fail(`${label}: ${imageLabel} is required.`, 400);
    }
  }

  return { ...base, enabled: true, name, mobile };
};

const planGuarantors = (req, existing) =>
  GUARANTOR_INDEXES.map((index) => {
    const input = readGuarantorInput(req, index);
    const current = toPlain(existing?.[input.key]);
    return resolveGuarantor(input, current);
  });

// Uploads new guarantor images and returns the sub-document to store.
// - uploadedPublicIds: new uploads (deleted if saving fails)
// - oldPublicIdsToDelete: replaced/removed images (deleted only after DB success)
const buildGuarantorDocument = async (
  plan,
  folder,
  uploadedPublicIds,
  oldPublicIdsToDelete,
  req // ← pass req so we can process the thumb
) => {
  const { current } = plan;

  if (!plan.enabled) {
    oldPublicIdsToDelete.push(...collectGuarantorPublicIds(current));
    return emptyGuarantor();
  }

  const doc = {
    enabled: true,
    name: plan.name,
    mobile: plan.mobile,
  };

  // ---- Cloudinary images (photo / CNIC) ----
  for (const { key } of GUARANTOR_IMAGE_FIELDS) {
    const file = plan.files[key];

    if (file) {
      const result = await uploadToCloudinary(
        file.buffer,
        `${folder}/guarantors`,
        "image",
        false
      );
      uploadedPublicIds.push(result.public_id);

      doc[key] = result.secure_url;
      doc[`${key}PublicId`] = result.public_id;

      if (current[`${key}PublicId`]) {
        oldPublicIdsToDelete.push(current[`${key}PublicId`]);
      }
    } else {
      doc[key] = current[key] || "";
      doc[`${key}PublicId`] = current[`${key}PublicId`] || "";
    }
  }

  // ---- Biometric (optional) ----
  const newBio = processGuarantorFingerprint(req, plan.index);
  if (newBio) {
    doc.biometric = newBio;
  } else {
    // keep whatever was already stored
    const existingBio = toPlain(current.biometric);
    doc.biometric = {
      thumbImage: existingBio.thumbImage || "",
      scannedAt: existingBio.scannedAt || null,
    };
  }

  return doc;
};

// Public shape of a guarantor. Name/mobile follow normal customer access;
// images are only included on detail responses for authorised users.
const formatGuarantor = (guarantor, { sensitive, documents }) => {
  const g = toPlain(guarantor);
  const enabled = Boolean(g.enabled);

  const out = {
    enabled,
    name: enabled ? g.name || "" : "",
    mobile: enabled ? g.mobile || "" : "",
    locked: !sensitive,
  };

  if (enabled && sensitive && documents) {
    out.photo = g.photo || "";
    out.cnicFront = g.cnicFront || "";
    out.cnicBack = g.cnicBack || "";
  }

  // ---------- Guarantor biometric ----------
  const bio = toPlain(g.biometric);
  const hasFingerprint = Boolean(bio.thumbImage);
  out.hasFingerprint = hasFingerprint;

  if (hasFingerprint) {
    out.biometric = {
      available: true,
      scannedAt: bio.scannedAt || null,
    };

    if (sensitive && documents) {
      try {
        const raw = decryptFingerprint(bio.thumbImage);
        const mime = detectImageMime(raw);
        out.biometric.thumbImage = `data:${mime};base64,${raw.toString("base64")}`;
      } catch {
        // leave image out; availability flag stays
      }
    }
  }

  return out;
};

const hasSensitiveFiles = (req) => {
  const files = req.files || {};
  return Boolean(
    files.cnicFront?.[0] ||
    files.cnicBack?.[0] ||
    files.licenseImage?.[0] ||
    files.thumbImage?.[0] ||
    files.guarantor1ThumbImage?.[0] ||
    files.guarantor2ThumbImage?.[0] ||
    hasGuarantorInput(req)
  );
};

const canViewBookings = (req) => {
  const role = String(req.tenant?.role || req.user?.role || "").toLowerCase();
  if (role === "admin") return true;
  const permissions = req.user?.permissions || [];
  return Array.isArray(permissions) && permissions.includes("bookings.view");
};

const canViewPayments = (req) => {
  const role = String(req.tenant?.role || req.user?.role || "").toLowerCase();
  if (role === "admin") return true;
  const permissions = req.user?.permissions || [];
  return Array.isArray(permissions) && permissions.includes("payments.view");
};

const canViewCustomerFinancials = (req) =>
  canViewBookings(req) && canViewPayments(req);

const maskCNIC = (value) => {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 13) return "*****-*******-*";
  return `${digits.slice(0, 2)}***-*******-${digits.slice(-1)}`;
};

// ---------- Biometric / fingerprint helpers ----------

const getBiometricKey = () => {
  const secret = process.env[BIOMETRIC_KEY_ENV];
  if (!secret || String(secret).trim().length < 8) {
    throw fail("Biometric encryption is not configured on the server.", 500);
  }

  // Derive a full 32-byte AES-256 key from any passphrase (including a short 12-char one).
  // scrypt is intentionally slow to resist brute-force on short secrets.
  return crypto.scryptSync(String(secret).trim(), "rentacar-biometric-v1", 32);
};

const encryptFingerprint = (buffer) => {
  const key = getBiometricKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: iv (12) + authTag (16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
};

const decryptFingerprint = (encoded) => {
  const key = getBiometricKey();
  const data = Buffer.from(String(encoded), "base64");
  if (data.length < 28) {
    throw new Error("Invalid fingerprint payload.");
  }

  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

const detectImageMime = (buffer) => {
  if (!buffer || buffer.length < 4) return "image/png";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  return "image/png";
};

/**
 * Validate + encrypt an incoming fingerprint file.
 * @param {object} file  – multer file object (or null)
 * @param {string|boolean|undefined} consentRaw – body flag (biometricConsent / guarantorNBiometricConsent)
 * @param {string} label – used in error messages ("Customer" / "Guarantor 1" …)
 * @returns {{ thumbImage: string, scannedAt: Date } | null}
 */
const processFingerprintFile = (file, consentRaw, label = "Customer") => {
  if (!file) return null;

  const mime = String(file.mimetype || "").toLowerCase();
  if (!FINGERPRINT_ALLOWED_MIME.has(mime)) {
    throw fail(`${label} fingerprint image must be PNG or JPEG.`, 400);
  }
  if (file.size > FINGERPRINT_MAX_BYTES) {
    throw fail(`${label} fingerprint image must be smaller than 1 MB.`, 400);
  }

  const consent = parseFlag(consentRaw, `${label} biometric consent`);
  if (consent !== true) {
    throw fail(
      `${label} consent is required before storing a fingerprint image.`,
      400
    );
  }

  return {
    thumbImage: encryptFingerprint(file.buffer),
    scannedAt: new Date(),
  };
};

// Convenience wrappers
const processCustomerFingerprint = (req) =>
  processFingerprintFile(
    (req.files || {}).thumbImage?.[0],
    req.body?.biometricConsent,
    "Customer"
  );

const processGuarantorFingerprint = (req, index) =>
  processFingerprintFile(
    (req.files || {})[`guarantor${index}ThumbImage`]?.[0],
    req.body?.[`guarantor${index}BiometricConsent`],
    `Guarantor ${index}`
  );

// ---------- Formatting ----------

const formatCustomer = (customer, req, { documents = false } = {}) => {
  const c = customer?.toObject ? customer.toObject() : { ...customer };

  const sensitive = canViewSensitive(req);
  const financialAccess = canViewCustomerFinancials(req);
  const bookingAccess = canViewBookings(req);

  const formatted = {
    ...c,
    id: String(c._id),
    mobile: c.phone || "",
    licenseNo: sensitive ? (c.licenseNumber || "") : "",
    cnic: sensitive ? (c.cnic || "") : maskCNIC(c.cnic),
    status:
      c.status === "inactive"
        ? "Inactive"
        : c.status === "blocked"
          ? "Blocked"
          : "Active",
    type: c.type || "",
    totalBookings: bookingAccess
      ? (c.totalBookings == null ? 0 : number(c.totalBookings))
      : null,
    totalSpent: financialAccess
      ? (c.totalSpent == null ? 0 : number(c.totalSpent))
      : null,
    received: financialAccess
      ? (c.received == null ? 0 : number(c.received))
      : null,
    pending: financialAccess
      ? (c.pending == null ? 0 : number(c.pending))
      : null,
    locked: !sensitive,
  };

  if (!sensitive) {
    for (const field of SENSITIVE_FIELDS) {
      if (field !== "cnic") delete formatted[field];
    }
  }

  // Guarantors: rebuilt explicitly so Cloudinary ids never leak
  for (const index of GUARANTOR_INDEXES) {
    formatted[`guarantor${index}`] = formatGuarantor(c[`guarantor${index}`], {
      sensitive,
      documents,
    });
  }

  // Opening balance is admin-only
  if (req.tenant?.role !== "admin") {
    delete formatted.openingBalance;
  }

  if (!bookingAccess) delete formatted.bookings;
  if (!canViewPayments(req) || !bookingAccess) delete formatted.payments;

  // ---------- Biometric / fingerprint ----------
  // Never leak the encrypted payload. List views only get availability.
  // Detail views for authorised users also receive a printable data-URL.
  delete formatted.biometric;

  const bio = toPlain(c.biometric);
  const hasFingerprint = Boolean(bio.thumbImage);
  formatted.hasFingerprint = hasFingerprint;

  if (hasFingerprint) {
    formatted.biometric = {
      available: true,
      scannedAt: bio.scannedAt || null,
    };

    if (sensitive && documents) {
      try {
        const raw = decryptFingerprint(bio.thumbImage);
        const mime = detectImageMime(raw);
        formatted.biometric.thumbImage = `data:${mime};base64,${raw.toString("base64")}`;
      } catch {
        // Decrypt failure → leave the image out; availability flag remains.
      }
    }
  }

  delete formatted.__v;
  delete formatted._id;
  delete formatted.photoPublicId;
  delete formatted.cnicFrontPublicId;
  delete formatted.cnicBackPublicId;
  delete formatted.licenseImagePublicId;

  return formatted;
};

// ---------- Filters & sorting ----------

const customerFilter = (req) => {
  const filter = {
    ...scope(req, "Customer"),
    ...dateWindow(req.query, "createdAt"),
  };

  const { search, city, type, status } = req.query;

  if (search) {
    const regex = escapeRegex(String(search).trim().slice(0, 80));
    const searchable = canViewSensitive(req)
      ? SEARCH_FIELDS
      : SEARCH_FIELDS.filter((f) => !["cnic", "licenseNumber"].includes(f));

    filter.$or = searchable.map((field) => ({
      [field]: { $regex: regex, $options: "i" },
    }));
  }

  if (city) {
    filter.city = {
      $regex: `^${escapeRegex(String(city).trim())}$`,
      $options: "i",
    };
  }

  if (type) {
    if (String(type).toLowerCase() === "none") {
      filter.type = { $in: ["", null] };
    } else {
      const normalized = normalizeType(type);
      if (!normalized) throw fail("Invalid customer type filter.", 400);
      filter.type = normalized;
    }
  }

  if (status) {
    const normalized = normalizeStatus(status);
    if (!normalized) throw fail("Invalid customer status filter.", 400);
    filter.status = normalized;
  }

  return filter;
};

const getSort = (value) => {
  const [field, direction] = String(value || "createdAt:desc").split(":");
  if (!SORT_FIELDS.includes(field)) return { createdAt: -1, _id: -1 };
  const dir = direction === "asc" ? 1 : -1;
  return { [field]: dir, _id: dir };
};

// ======================================================
// FINANCIAL HELPERS
// ======================================================

const getBookingAmount = (booking) =>
  number(
    booking.totalAmount ??
    booking.total ??
    booking.grandTotal ??
    booking.finalAmount ??
    0
  );

const isRentalPayment = (payment) => {
  const type = String(payment.type || "").toLowerCase();
  const status = String(payment.status || "").toLowerCase();
  if (["security_deposit", "security_refund", "refund"].includes(type)) return false;
  if (status !== "completed") return false;
  return true;
};

const isRentalRefund = (payment) => {
  const type = String(payment.type || "").toLowerCase();
  const status = String(payment.status || "").toLowerCase();
  return type === "refund" && status === "completed";
};

const requireCustomer = async (req) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw fail("Invalid customer ID.", 400);
  }

  const customer = await Customer.findOne({
    _id: req.params.id,
    ...scope(req, "Customer"),
  }).select("+biometric.thumbImage");

  if (!customer) {
    throw fail("Customer not found or access denied.", 404);
  }
  return customer;
};

const getCustomerFinancials = async (customer, req) => {
  const bookingAccess = canViewBookings(req);
  const paymentAccess = canViewPayments(req);
  const financialAccess = canViewCustomerFinancials(req);

  const bookings = bookingAccess
    ? await Booking.find({
      ...scope(req, "Booking"),
      customerId: customer._id,
    })
      .sort({ createdAt: -1 })
      .lean()
    : [];

  const bookingIds = bookings.map((b) => b._id);

  const payments =
    bookingAccess && paymentAccess && bookingIds.length
      ? await Payment.find({
        ...tenantOnly(req),
        bookingId: { $in: bookingIds },
      })
        .sort({ paymentDate: -1, _id: -1 })
        .lean()
      : [];

  const totalSpent = bookings
    .filter((b) => b.status !== "cancelled")
    .reduce((sum, b) => sum + getBookingAmount(b), 0);

  const received = payments.reduce((sum, p) => {
    if (isRentalPayment(p)) return sum + number(p.amount);
    if (isRentalRefund(p)) return sum - number(p.amount);
    return sum;
  }, 0);

  // Always calculate with opening balance for accuracy.
  // The field itself is hidden from non-admins in formatCustomer.
  const openingBalance = number(customer.openingBalance);

  return {
    totalBookings: bookingAccess ? bookings.length : null,
    totalSpent: financialAccess ? roundMoney(totalSpent) : null,
    received: financialAccess ? roundMoney(received) : null,
    pending: financialAccess
      ? roundMoney(openingBalance + totalSpent - received)
      : null,
    bookings,
    payments,
  };
};

// ======================================================
// BATCH FINANCIAL ENRICHMENT
// ======================================================

const enrichCustomers = async (req, customers) => {
  if (!customers.length) return [];

  const bookingAccess = canViewBookings(req);
  const financialAccess = canViewCustomerFinancials(req);

  if (!bookingAccess) {
    return customers.map((c) => ({
      ...c,
      totalBookings: null,
      totalSpent: null,
      received: null,
      pending: null,
    }));
  }

  const customerIds = customers.map((c) => c._id);

  const bookings = await Booking.find({
    ...scope(req, "Booking"),
    customerId: { $in: customerIds },
  })
    .select("_id customerId status totalAmount")
    .lean();

  const bookingIds = bookings.map((b) => b._id);

  const payments =
    financialAccess && bookingIds.length
      ? await Payment.find({
        ...tenantOnly(req),
        bookingId: { $in: bookingIds },
        status: "completed",
      })
        .select("bookingId amount type status")
        .lean()
      : [];

  const metrics = new Map(
    customerIds.map((id) => [
      String(id),
      { totalBookings: 0, totalSpent: 0, received: 0 },
    ])
  );

  const bookingCustomers = new Map();

  for (const booking of bookings) {
    const key = String(booking.customerId);
    const metric = metrics.get(key);
    if (!metric) continue;

    bookingCustomers.set(String(booking._id), key);
    metric.totalBookings += 1;
    if (booking.status !== "cancelled") {
      metric.totalSpent += number(booking.totalAmount);
    }
  }

  for (const payment of payments) {
    const customerId = bookingCustomers.get(String(payment.bookingId));
    const metric = metrics.get(customerId);
    if (!metric) continue;

    if (isRentalPayment(payment)) {
      metric.received += number(payment.amount);
    } else if (isRentalRefund(payment)) {
      metric.received -= number(payment.amount);
    }
  }

  return customers.map((customer) => {
    const metric = metrics.get(String(customer._id)) || {
      totalBookings: 0,
      totalSpent: 0,
      received: 0,
    };

    if (!financialAccess) {
      return {
        ...customer,
        totalBookings: metric.totalBookings,
        totalSpent: null,
        received: null,
        pending: null,
      };
    }

    const openingBalance = number(customer.openingBalance);

    return {
      ...customer,
      totalBookings: metric.totalBookings,
      totalSpent: roundMoney(metric.totalSpent),
      received: roundMoney(metric.received),
      pending: roundMoney(openingBalance + metric.totalSpent - metric.received),
    };
  });
};

// ======================================================
// LICENSE EXPIRY REMINDERS
// ======================================================

export async function collectCustomerReminders(req, daysBefore = 7) {
  if (!canViewSensitive(req)) return [];

  const requestedDays = Number(daysBefore);
  const horizonDays = Number.isFinite(requestedDays)
    ? Math.max(0, Math.min(365, Math.floor(requestedDays)))
    : 7;

  const Setting = mongoose.models.Setting;
  let timezone = "Asia/Karachi";

  if (Setting) {
    const setting = await Setting.findOne(tenantOnly(req))
      .select("timezone")
      .lean();
    if (setting?.timezone) timezone = setting.timezone;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "Asia/Karachi";
  }

  const dateParts = (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
    };
  };

  const calendarNumber = ({ year, month, day }) =>
    Math.floor(Date.UTC(year, month - 1, day) / 86400000);

  const dateKey = ({ year, month, day }) =>
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const todayNumber = calendarNumber(dateParts(new Date()));

  const customers = await Customer.find({
    ...scope(req, "Customer"),
    licenseExpiry: { $exists: true, $ne: null },
    status: { $ne: "blocked" },
  })
    .select("_id name licenseExpiry")
    .lean();

  const reminders = [];

  for (const customer of customers) {
    const expiry = new Date(customer.licenseExpiry);
    if (Number.isNaN(expiry.getTime())) continue;

    const expiryParts = dateParts(expiry);
    const expiryKey = dateKey(expiryParts);
    const daysRemaining = calendarNumber(expiryParts) - todayNumber;

    if (daysRemaining > horizonDays) continue;

    const category =
      daysRemaining < 0 ? "overdue" : daysRemaining <= 3 ? "due_soon" : "upcoming";
    const priority =
      daysRemaining <= 1 ? "high" : daysRemaining <= 3 ? "medium" : "low";

    const customerId = String(customer._id);
    const message =
      daysRemaining < 0
        ? `Driving licence for ${customer.name} expired ${Math.abs(daysRemaining)} day(s) ago.`
        : daysRemaining === 0
          ? `Driving licence for ${customer.name} expires today.`
          : `Driving licence for ${customer.name} expires in ${daysRemaining} day(s).`;

    reminders.push({
      id: `customer-${customerId}-license-${expiryKey}`,
      customerId,
      customerName: customer.name || "",
      type: "customer_license_expiry",
      source: "customer",
      message,
      dueDate: expiry,
      daysRemaining,
      priority,
      category,
    });
  }

  const categoryOrder = { overdue: 0, due_soon: 1, upcoming: 2 };
  reminders.sort(
    (a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category] ||
      new Date(a.dueDate) - new Date(b.dueDate)
  );

  return reminders;
}

// ======================================================
// LIST CUSTOMERS
// ======================================================

export const listCustomers = wrap(async (req, res) => {
  const filter = customerFilter(req);
  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });
  const sort = getSort(req.query.sort);
  const [sortField, sortDirection] = Object.entries(sort)[0];
  const needsComputedSort = !DB_SORT_FIELDS.includes(sortField);
  const hasDuesOnly = String(req.query.hasDues) === "true";

  const financialAccess = canViewCustomerFinancials(req);
  const bookingAccess = canViewBookings(req);

  if (
    !financialAccess &&
    (hasDuesOnly || ["totalSpent", "pending"].includes(sortField))
  ) {
    throw fail(
      "You do not have permission to filter or sort customer financial information.",
      403
    );
  }

  if (!bookingAccess && sortField === "totalBookings") {
    throw fail("You do not have permission to sort by booking totals.", 403);
  }

  const baseScope = scope(req, "Customer");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalCount, activeCount, newThisMonthCount] = await Promise.all([
    Customer.countDocuments(baseScope),
    Customer.countDocuments({ ...baseScope, status: "active" }),
    Customer.countDocuments({ ...baseScope, createdAt: { $gte: monthStart } }),
  ]);

  let items = [];
  let total = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  // Always select the encrypted thumb so we can report hasFingerprint
  // without ever exposing the ciphertext in the response.
  const biometricSelect = `+biometric.thumbImage ${GUARANTOR_BIOMETRIC_SELECT}`;

  if (!needsComputedSort && !hasDuesOnly) {
    const [dbItems, dbTotal] = await Promise.all([
      Customer.find(filter)
        .select(biometricSelect)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    const enriched = await enrichCustomers(req, dbItems);
    items = enriched.map((c) => formatCustomer(c, req));
    total = dbTotal;

    if (financialAccess) {
      const allMatching = await Customer.find(filter)
        .select("_id openingBalance")
        .lean();
      if (allMatching.length) {
        const allEnriched = await enrichCustomers(req, allMatching);
        pendingCount = allEnriched.filter((c) => c.pending > 0).length;
        pendingAmount = allEnriched.reduce(
          (sum, c) => sum + Math.max(0, number(c.pending)),
          0
        );
      }
    }
  } else {
    const filtered = await Customer.find(filter).select(biometricSelect).lean();
    let enriched = await enrichCustomers(req, filtered);

    if (hasDuesOnly) {
      enriched = enriched.filter((c) => number(c.pending) > 0);
    }

    enriched.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === bv) {
        return String(a._id).localeCompare(String(b._id)) * sortDirection;
      }
      const cmp =
        typeof av === "string"
          ? String(av).localeCompare(String(bv || ""))
          : number(av) - number(bv);
      return cmp * sortDirection;
    });

    total = enriched.length;

    if (financialAccess) {
      pendingCount = enriched.filter((c) => number(c.pending) > 0).length;
      pendingAmount = enriched.reduce(
        (sum, c) => sum + Math.max(0, number(c.pending)),
        0
      );
    }

    items = enriched
      .slice((page - 1) * limit, page * limit)
      .map((c) => formatCustomer(c, req));
  }

  const summary = {
    total: totalCount,
    active: activeCount,
    pending: financialAccess ? pendingCount : null,
    pendingAmount: financialAccess ? roundMoney(pendingAmount) : null,
    newThisMonth: newThisMonthCount,
  };

  send(
    res,
    {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
      summary,
    },
    "Customers loaded successfully."
  );
});

// ======================================================
// GET CUSTOMER DETAILS
// ======================================================

export const getCustomer = wrap(async (req, res) => {
  const customer = await requireCustomer(req);
  const financials = await getCustomerFinancials(customer, req);

  const bookings = (financials.bookings || []).map((booking) => ({
    id: String(booking._id),
    number: booking.bookingNumber || "",
    carId: String(booking.carId || ""),
    pickupAt: booking.pickupDate || null,
    returnAt: booking.returnDate || null,
    total: canViewCustomerFinancials(req) ? getBookingAmount(booking) : null,
    displayStatus: booking.status,
    status: booking.status,
  }));

  const payments = (financials.payments || []).map((payment) => ({
    id: String(payment._id),
    bookingId: String(payment.bookingId || ""),
    type: payment.type || "",
    amount: number(payment.amount),
    method: payment.method || "",
    receiptNo: payment.paymentNumber || "",
    date: payment.paymentDate || payment.createdAt,
    status: payment.status,
  }));

  const base = customer?.toObject ? customer.toObject() : { ...customer };

  send(
    res,
    formatCustomer(
      {
        ...base,
        totalBookings: financials.totalBookings,
        totalSpent: financials.totalSpent,
        received: financials.received,
        pending: financials.pending,
        bookings: canViewBookings(req) ? bookings : undefined,
        payments:
          canViewBookings(req) && canViewPayments(req) ? payments : undefined,
      },
      req,
      { documents: true }
    ),
    "Customer details loaded successfully."
  );
});

// ======================================================
// CREATE CUSTOMER (with images)
// ======================================================

export const createCustomer = wrap(async (req, res) => {
  const data = getEditableData(req.body);

  if (req.tenant?.role === "employee" && data.openingBalance !== undefined) {
    throw fail("Opening balance can only be set by an administrator.", 403);
  }

  if (!data.name || !data.phone) {
    throw fail("Customer name and mobile number are required.", 400);
  }

  // Check both body fields and uploaded files
  if (
    !canEditSensitive(req) &&
    (SENSITIVE_FIELDS.some((field) => data[field] !== undefined) ||
      hasSensitiveFiles(req))
  ) {
    throw fail(
      "You do not have permission to save sensitive customer information.",
      403
    );
  }

  const tenant = tenantOnly(req);

  if (data.cnic) {
    const exists = await Customer.exists({ ...tenant, cnic: data.cnic });
    if (exists) throw fail("A customer with this CNIC already exists.", 409);
  }

  if (data.customerCode) {
    const exists = await Customer.exists({
      ...tenant,
      customerCode: data.customerCode,
    });
    if (exists) throw fail("Customer code already exists.", 409);
  }

  // Validate guarantors BEFORE uploading anything
  const guarantorPlans = planGuarantors(req, null);

  // Validate + encrypt fingerprint BEFORE any Cloudinary work
  const biometricDoc = processCustomerFingerprint(req);
  if (biometricDoc) {
    data.biometric = biometricDoc;
  }

  const uploadedPublicIds = [];
  const folder = `rent-a-car/${req.tenant.businessId}/customers`;

  try {
    const files = req.files || {};

    // Upload sequentially so we know exactly which files succeeded
    const uploadOne = async (fieldName) => {
      const file = files[fieldName]?.[0];
      if (!file) return null;

      console.log("CLOUDINARY DEBUG:", {
        businessId: req.tenant?.businessId,
        businessIdType: typeof req.tenant?.businessId,
        folder,
        uploadedFields: Object.keys(req.files || {}),
      });

      const result = await uploadToCloudinary(
        file.buffer,
        folder,
        "image",
        false
      );
      uploadedPublicIds.push(result.public_id);
      return result;
    };

    const photoResult = await uploadOne("photo");
    const cnicFrontResult = await uploadOne("cnicFront");
    const cnicBackResult = await uploadOne("cnicBack");
    const licenseResult = await uploadOne("licenseImage");

    if (photoResult) {
      data.photo = photoResult.secure_url;
      data.photoPublicId = photoResult.public_id;
    }
    if (cnicFrontResult) {
      data.cnicFront = cnicFrontResult.secure_url;
      data.cnicFrontPublicId = cnicFrontResult.public_id;
    }
    if (cnicBackResult) {
      data.cnicBack = cnicBackResult.secure_url;
      data.cnicBackPublicId = cnicBackResult.public_id;
    }
    if (licenseResult) {
      data.licenseImage = licenseResult.secure_url;
      data.licenseImagePublicId = licenseResult.public_id;
    }

    for (const plan of guarantorPlans) {
      if (!plan.touched) continue;
      data[plan.key] = await buildGuarantorDocument(
        plan,
        folder,
        uploadedPublicIds,
        [],          // create has no old images
        req
      );
    }

    const created = await Customer.create({
      ...data,
      ...tenant,
      createdBy: req.tenant.userId,
    });

    // DB succeeded → do NOT clean up the new images
    send(
      res,
      formatCustomer(created, req, { documents: true }),
      "Customer created successfully.",
      201
    );
  } catch (err) {
    // Only clean up when the whole operation failed
    if (uploadedPublicIds.length) {
      await Promise.allSettled(
        uploadedPublicIds.map((id) =>
          deleteFromCloudinary(id, "image", "upload")
        )
      );
    }

    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "";
      if (key.includes("cnic")) {
        throw fail("A customer with this CNIC already exists.", 409);
      }
      if (key.includes("customerCode")) {
        throw fail("Customer code already exists.", 409);
      }
      throw fail("This customer record already exists.", 409);
    }
    throw err;
  }
});

// ======================================================
// UPDATE CUSTOMER (with image replacement)
// ======================================================

export const updateCustomer = wrap(async (req, res) => {
  const data = getEditableData(req.body);

  if (req.tenant?.role === "employee" && data.openingBalance !== undefined) {
    throw fail("Opening balance can only be changed by an administrator.", 403);
  }

  // Proper image-only update support
  const hasFiles = Object.values(req.files || {}).some(
    (files) => Array.isArray(files) && files.length > 0
  );

  if (!Object.keys(data).length && !hasFiles && !hasGuarantorInput(req)) {
    throw fail("Please provide customer information to update.", 400);
  }

  // Check both body fields and uploaded files
  if (
    !canEditSensitive(req) &&
    (SENSITIVE_FIELDS.some((field) => data[field] !== undefined) ||
      hasSensitiveFiles(req))
  ) {
    throw fail(
      "You do not have permission to update sensitive customer information.",
      403
    );
  }

  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw fail("Invalid customer ID.", 400);
  }

  const filter = {
    _id: req.params.id,
    ...scope(req, "Customer"),
  };

  const existing = await Customer.findOne(filter).select(
    `+photoPublicId +cnicFrontPublicId +cnicBackPublicId +licenseImagePublicId +biometric.thumbImage ${GUARANTOR_PUBLIC_ID_SELECT} ${GUARANTOR_BIOMETRIC_SELECT}`
  );
  if (!existing) {
    throw fail("Customer not found or access denied.", 404);
  }

  if (data.cnic && data.cnic !== existing.cnic) {
    const duplicate = await Customer.exists({
      ...tenantOnly(req),
      _id: { $ne: existing._id },
      cnic: data.cnic,
    });
    if (duplicate) throw fail("Another customer already has this CNIC.", 409);
  }

  if (data.customerCode && data.customerCode !== existing.customerCode) {
    const duplicate = await Customer.exists({
      ...tenantOnly(req),
      _id: { $ne: existing._id },
      customerCode: data.customerCode,
    });
    if (duplicate) throw fail("Customer code already exists.", 409);
  }

  // Validate guarantors BEFORE uploading anything
  const guarantorPlans = planGuarantors(req, existing);

  // Validate + encrypt fingerprint BEFORE any Cloudinary work.
  // If no new file is supplied the existing fingerprint is left untouched.
  const biometricDoc = processCustomerFingerprint(req);
  if (biometricDoc) {
    data.biometric = biometricDoc;
  }

  const uploadedPublicIds = [];
  const oldPublicIdsToDelete = [];
  const folder = `rent-a-car/${req.tenant.businessId}/customers`;

  try {
    const files = req.files || {};

    // Sequential uploads
    const uploadOne = async (fieldName) => {
      const file = files[fieldName]?.[0];
      if (!file) return null;

      const started = Date.now();

      console.log(`[UPLOAD START] ${fieldName}`, {
        sizeKB: Math.round(file.size / 1024),
      });

      try {
        const result = await uploadToCloudinary(
          file.buffer,
          folder,
          "image",
          false
        );

        uploadedPublicIds.push(result.public_id);

        console.log(`[UPLOAD SUCCESS] ${fieldName}`, {
          durationMs: Date.now() - started,
        });

        return result;
      } catch (error) {
        console.error(`[UPLOAD FAILED] ${fieldName}`, {
          durationMs: Date.now() - started,
          message: error.message,
        });

        throw error;
      }
    };

    const photoResult = await uploadOne("photo", "photoPublicId");
    const cnicFrontResult = await uploadOne("cnicFront", "cnicFrontPublicId");
    const cnicBackResult = await uploadOne("cnicBack", "cnicBackPublicId");
    const licenseResult = await uploadOne("licenseImage", "licenseImagePublicId");

    if (photoResult) {
      data.photo = photoResult.secure_url;
      data.photoPublicId = photoResult.public_id;
    }
    if (cnicFrontResult) {
      data.cnicFront = cnicFrontResult.secure_url;
      data.cnicFrontPublicId = cnicFrontResult.public_id;
    }
    if (cnicBackResult) {
      data.cnicBack = cnicBackResult.secure_url;
      data.cnicBackPublicId = cnicBackResult.public_id;
    }
    if (licenseResult) {
      data.licenseImage = licenseResult.secure_url;
      data.licenseImagePublicId = licenseResult.public_id;
    }

    for (const plan of guarantorPlans) {
      if (!plan.touched) continue;
      data[plan.key] = await buildGuarantorDocument(
        plan,
        folder,
        uploadedPublicIds,
        oldPublicIdsToDelete,   // or [] on create
        req
      );
    }

    const updated = await Customer.findOneAndUpdate(
      filter,
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!updated) {
      throw fail("Customer not found or access denied.", 404);
    }

    // DB succeeded → delete OLD images only
    if (oldPublicIdsToDelete.length) {
      await Promise.allSettled(
        oldPublicIdsToDelete.map((id) =>
          deleteFromCloudinary(id, "image", "upload")
        )
      );
    }

    send(
      res,
      formatCustomer(updated, req, { documents: true }),
      "Customer updated successfully."
    );
  } catch (err) {
    // Only clean up NEW uploads if the whole operation failed
    if (uploadedPublicIds.length) {
      await Promise.allSettled(
        uploadedPublicIds.map((id) =>
          deleteFromCloudinary(id, "image", "upload")
        )
      );
    }

    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "";
      if (key.includes("cnic")) {
        throw fail("Another customer already has this CNIC.", 409);
      }
      if (key.includes("customerCode")) {
        throw fail("Customer code already exists.", 409);
      }
      throw fail("This customer record already exists.", 409);
    }
    throw err;
  }
});

// ======================================================
// DELETE CUSTOMER (with image cleanup)
// ======================================================

export const deleteCustomer = wrap(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    throw fail("Invalid customer ID.", 400);
  }

  const customer = await Customer.findOne({
    _id: req.params.id,
    ...scope(req, "Customer"),
  }).select(
    `+photoPublicId +cnicFrontPublicId +cnicBackPublicId +licenseImagePublicId +biometric.thumbImage ${GUARANTOR_PUBLIC_ID_SELECT} ${GUARANTOR_BIOMETRIC_SELECT}`
  );

  if (!customer) {
    throw fail("Customer not found or access denied.", 404);
  }

  // Protect against deleting customers with booking history
  const linkedBooking = await Booking.exists({
    ...tenantOnly(req),
    customerId: customer._id,
  });

  if (linkedBooking) {
    throw fail(
      "This customer has booking history and cannot be deleted. Mark the customer inactive instead.",
      409
    );
  }

  const result = await Customer.deleteOne({
    _id: customer._id,
    ...scope(req, "Customer"),
  });

  if (result.deletedCount === 0) {
    throw fail("Customer not found or access denied.", 404);
  }

  // Clean up Cloudinary images after successful deletion.
  // Fingerprint data lives only in the document and is removed with it.
  const publicIds = [
    customer.photoPublicId,
    customer.cnicFrontPublicId,
    customer.cnicBackPublicId,
    customer.licenseImagePublicId,
    ...collectGuarantorPublicIds(customer.guarantor1),
    ...collectGuarantorPublicIds(customer.guarantor2),
  ].filter(Boolean);

  if (publicIds.length) {
    await Promise.allSettled(
      publicIds.map((id) => deleteFromCloudinary(id, "image", "upload"))
    );
  }

  send(res, { id: String(customer._id) }, "Customer deleted successfully.");
});

// ======================================================
// CUSTOMER BOOKINGS
// ======================================================

export const getCustomerBookings = wrap(async (req, res) => {
  const customer = await requireCustomer(req);

  const filter = {
    ...scope(req, "Booking"),
    customerId: customer._id,
  };

  if (req.query.status) {
    const allowed = ["reserved", "on_rent", "completed", "cancelled"];
    const status = String(req.query.status).toLowerCase();
    if (!allowed.includes(status)) {
      throw fail("Invalid booking status filter.", 400);
    }
    filter.status = status;
  }

  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);

  const financialAccess = canViewCustomerFinancials(req);

  const items = bookings.map((booking) => ({
    id: String(booking._id),
    bookingNumber: booking.bookingNumber || "",
    customerId: String(booking.customerId),
    carId: String(booking.carId || ""),
    status: booking.status,
    pickupAt: booking.pickupDate || null,
    returnAt: booking.returnDate || null,
    total: financialAccess ? getBookingAmount(booking) : null,
  }));

  send(
    res,
    {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Customer bookings loaded successfully."
  );
});

// ======================================================
// CUSTOMER PAYMENTS
// ======================================================

export const getCustomerPayments = wrap(async (req, res) => {
  const customer = await requireCustomer(req);

  const bookings = await Booking.find({
    ...scope(req, "Booking"),
    customerId: customer._id,
  })
    .select("_id")
    .lean();

  const bookingIds = bookings.map((b) => b._id);
  const { page, limit } = paging({
    ...req.query,
    limit: req.query.pageSize || req.query.limit,
  });

  if (!bookingIds.length) {
    return send(
      res,
      {
        items: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      },
      "Customer payments loaded successfully."
    );
  }

  const filter = {
    ...tenantOnly(req),
    bookingId: { $in: bookingIds },
  };

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  const items = payments.map((payment) => ({
    id: String(payment._id),
    bookingId: String(payment.bookingId || ""),
    paymentNumber: payment.paymentNumber || "",
    type: payment.type || "",
    amount: number(payment.amount),
    method: payment.method || "",
    status: payment.status,
    date: payment.paymentDate || payment.createdAt,
    transactionReference: payment.transactionReference || "",
    notes: payment.notes || "",
  }));

  send(
    res,
    {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    },
    "Customer payments loaded successfully."
  );
});
