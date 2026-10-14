// Server error codes (spec 6.2, 6.3) to user-facing text. Auth errors carry the code in `message`;
// database functions raise it as the message of a P0001 error.
const MESSAGES: Record<string, string> = {
  PLUS_ADDRESS_NOT_ALLOWED: "Addresses with + can't be used. Use your main email address.",
  EMAIL_NOT_ALLOWED: "Temporary email addresses can't be used.",
  REGISTRATION_BLOCKED: "This email can't be used to sign up.",
  AUTH_REQUIRED: "Your session ended. Sign in again.",
  ACCOUNT_SUSPENDED: "Your account is suspended.",
  VALIDATION_FAILED: "Some details aren't valid. Check them and try again.",
  ALREADY_EXISTS: "That nickname is taken.",
  PROHIBITED_CONTENT: "That isn't allowed. Try something else.",
  ZIP_REQUIRED: "Enter a valid US ZIP code.",
  INVALID_STATE: "This step is already done.",
};

export function errorMessage(error: unknown): string {
  const e = error as { message?: string; status?: number; code?: string } | null;
  if (e?.message && MESSAGES[e.message]) return MESSAGES[e.message];
  if (e?.status === 429 || e?.code === "over_email_send_rate_limit")
    return "Too many tries. Wait a minute and try again.";
  if (e?.code === "otp_expired") return "That code is wrong or expired.";
  if (e?.message?.includes("Network request failed") || e?.message?.includes("Aborted"))
    return "No connection. Check your internet and try again.";
  return "Something went wrong. Try again.";
}
