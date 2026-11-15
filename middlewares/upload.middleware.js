
import multer from "multer";

// ======================================================
// CONFIGURATION
// ======================================================

const MB = 1024 * 1024;

const IMAGE_MAX_SIZE = 5 * MB;
const DOCUMENT_MAX_SIZE = 10 * MB;
const VIDEO_MAX_SIZE = 50 * MB;

const MAX_FILES = 10;

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
];

const VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
];

const ALL_TYPES = [
  ...new Set([
    ...IMAGE_TYPES,
    ...DOCUMENT_TYPES,
    ...VIDEO_TYPES,
  ]),
];

// ======================================================
// STORAGE
// ======================================================

// Files remain in memory until uploaded to Cloudinary.
// No files are saved to the server filesystem.

const storage = multer.memoryStorage();

// ======================================================
// FILE FILTER
// ======================================================

const createFileFilter = (allowedTypes) => {
  return (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error(
        `Unsupported file type: ${file.mimetype}. Allowed: ${allowedTypes.join(", ")}`
      );

      error.status = 400;
      return cb(error);
    }

    cb(null, true);
  };
};

// ======================================================
// MULTER FACTORY
// ======================================================

const createUploader = ({
  allowedTypes,
  maxSize,
  maxFiles = MAX_FILES,
}) => {
  return multer({
    storage,

    limits: {
      fileSize: maxSize,
      files: maxFiles,
      fields: 30,
      fieldSize: 64 * 1024,
      parts: maxFiles + 30,
    },

    fileFilter: createFileFilter(allowedTypes),
  });
};

// ======================================================
// REUSABLE UPLOAD MIDDLEWARE
// ======================================================

// General upload: images, PDFs and videos.
// The 50 MB limit applies to every file accepted here.
// Use a narrower uploader when possible.

const upload = createUploader({
  allowedTypes: ALL_TYPES,
  maxSize: VIDEO_MAX_SIZE,
});

// Images only: avatars, logos, car images.
export const uploadImages = createUploader({
  allowedTypes: IMAGE_TYPES,
  maxSize: IMAGE_MAX_SIZE,
});

// Documents: JPG, PNG, WEBP and PDF.
export const uploadDocuments = createUploader({
  allowedTypes: DOCUMENT_TYPES,
  maxSize: DOCUMENT_MAX_SIZE,
});

// Videos only.
export const uploadVideos = createUploader({
  allowedTypes: VIDEO_TYPES,
  maxSize: VIDEO_MAX_SIZE,
});

// ======================================================
// COMMON ERROR HANDLER
// ======================================================

// Use this wrapper around upload middleware to return
// consistent JSON errors instead of unhandled Multer errors.

export const handleUpload = (middleware) => {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE:
            "Uploaded file exceeds the allowed size.",
          LIMIT_FILE_COUNT:
            "Too many files uploaded.",
          LIMIT_UNEXPECTED_FILE:
            "Unexpected upload field or too many files.",
          LIMIT_FIELD_COUNT:
            "Too many form fields.",
          LIMIT_FIELD_VALUE:
            "A form field is too large.",
          LIMIT_PART_COUNT:
            "Too many multipart form parts.",
          LIMIT_FIELD_KEY:
            "A form field name is too long.",
        };

        return res.status(
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400
        ).json({
          success: false,
          message:
            messages[error.code] ||
            "Invalid file upload.",
        });
      }

      return res.status(error.status || 400).json({
        success: false,
        message: error.message || "File upload failed.",
      });
    });
  };
};

export default upload;
