import { validateEmailField } from "@/lib/employeeValidators";

/** Live login email validation (while typing). */
export function validateLoginEmail(value: string): string | null {
  return validateEmailField(value);
}

/** Login accepts any stored password; complexity is enforced when admins set passwords. */
export function validateLoginPassword(value: string): string | null {
  if (!value) return "Password is required";
  if (value.length > 255) return "Password is too long";
  return null;
}
