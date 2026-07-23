import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_AI_BRIDGE_ACTIONS,
  LOCAL_AI_BRIDGE_CHANNEL,
  LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES,
  LOCAL_AI_ERROR_CODES,
  isLocalAiErrorCode,
} from "@/lib/shared/localAiBridgeWire";
import {
  LOCAL_AI_BRIDGE_CHANNEL as CONTRACT_CHANNEL,
  LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES as CONTRACT_MAX_RESPONSE_BYTES,
} from "@/lib/shared/localAiBridgeContract";

/**
 * The extension is a separate npm project, so `tsc` cannot see both sides at
 * once from either root. These assertions stand in for that: they check the
 * extension still *imports* the shared vocabulary rather than restating it, and
 * that the build config which makes that import resolve is in place.
 *
 * Before the shared module the 17 error codes were written three times — a Zod
 * enum here, a type union in the extension, and a runtime Set beside it — and
 * nothing failed when one drifted.
 */

const EXT_ROOT = join(process.cwd(), "chrome-extension");
const hermesTypes = readFileSync(
  join(EXT_ROOT, "src", "shared", "hermesTypes.ts"),
  "utf8",
);

describe("Local AI bridge wire vocabulary", () => {
  it("is imported by the extension rather than restated", () => {
    expect(hermesTypes).toContain('from "@shared/localAiBridgeWire"');
  });

  it("leaves no second copy of the error-code list in the extension", () => {
    // Either spelling of a local copy: a type union or a runtime collection.
    expect(hermesTypes).not.toMatch(/export type LocalAiErrorCode =\s*\n\s*\|/);
    expect(hermesTypes).not.toMatch(/new Set<LocalAiErrorCode>\(\[/);
  });

  it("resolves `@shared` in both the extension's tsconfig and its bundler", () => {
    const tsconfig = readFileSync(join(EXT_ROOT, "tsconfig.json"), "utf8");
    const vite = readFileSync(join(EXT_ROOT, "vite.config.ts"), "utf8");

    expect(tsconfig).toContain('"@shared/*"');
    expect(vite).toContain('"@shared"');
  });

  it("keeps the wire module dependency-free so the extension takes on nothing", () => {
    const wire = readFileSync(
      join(process.cwd(), "lib", "shared", "localAiBridgeWire.ts"),
      "utf8",
    );
    expect(wire).not.toMatch(/^import /m);
  });

  it("backs the web contract with the same constants", () => {
    expect(CONTRACT_CHANNEL).toBe(LOCAL_AI_BRIDGE_CHANNEL);
    expect(CONTRACT_MAX_RESPONSE_BYTES).toBe(LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES);
  });

  it("derives the error-code guard from the list", () => {
    for (const code of LOCAL_AI_ERROR_CODES) {
      expect(isLocalAiErrorCode(code)).toBe(true);
    }
    expect(isLocalAiErrorCode("NOT_A_REAL_CODE")).toBe(false);
    expect(isLocalAiErrorCode(undefined)).toBe(false);
  });

  it("names every action the bridge speaks", () => {
    expect([...LOCAL_AI_BRIDGE_ACTIONS]).toEqual([
      "PING",
      "GET_STATUS",
      "START_RUN",
      "GET_RUN",
      "STOP_RUN",
      "REPAIR_RUN",
    ]);
  });
});
