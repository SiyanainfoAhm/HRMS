/** Password policy: uppercase, lowercase, number, special character, min 8 chars. */

export const PASSWORD_COMPLEXITY_HINT =
  "Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.";

export function validatePasswordComplexity(value: string): string | null {
  if (!value) return "Password is required";
  if (value.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter";
  if (!/[a-z]/.test(value)) return "Password must include at least one lowercase letter";
  if (!/[0-9]/.test(value)) return "Password must include at least one number";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include at least one special character";
  if (value.length > 255) return "Password is too long";
  return null;
}
