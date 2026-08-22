import { describe, expect, it } from "vitest";
import { normalizeMessengerTarget, looksLikeMessengerTarget } from "./normalize.js";

describe("normalizeMessengerTarget", () => {
  it("normalizes a plain PSID", () => {
    expect(normalizeMessengerTarget("1234567890")).toBe("1234567890");
  });

  it("strips messenger: prefix", () => {
    expect(normalizeMessengerTarget("messenger:1234567890")).toBe("1234567890");
  });

  it("strips fb: prefix", () => {
    expect(normalizeMessengerTarget("fb:1234567890")).toBe("1234567890");
  });

  it("strips psid: prefix", () => {
    expect(normalizeMessengerTarget("psid:1234567890")).toBe("1234567890");
  });

  it("trims whitespace", () => {
    expect(normalizeMessengerTarget("  1234567890  ")).toBe("1234567890");
  });

  it("returns null for non-numeric input", () => {
    expect(normalizeMessengerTarget("hello")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeMessengerTarget("")).toBeNull();
  });

  it("returns null for email-like input", () => {
    expect(normalizeMessengerTarget("user@example.com")).toBeNull();
  });
});

describe("looksLikeMessengerTarget", () => {
  it("returns true for valid PSID", () => {
    expect(looksLikeMessengerTarget("1234567890")).toBe(true);
  });

  it("returns true for prefixed PSID", () => {
    expect(looksLikeMessengerTarget("messenger:1234567890")).toBe(true);
  });

  it("returns false for non-numeric", () => {
    expect(looksLikeMessengerTarget("not-a-psid")).toBe(false);
  });
});
