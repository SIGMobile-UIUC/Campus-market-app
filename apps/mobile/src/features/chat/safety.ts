// CHT-6: a warning under a received message that asks for a verification code, a gift card or payment
// before meeting. The server already blocks prohibited words; these patterns only warn.
const PATTERNS: { pattern: RegExp; warning: string }[] = [
  {
    pattern:
      /\b(verification|verify|confirmation|security|login|google voice|\d[- ]?digit)\s+code\b|\bsend (me )?(the |that |your )?code\b|\bcode (you|that) (got|get|received)\b/i,
    warning: "Never share a verification code. No buyer or seller needs one.",
  },
  {
    pattern: /\b(gift ?cards?|itunes card|apple card|google play card|steam card|amazon card)\b/i,
    warning: "Gift card payments are a common scam. Pay at the meetup instead.",
  },
  {
    pattern:
      /\b(pay|send|venmo|zelle|cash ?app|paypal)\b.{0,40}\b(first|upfront|up front|in advance|before (we )?(meet|meeting|pickup))\b|\bdeposit\b/i,
    warning: "Don't pay before you meet and check the item.",
  },
];

export function scamWarning(text: string | null): string | null {
  if (!text) return null;
  return PATTERNS.find(({ pattern }) => pattern.test(text))?.warning ?? null;
}
