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
  CAMPUS_REQUIRED: "Campus-only posts need a live campus market.",
  LIMIT_REACHED: "You've reached today's posting limit. Try again tomorrow.",
  ITEM_UNAVAILABLE: "Some items are reserved or sold, so they can't change.",
  NOT_FOUND: "This listing isn't available anymore.",
  NOT_PARTY: "You're not part of this chat.",
  SELF_ACTION: "This is your own listing.",
  BLOCKED: "You can't message this person.",
  RATE_LIMITED: "You're sending messages too fast. Wait a few seconds.",
};

// overrides give a code a message for one screen, such as INVALID_STATE on a closed chat.
export function errorMessage(error: unknown, overrides: Record<string, string> = {}): string {
  const e = error as { message?: string; status?: number; code?: string } | null;
  const known = e?.message ? (overrides[e.message] ?? MESSAGES[e.message]) : undefined;
  if (known) return known;
  if (e?.status === 429 || e?.code === "over_email_send_rate_limit")
    return "Too many tries. Wait a minute and try again.";
  if (e?.code === "otp_expired") return "That code is wrong or expired.";
  if (e?.message?.includes("Network request failed") || e?.message?.includes("Aborted"))
    return "No connection. Check your internet and try again.";
  return "Something went wrong. Try again.";
}

// The field a P0001 error names in its details, such as "title" or "photos" (spec 6.2).
export function errorField(error: unknown): string | null {
  try {
    return JSON.parse((error as { details?: string } | null)?.details ?? "").field ?? null;
  } catch {
    return null;
  }
}
