export const PASSWORD_MIN = 10;
/** bcrypt, which Supabase Auth uses, reads at most 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "short" | "long" | "email" | "repeated";

/**
 * Reasonable rules, checked before Supabase (which checks the minimum length
 * again and, when enabled, leaked passwords).
 */
export function passwordProblems(password: string, email = ""): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if ([...password].length < PASSWORD_MIN) problems.push("short");
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) problems.push("long");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) problems.push("email");
  if (password.length > 0 && new Set(password).size <= 2) problems.push("repeated");
  return problems;
}
