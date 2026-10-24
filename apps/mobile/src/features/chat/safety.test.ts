import { scamWarning } from "./safety";

test("asking for a verification code warns", () => {
  expect(scamWarning("Can you send me the code you got? Just verifying you're real")).toMatch(
    /verification code/,
  );
  expect(scamWarning("What's the 6-digit code google sent?")).toMatch(/verification code/);
});

test("gift cards and paying before the meetup warn", () => {
  expect(scamWarning("I can pay with an iTunes card")).toMatch(/Gift card/);
  expect(scamWarning("Venmo me $20 first and I'll hold it")).toMatch(/before you meet/);
  expect(scamWarning("Send a deposit to reserve it")).toMatch(/before you meet/);
});

test("ordinary messages do not warn", () => {
  for (const text of ["Is this still available?", "When can you meet?", "I'll pay cash at the Union", null]) {
    expect(scamWarning(text)).toBeNull();
  }
});
