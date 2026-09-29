import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  timingSafeEqual,
  sessionCookieHeader,
  clearSessionCookieHeader,
  parseCookies,
  isAuthenticated,
} from "../src/lib/auth.js";

const SECRET = "test-secret-do-not-use-in-prod";

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("hunter2", "hunter2")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(timingSafeEqual("hunter2", "hunter3")).toBe(false);
  });
  it("returns false when lengths differ", () => {
    expect(timingSafeEqual("short", "much-longer-value")).toBe(false);
  });
  it("treats null/undefined as empty string, not a crash", () => {
    expect(timingSafeEqual(undefined, "")).toBe(true);
    expect(timingSafeEqual(null, "x")).toBe(false);
  });
});

describe("createSessionToken / verifySessionToken", () => {
  it("verifies a freshly created token", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken("wrong-secret", token)).toBe(false);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(SECRET);
    const tampered = token.slice(0, -2) + (token.slice(-2) === "AA" ? "BB" : "AA");
    expect(await verifySessionToken(SECRET, tampered)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(SECRET, { hours: -1 });
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    expect(await verifySessionToken(SECRET, "")).toBe(false);
    expect(await verifySessionToken(SECRET, "not-a-real-token")).toBe(false);
    expect(await verifySessionToken(SECRET, null)).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("sessionCookieHeader sets HttpOnly/Secure/SameSite=Strict", () => {
    const header = sessionCookieHeader("abc.def");
    expect(header).toContain("session=abc.def");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
  });

  it("clearSessionCookieHeader expires immediately", () => {
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });

  it("parseCookies reads the session cookie back out of a request", async () => {
    const token = await createSessionToken(SECRET);
    const request = new Request("https://example.com/", {
      headers: { cookie: `other=1; session=${encodeURIComponent(token)}` },
    });
    expect(parseCookies(request).session).toBe(token);
  });
});

describe("isAuthenticated", () => {
  it("is true for a request carrying a valid session cookie", async () => {
    const token = await createSessionToken(SECRET);
    const request = new Request("https://example.com/", {
      headers: { cookie: `session=${encodeURIComponent(token)}` },
    });
    expect(await isAuthenticated(request, SECRET)).toBe(true);
  });

  it("is false with no cookie at all", async () => {
    const request = new Request("https://example.com/");
    expect(await isAuthenticated(request, SECRET)).toBe(false);
  });
});
