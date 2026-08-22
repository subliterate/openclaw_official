import { describe, expect, it } from "vitest";
import { looksLikeGmailTarget, normalizeGmailTarget } from "./normalize.js";

describe("looksLikeGmailTarget", () => {
  it("returns true for a valid email", () => {
    expect(looksLikeGmailTarget("user@example.com")).toBe(true);
  });

  it("returns true for gmail: prefix", () => {
    expect(looksLikeGmailTarget("gmail:user@example.com")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(looksLikeGmailTarget("")).toBe(false);
  });

  it("returns false for non-email string", () => {
    expect(looksLikeGmailTarget("not-an-email")).toBe(false);
  });

  it("returns false for IRC nick", () => {
    expect(looksLikeGmailTarget("#channel")).toBe(false);
  });
});

describe("normalizeGmailTarget", () => {
  it("normalizes a plain email", () => {
    expect(normalizeGmailTarget("User@Example.COM")).toBe("user@example.com");
  });

  it("strips gmail: prefix", () => {
    expect(normalizeGmailTarget("gmail:user@example.com")).toBe("user@example.com");
  });

  it("strips email: prefix", () => {
    expect(normalizeGmailTarget("email:user@example.com")).toBe("user@example.com");
  });

  it("strips mailto: prefix", () => {
    expect(normalizeGmailTarget("mailto:user@example.com")).toBe("user@example.com");
  });

  it("extracts from angle brackets", () => {
    expect(normalizeGmailTarget("John Doe <john@example.com>")).toBe("john@example.com");
  });

  it("returns undefined for empty string", () => {
    expect(normalizeGmailTarget("")).toBeUndefined();
  });

  it("returns undefined for invalid email", () => {
    expect(normalizeGmailTarget("not-an-email")).toBeUndefined();
  });

  it("handles whitespace", () => {
    expect(normalizeGmailTarget("  user@example.com  ")).toBe("user@example.com");
  });
});
