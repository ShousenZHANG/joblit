import { describe, it, expect } from "vitest";
import { UuidParamSchema, UuidWithTaskParamSchema } from "./common";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("UuidParamSchema", () => {
  it("accepts a valid UUID", () => {
    const result = UuidParamSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(VALID_UUID);
  });

  it("rejects a non-UUID string", () => {
    const result = UuidParamSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = UuidParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects numeric id", () => {
    const result = UuidParamSchema.safeParse({ id: 123 });
    expect(result.success).toBe(false);
  });
});

describe("UuidWithTaskParamSchema", () => {
  it("accepts valid id and taskId", () => {
    const result = UuidWithTaskParamSchema.safeParse({
      id: VALID_UUID,
      taskId: VALID_UUID_2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(VALID_UUID);
      expect(result.data.taskId).toBe(VALID_UUID_2);
    }
  });

  it("rejects missing taskId", () => {
    const result = UuidWithTaskParamSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID taskId", () => {
    const result = UuidWithTaskParamSchema.safeParse({
      id: VALID_UUID,
      taskId: "bad-task-id",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = UuidWithTaskParamSchema.safeParse({ taskId: VALID_UUID_2 });
    expect(result.success).toBe(false);
  });
});
