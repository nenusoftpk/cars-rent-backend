import { Router } from "express";
import authenticate from "../middlewares/auth.middleware.js";
import tenantMiddleware from "../middlewares/tenant.middleware.js";
import checkSubscription from "../middlewares/subscription.middleware.js";
import { adminOnly } from "../middlewares/permission.middleware.js";
import validate from "../middlewares/validate.middleware.js";
import {
  uploadImages,
  handleUpload,
} from "../middlewares/upload.middleware.js";
import {
  listEmployees,
  getEmployee,
  getEmployeePermissions,
  createEmployee,
  updateEmployee,
  updateEmployeePermissions,
  updateEmployeeStatus,
  resetEmployeePassword,
} from "../controllers/employeeController.js";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  updateEmployeePermissionsSchema,
  updateEmployeeStatusSchema,
  resetEmployeePasswordSchema,
} from "../validations/employeeValidation.js";
import { idParamSchema } from "../validations/listValidation.js";

const router = Router();

// Same upload pattern as Auth profile updates.
const employeeImageUpload = handleUpload(
  uploadImages.single("avatar")
);

router.use(
  authenticate,
  tenantMiddleware,
  checkSubscription,
  adminOnly
);

router.get("/", listEmployees);
router.get("/permissions", getEmployeePermissions);

router.post(
  "/",
  employeeImageUpload,
  validate(createEmployeeSchema),
  createEmployee
);

router.get(
  "/:id",
  validate(idParamSchema, "params"),
  getEmployee
);

router.patch(
  "/:id",
  validate(idParamSchema, "params"),
  employeeImageUpload,
  validate(updateEmployeeSchema),
  updateEmployee
);

router.patch(
  "/:id/permissions",
  validate(idParamSchema, "params"),
  validate(updateEmployeePermissionsSchema),
  updateEmployeePermissions
);

router.patch(
  "/:id/status",
  validate(idParamSchema, "params"),
  validate(updateEmployeeStatusSchema),
  updateEmployeeStatus
);

router.post(
  "/:id/reset-password",
  validate(idParamSchema, "params"),
  validate(resetEmployeePasswordSchema),
  resetEmployeePassword
);

export default router;