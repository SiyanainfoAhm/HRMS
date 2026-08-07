/** Application product name (UI, PDF metadata, emails). */
export const APP_NAME = "CIRT Payroll";

/** Fixed organization name for this single-tenant CIRT deployment. */
export const ORGANIZATION_NAME = "CIRT";

/** Internal company code (matches backend DEFAULT_COMPANY_CODE). */
export const DEFAULT_COMPANY_CODE = "CIRT";

/** Institute name printed on salary slips (separate from app branding). */
export const PAYSLIP_INSTITUTE_NAME = "CENTRAL INSTITUTE OF ROAD TRANSPORT";

export const PAYSLIP_INSTITUTE_ADDRESS = "BHOSARI, PUNE 411026";

/**
 * UI label for the single-tenant institute record stored in `cirt_institute`.
 * The table name is legacy from HRMS; this app has one row (CIRT), not multiple companies.
 */
export const INSTITUTE_LABEL = "CIRT Institute";

/** Fixed sidebar/header branding — not editable by administrators. */
export const FIXED_ORG_BRANDING = {
  organization: ORGANIZATION_NAME,
  application: APP_NAME,
} as const;
