import { errorMessage } from "./errors";

test.each([
  ["PLUS_ADDRESS_NOT_ALLOWED", "Addresses with + can't be used. Use your main email address."],
  ["EMAIL_NOT_ALLOWED", "Temporary email addresses can't be used."],
  ["REGISTRATION_BLOCKED", "This email can't be used to sign up."],
  ["ALREADY_EXISTS", "That nickname is taken."],
  ["ZIP_REQUIRED", "Enter a valid US ZIP code."],
])("maps the server code %s", (code, text) => {
  expect(errorMessage({ message: code })).toBe(text);
});

test("rate limits, expired codes, network failures and timeouts get their own text", () => {
  expect(errorMessage({ status: 429, message: "Too many requests" })).toMatch(/Wait a minute/);
  expect(errorMessage({ code: "otp_expired", message: "Token has expired or is invalid" })).toMatch(
    /wrong or expired/,
  );
  expect(errorMessage(new TypeError("Network request failed"))).toMatch(/No connection/);
  expect(errorMessage({ message: "Aborted" })).toMatch(/No connection/);
});

test("anything else falls back to a generic message", () => {
  expect(errorMessage({ message: "something internal" })).toBe("Something went wrong. Try again.");
  expect(errorMessage(null)).toBe("Something went wrong. Try again.");
});
