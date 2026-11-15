
/**
 * ============================================================
 * RENT A CAR SAAS - DEFAULT EMPLOYEE PERMISSIONS
 * ============================================================
 *
 * File: config/defaultPermissions.js
 *
 * Compatible with:
 * - checkPermission()
 * - requireAllPermissions()
 * - requireAnyPermission()
 * - adminOnly()
 * - superAdminOnly()
 * - businessUsersOnly()
 *
 * ROLES:
 *
 * admin:
 *   Full permission access within their own business.
 *   No individual permission assignment required.
 *
 * employee:
 *   Access is controlled by assigned permissions.
 *   Data access is also restricted by dataScope.
 *
 * super-admin:
 *   Platform-only access.
 *   No automatic access to tenant business data.
 *
 * IMPORTANT:
 * This file defines permission identifiers.
 * Actual authorization is enforced by backend middleware,
 * route configuration, tenant isolation and data scopes.
 * ============================================================
 */

// ============================================================
// 1. DEFAULT EMPLOYEE PERMISSIONS
// ============================================================

export const DEFAULT_EMPLOYEE_PERMISSIONS = Object.freeze([
  // Dashboard
  "dashboard.view",

  // Customers
  "customers.view",
  "customers.create",
  "customers.update",

  // Cars
  "cars.view",

  // Bookings
  "bookings.view",
  "bookings.create",
  "bookings.update",

  // Car issue and return
  "inspections.view",
  "inspections.issue",
  "inspections.return",

  // Payments
  "payments.view",

  // Invoices
  "invoices.view",
  "invoices.print",

  // Reminders
  "reminders.view",
]);

// ============================================================
// 2. ALL ASSIGNABLE EMPLOYEE PERMISSIONS
// ============================================================

export const ALLOWED_PERMISSIONS = Object.freeze([
  // ==========================================================
  // DASHBOARD
  // ==========================================================

  "dashboard.view",

  // ==========================================================
  // CUSTOMERS
  // ==========================================================

  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",
  "customers.documents.view",

  // ==========================================================
  // CARS
  // ==========================================================

  "cars.view",
  "cars.create",
  "cars.update",
  "cars.delete",
  "cars.documents.view",

  // ==========================================================
  // DRIVERS
  // ==========================================================

  "drivers.view",
  "drivers.create",
  "drivers.update",
  "drivers.delete",
  "drivers.documents.view",

  // ==========================================================
  // BOOKINGS
  // ==========================================================

  "bookings.view",
  "bookings.create",
  "bookings.update",
  "bookings.cancel",
  "bookings.extend",

  // ==========================================================
  // CAR INSPECTIONS / ISSUE / RETURN
  // ==========================================================

  "inspections.view",
  "inspections.issue",
  "inspections.return",

  // ==========================================================
  // INVOICES
  // ==========================================================

  "invoices.view",
  "invoices.print",

  // ==========================================================
  // PAYMENTS
  // ==========================================================

  "payments.view",
  "payments.create",
  "payments.refund",

  // ==========================================================
  // SECURITY DEPOSITS
  // ==========================================================

  "deposits.view",
  "deposits.receive",
  "deposits.refund",

  // ==========================================================
  // CUSTOMER LEDGER / KHATA
  // ==========================================================

  "ledger.view",
  "ledger.print",

  // ==========================================================
  // EXPENSES
  // ==========================================================

  "expenses.view",
  "expenses.create",
  "expenses.update",
  "expenses.delete",

  // ==========================================================
  // MAINTENANCE
  // ==========================================================

  "maintenance.view",
  "maintenance.create",
  "maintenance.update",
  "maintenance.delete",

  // ==========================================================
  // REPORTS
  // ==========================================================

  "reports.view",
  "reports.export",

  // ==========================================================
  // FINANCIAL INFORMATION
  // ==========================================================

  "financial.view",

  // ==========================================================
  // REMINDERS
  // ==========================================================

  "reminders.view",

  // ==========================================================
  // DOCUMENT MANAGEMENT
  // ==========================================================

  "documents.view",
  "documents.create",
  "documents.edit",
  "documents.delete",

  // ==========================================================
  // SENSITIVE DOCUMENTS
  // ==========================================================

  "documents.sensitive.view",

  // ==========================================================
  // SENSITIVE CUSTOMER / DRIVER DATA
  // ==========================================================

  "sensitive.view",
  "sensitive.edit",

  // ==========================================================
  // EMPLOYEES
  // ==========================================================

  "employees.view",

  // ==========================================================
  // SETTINGS
  // ==========================================================

  "settings.view",
  "settings.update",
]);

// ============================================================
// 3. PERMISSION CONFIGURATION VALIDATION
// ============================================================

// Ensure there are no duplicate allowed permissions.
const allowedPermissionSet = new Set(ALLOWED_PERMISSIONS);

if (allowedPermissionSet.size !== ALLOWED_PERMISSIONS.length) {
  throw new Error(
    "Duplicate permission detected in ALLOWED_PERMISSIONS."
  );
}

// Ensure all default permissions are assignable.
const invalidDefaultPermissions =
  DEFAULT_EMPLOYEE_PERMISSIONS.filter(
    (permission) => !allowedPermissionSet.has(permission)
  );

if (invalidDefaultPermissions.length > 0) {
  throw new Error(
    `Invalid default employee permissions: ${invalidDefaultPermissions.join(
      ", "
    )}`
  );
}
