import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";
import packageJson from "../package.json";

describe("extension manifest least privilege", () => {
  it("never reuses the legacy 0.1.1 version for the bridge-capable release", () => {
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.version).not.toBe("0.1.1");
  });

  it("requires access only to the Joblit API host", () => {
    expect(manifest.host_permissions).toEqual(["https://www.joblit.tech/*"]);
    expect(manifest.host_permissions).not.toContain("https://*/*");
  });

  it("locks the complete required permission set", () => {
    expect(manifest.permissions).toEqual([
      "storage",
      "activeTab",
      "scripting",
    ]);
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self'; object-src 'self'",
    });
    expect("externally_connectable" in manifest).toBe(false);
  });

  it("requests generic and loopback hosts only as optional access", () => {
    expect(manifest.optional_host_permissions).toEqual(
      expect.arrayContaining([
        "https://*/*",
        "http://localhost/*",
        "http://127.0.0.1/*",
        "http://[::1]/*",
      ]),
    );
  });

  it("limits the main content script to supported ATS and Seek hosts", () => {
    const mainContentScript = manifest.content_scripts[0];

    expect(mainContentScript.run_at).toBe("document_idle");
    expect(mainContentScript.matches).toEqual([
      "https://*.greenhouse.io/*",
      "https://*.lever.co/*",
      "https://*.myworkdayjobs.com/*",
      "https://*.workday.com/job/*",
      "https://*.workday.com/*/job/*",
      "https://*.icims.com/*",
      "https://*.successfactors.com/*",
      "https://*.taleo.net/*",
      "https://*.smartrecruiters.com/*",
      "https://*.bamboohr.com/careers/*",
      "https://*.bamboohr.com/jobs/*",
      "https://*.jobvite.com/*",
      "https://*.ashbyhq.com/*",
      "https://*.rippling.com/job/*",
      "https://*.rippling.com/jobs/*",
      "https://*.rippling.com/*/job/*",
      "https://*.rippling.com/*/jobs/*",
      "https://au.seek.com/*",
    ]);
    expect(mainContentScript.matches).not.toContain("https://*/*");
    expect(mainContentScript.matches).not.toEqual(
      expect.arrayContaining([
        "https://*.workday.com/*",
        "https://*.bamboohr.com/*",
        "https://*.rippling.com/*",
      ]),
    );
  });

  it("never injects a manifest content script into all frames", () => {
    for (const contentScript of manifest.content_scripts) {
      expect("all_frames" in contentScript).toBe(false);
    }
  });

  it("preserves the separate Seek MAIN-world interceptor", () => {
    expect(manifest.content_scripts[1]).toMatchObject({
      matches: ["https://au.seek.com/*"],
      js: ["src/content/seek/seekInterceptMain.ts"],
      run_at: "document_start",
      world: "MAIN",
    });
  });

  it("appends an isolated exact-origin Joblit bridge without changing loader indices", () => {
    expect(manifest.minimum_chrome_version).toBe("102");
    expect(manifest.content_scripts[0].js).toEqual(["src/content/index.ts"]);
    expect(manifest.content_scripts[1].js).toEqual(["src/content/seek/seekInterceptMain.ts"]);
    expect(manifest.content_scripts[2]).toEqual({
      matches: ["https://www.joblit.tech/*"],
      js: ["src/content/joblitBridge.ts"],
      run_at: "document_start",
    });
    expect("externally_connectable" in manifest).toBe(false);
  });
});
