import { describe, expect, it, vi } from "vitest";
import { authOptions } from "../auth";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

describe("open self-service auth configuration", () => {
  it("does not install a product-specific sign-in gate", () => {
    expect(authOptions.callbacks?.signIn).toBeUndefined();
  });

  it("keeps the database user id private-session contract without admin state", async () => {
    const callback = authOptions.callbacks?.session;
    expect(callback).toBeTypeOf("function");
    const session = {
      expires: "2099-01-01",
      user: { id: "", email: "new@example.com" },
    };
    const user = { id: "user-1", email: "new@example.com" };
    const result = await callback!({ session, user } as never);
    expect(result.user).toMatchObject({
      id: "user-1",
      email: "new@example.com",
    });
    expect(result.user).not.toHaveProperty("isAdmin");
  });
});
