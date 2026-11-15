import { Router } from "express";
import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";
import {
  uploadImages,
  uploadDocuments,
  handleUpload,
} from "../middlewares/upload.middleware.js";

import {
  listDocuments,
  uploadDocument,
  replaceDocument,
  deleteDocument,
} from "../controllers/documentController.js";

import {
  listDocumentsQuerySchema,
  uploadDocumentSchema,
  replaceDocumentSchema,
  documentIdSchema,
} from "../validations/documentValidation.js"; // create this small validation file if you want

const router = Router();

router.use(authenticate, tenantMiddleware, checkSubscription);

// Single file upload (image or PDF)
const documentUpload = handleUpload(
  uploadDocuments.single("file") // or uploadImages.single("file") if you only want images
);

// ======================================================
// LIST + SUMMARY
// GET /api/v1/documents
// ======================================================
router.get(
  "/",
  checkPermission("documents.view"),
  // validate(listDocumentsQuerySchema, "query"), // optional
  listDocuments
);

// ======================================================
// UPLOAD (creates or replaces if same type already exists)
// POST /api/v1/documents
// ======================================================
router.post(
  "/",
  checkPermission("documents.create"),
  documentUpload,
  // validate(uploadDocumentSchema),
  uploadDocument
);

// ======================================================
// REPLACE
// PATCH /api/v1/documents/:id
// ======================================================
router.patch(
  "/:id",
  checkPermission("documents.edit", "documents.create"),
  documentUpload,
  // validate(documentIdSchema, "params"),
  // validate(replaceDocumentSchema),
  replaceDocument
);

// ======================================================
// DELETE
// DELETE /api/v1/documents/:id
// ======================================================
router.delete(
  "/:id",
  checkPermission("documents.delete"),
  // validate(documentIdSchema, "params"),
  deleteDocument
);

export default router;