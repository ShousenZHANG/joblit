import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  accessRequest: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: store }));

import {
  isSignInAllowed,
  submitAccessRequest,
} from "@/lib/server/access/accessRequestService";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("isAdminEmail", () => {
  it("matches configured admins case-insensitively, ignores whitespace", () => {
    vi.stubEnv("ADMIN_EMAILS", " Boss@X.com , other@y.com ");
    expect(isAdminEmail("boss@x.com")).toBe(true);
    expect(isAdminEmail("OTHER@Y.COM")).toBe(true);
    expect(isAdminEmail("stranger@x.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("treats an unset env as zero admins", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminEmail("anyone@x.com")).toBe(false);
  });
});

describe("isSignInAllowed", () => {
  it("allows a configured admin without hitting the database", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@x.com");
    expect(await isSignInAllowed("Boss@X.com")).toBe(true);
    expect(store.accessRequest.findFirst).not.toHaveBeenCalled();
    expect(store.user.findUnique).not.toHaveBeenCalled();
  });

  it("allows an APPROVED access request", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    store.accessRequest.findFirst.mockResolvedValue({ id: "1" });
    store.user.findUnique.mockResolvedValue(null);
    expect(await isSignInAllowed("a@b.com")).toBe(true);
  });

  it("grandfathers an email that already has a User row", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    store.accessRequest.findFirst.mockResolvedValue(null);
    store.user.findUnique.mockResolvedValue({ id: "u" });
    expect(await isSignInAllowed("a@b.com")).toBe(true);
  });

  it("denies an unknown, unapproved email", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    store.accessRequest.findFirst.mockResolvedValue(null);
    store.user.findUnique.mockResolvedValue(null);
    expect(await isSignInAllowed("a@b.com")).toBe(false);
  });

  it("denies empty / missing email", async () => {
    expect(await isSignInAllowed(null)).toBe(false);
    expect(await isSignInAllowed("")).toBe(false);
  });
});

describe("submitAccessRequest", () => {
  it("upserts a trimmed, lower-cased email + note (idempotent on email)", async () => {
    store.accessRequest.upsert.mockResolvedValue({});
    await submitAccessRequest("  Foo@Bar.COM ", "  hello  ");
    const arg = store.accessRequest.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ email: "foo@bar.com" });
    expect(arg.create.email).toBe("foo@bar.com");
    expect(arg.create.note).toBe("hello");
  });

  it("does not write a note on update when none is given (keeps APPROVED state intact)", async () => {
    store.accessRequest.upsert.mockResolvedValue({});
    await submitAccessRequest("x@y.com");
    const arg = store.accessRequest.upsert.mock.calls[0][0];
    expect(arg.update).toEqual({});
    expect(arg.create.note).toBeNull();
  });
});
