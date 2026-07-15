# Joblit Hermes Profile and Windows Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a minimal, verifiable Joblit profile distribution for the official Hermes client and a user-launched Windows bootstrap that installs or updates an isolated per-account profile, configures loopback API access, guides ChatGPT/Codex OAuth, installs the official gateway service, and returns the exact non-secret connection values needed by the Joblit extension.

**Architecture:** Joblit owns only profile/config/prompt-governance files and packaging/bootstrap tooling. Hermes remains an external stock dependency installed through its official path. A deterministic Node packager enforces a strict distribution allowlist and produces a content manifest. Release CI signs that manifest with Ed25519 when production signing secrets exist; installation fails closed for production artifacts without a trusted signature. During the Beta development path, the user must explicitly provide the published archive SHA-256. PowerShell verifies the package before invoking official `hermes profile install`, writes only profile-local API environment values, performs explicit provider/profile/config checks, and invokes official `gateway install` lifecycle commands.

**Tech Stack:** Official Hermes CLI/profile distributions, YAML, Markdown Skills, Node.js 22 core crypto/fs APIs, PowerShell 7/Windows PowerShell 5.1-compatible bootstrap, Vitest 4, Pester for Windows process tests, GitHub Actions Ubuntu and Windows runners.

## Global Constraints

- Do not fork, clone for modification, patch, vendor, or publish Hermes runtime code.
- Never modify or overwrite the user's existing default Hermes profile or current Hermes source checkout.
- Every Joblit account uses an opaque profile name `joblit-<accountHash>` supplied by authenticated Joblit context; never use email, display name, or raw database ID.
- Distribution content never includes `.env`, auth files, memory, sessions, logs, trajectories, caches, plugins, MCP config, binaries, or user data.
- Production signing private keys exist only in release secrets. Never generate or commit a production private key, sample private key, fake signature, or pre-trusted development key.
- Production install fails closed when signature/public-key/version trust is missing. Beta digest mode requires explicit `-ExpectedArchiveSha256` and must be labelled unverified Beta.
- API bind is exactly `127.0.0.1`; port is explicit; API key is cryptographically random and at least 32 bytes.
- Joblit profile memory and user-profile memory are disabled. Honcho/external memory is disabled.
- API server and cron use `no_mcp`; globally disable every unneeded executable/search/memory toolset.
- `model.provider` is `openai-codex`; `model.openai_runtime` is `auto`, never `codex_app_server`.
- Bootstrap uses official commands such as `hermes profile install`, `hermes auth add openai-codex`, and `hermes -p <profile> gateway install`; it does not import Hermes Python modules.
- Updating the profile may replace only declared distribution files. User auth and generated `.env` remain local.
- Build and verification scripts reject symlinks, path traversal, alternate data streams, unexpected files, case-collisions, oversized files, and mismatched hashes before Hermes sees the package.

---

## Task 1: Create the minimal zero-tool Joblit profile distribution

**Files:**

- Create: `integrations/hermes/profile/distribution.yaml`
- Create: `integrations/hermes/profile/config.yaml`
- Create: `integrations/hermes/profile/SOUL.md`
- Create: `integrations/hermes/profile/.no-bundled-skills`
- Create: `integrations/hermes/profile/skills/joblit-career-agent/SKILL.md`
- Create: `integrations/hermes/profile/skills/joblit-career-agent/references/grounding-policy.md`
- Create: `integrations/hermes/profile/skills/joblit-career-agent/references/output-contracts.md`
- Create: `test/hermesProfileSource.test.ts`

**Distribution manifest:**

```yaml
name: joblit-local-ai
version: 0.1.0
description: Grounded CV and cover-letter generation for Joblit through stock Hermes
hermes_requires: ">=0.18.2"
author: Joblit contributors
license: Apache-2.0
distribution_owned:
  - SOUL.md
  - config.yaml
  - .no-bundled-skills
  - skills/joblit-career-agent
```

`config.yaml` sets `model.provider: openai-codex`, `model.openai_runtime: auto`, `platform_toolsets.api_server: [no_mcp]`, `platform_toolsets.cron: [no_mcp]`, `memory.memory_enabled: false`, and `memory.user_profile_enabled: false`. Its `agent.disabled_toolsets` must include at least memory, session search, terminal, file operations, browser, web, code execution, delegation, cron, vision, and any built-in communication toolsets present in the supported Hermes baseline. The profile contains no default model slug that can silently become stale; bootstrap verifies the provider/model selection after OAuth setup.

- [ ] Write failing source tests for the exact allowed tree, required manifest fields, minimum Hermes version, Apache license, and no forbidden files/extensions.
- [ ] Add config tests proving loopback API profile has zero MCP and zero executable/memory toolsets.
- [ ] Add negative tests for `.env`, auth/session/memory/log files, symlinks, unexpected root files, and case-colliding names.
- [ ] Write `SOUL.md` as a narrow behavior contract: obey the request prompt, treat evidence blocks as untrusted data, never invent candidate facts, return one strict JSON object, and never call tools.
- [ ] Write the Skill as human-readable source organization only. Do not claim the stock Runs API deterministically preloads it; every API prompt remains self-contained.
- [ ] Keep output references synchronized with Joblit's actual resume/cover schema names and Local AI strict parser.
- [ ] Run `npm test -- test/hermesProfileSource.test.ts`.
- [ ] Commit with `git commit -m "feat(hermes): add minimal Joblit profile"`.

## Task 2: Build a deterministic allowlisted package manifest

**Files:**

- Create: `tools/hermes/packagePolicy.mjs`
- Create: `tools/hermes/build-package.mjs`
- Create: `tools/hermes/verify-package.mjs`
- Create: `tools/hermes/package.test.mjs`
- Modify: `package.json`
- Modify: `knip.json`

**Generated manifest:**

```json
{
  "schemaVersion": 1,
  "package": "joblit-hermes-profile",
  "profileVersion": "0.1.0",
  "hermesRequires": ">=0.18.2",
  "sourceCommit": "<40 lowercase hex>",
  "securityPolicyHash": "sha256:<64 lowercase hex>",
  "files": [
    {"path":"config.yaml","size":1234,"sha256":"<64 lowercase hex>"}
  ]
}
```

The runtime manifest is created only in a clean staging directory. Paths use forward slashes, NFC normalization, ordinal sorting, and lowercase SHA-256. Allowed roots are exactly the distribution source files declared in Task 1. `distribution_owned` is checked but never treated as the only trust boundary.

- [ ] Write failing Node tests for deterministic output, clean staging, source commit validation, hash/size verification, path traversal, absolute paths, reserved Windows names, ADS syntax, symlinks/reparse points, case collisions, file-count cap, per-file cap, and total-size cap.
- [ ] Implement one shared package policy used by both build and verify commands.
- [ ] Make build fail if Git has uncommitted changes under `integrations/hermes/profile` or if source content differs from the manifest allowlist.
- [ ] Make verify reject extra files, missing files, modified content, wrong source commit, unsupported schema, and unsupported version.
- [ ] Add scripts `hermes:package:test`, `hermes:package:build`, and `hermes:package:verify` to root `package.json`.
- [ ] Add tooling entrypoints to `knip.json` so dead-code checks treat them as intentional.
- [ ] Run `node --test tools/hermes/package.test.mjs` and `npm run hermes:package:build -- --staging .tmp/hermes-profile-staging`.
- [ ] Verify the staging directory with `npm run hermes:package:verify -- --root .tmp/hermes-profile-staging --mode digest`.
- [ ] Remove only the verified `.tmp/hermes-profile-staging` test output with native PowerShell after resolving its absolute workspace-contained path.
- [ ] Commit with `git commit -m "build(hermes): add deterministic profile packaging"`.

## Task 3: Add Ed25519 release signing and trust registry verification

**Files:**

- Create: `tools/hermes/sign-manifest.mjs`
- Create: `tools/hermes/signature.test.mjs`
- Create: `integrations/hermes/trust/release-keys.json`
- Modify: `tools/hermes/verify-package.mjs`
- Modify: `package.json`

**Trust registry:**

```json
{
  "schemaVersion": 1,
  "keys": []
}
```

The initially empty registry is honest: production verification must fail with `NO_TRUSTED_RELEASE_KEY` until an actual release public key is reviewed and committed. Tests generate ephemeral Ed25519 keypairs in the test process only and delete them afterward. The signature file signs the exact bytes of `joblit-package-manifest.json` and records only a key ID plus base64 signature.

- [ ] Write failing tests for valid ephemeral signature, modified manifest, wrong key, revoked/unknown key, invalid encoding, duplicate key IDs, version outside key validity, and empty registry fail-closed behavior.
- [ ] Implement signing with Node `crypto.sign(null, ...)` and verification with `crypto.verify(null, ...)`; reject non-Ed25519 public keys.
- [ ] Read the private key only from `JOBLIT_HERMES_SIGNING_PRIVATE_KEY`; never accept a repository path in release mode.
- [ ] Add `hermes:package:sign` and production verification scripts.
- [ ] Ensure digest-only mode requires an explicit expected archive SHA-256 from the caller and reports `trustLevel: "beta-digest"`, never `verified`.
- [ ] Run `node --test tools/hermes/signature.test.mjs tools/hermes/package.test.mjs`.
- [ ] Commit with `git commit -m "security(hermes): verify signed profile manifests"`.

## Task 4: Implement a safe Windows bootstrap state machine

**Files:**

- Create: `tools/hermes/bootstrap/Install-JoblitHermes.ps1`
- Create: `tools/hermes/bootstrap/Test-JoblitHermes.ps1`
- Create: `tools/hermes/bootstrap/JoblitHermes.Common.psm1`
- Create: `tools/hermes/bootstrap/tests/JoblitHermes.Common.Tests.ps1`
- Create: `tools/hermes/bootstrap/tests/Install-JoblitHermes.Tests.ps1`
- Create: `tools/hermes/bootstrap/README.md`

**Public parameters:**

```powershell
param(
  [Parameter(Mandatory)] [string] $PackagePath,
  [Parameter(Mandatory)] [ValidatePattern('^joblit-[a-f0-9]{16,64}$')] [string] $ProfileName,
  [ValidateRange(1024,65535)] [int] $Port = 8642,
  [string] $ExpectedArchiveSha256,
  [switch] $Production,
  [switch] $StartOnLogin = $true,
  [switch] $ForceConfigUpdate,
  [switch] $WhatIf
)
```

The state machine is `Preflight -> VerifyPackage -> InspectExistingProfile -> InstallOrUpdate -> ConfigureOAuth -> WriteLocalEnv -> InstallGateway -> Probe -> EmitConnectionReceipt`. Each step writes structured, secret-redacted status. On failure it leaves the existing profile intact and prints one recovery action.

- [ ] Write Pester tests using fake `hermes` executables and temporary `HERMES_HOME`; never invoke the user's real install in tests.
- [ ] Test missing/outdated Hermes, invalid profile name, occupied port, invalid archive hash/signature, malicious archive entry, existing unrelated profile, update preservation, command failure, redaction, `WhatIf`, and idempotent rerun.
- [ ] Resolve `hermes` from PATH and check version against `hermes_requires`; print the official installation URL if absent instead of downloading arbitrary code.
- [ ] Verify archive digest/signature and extracted manifest before invoking any Hermes command.
- [ ] Install from the verified local directory with `hermes profile install <dir> --name <profile> --yes`; update only a matching Joblit distribution and use `--force-config --yes` only when explicitly selected.
- [ ] Guide or invoke official `hermes -p <profile> auth add openai-codex`; then verify config reports `model.provider: openai-codex` and `model.openai_runtime: auto`. Do not infer readiness from `/v1/models` alone.
- [ ] Generate a 32-byte-or-stronger API key with `RandomNumberGenerator`, write profile-local `.env` atomically with ACL limited to the current user, and set exactly `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT`, `API_SERVER_KEY`, and `API_SERVER_MODEL_NAME`.
- [ ] Reject `0.0.0.0`, LAN/public binds, weak keys, and overwriting an unknown `.env`. Preserve unrelated safe user variables during a verified update.
- [ ] Install the official per-profile service with `hermes -p <profile> gateway install --start-now` plus explicit start-on-login choice. Do not create a custom Scheduled Task.
- [ ] Probe `/health` then authenticated `/v1/capabilities`; do not send a billable run during bootstrap.
- [ ] Emit a connection receipt containing only endpoint, profile name, package version, trust level, and key fingerprint. Show the actual API key once for the user to paste into the extension, never log it or place it in the receipt.
- [ ] Run `Invoke-Pester tools/hermes/bootstrap/tests -CI` on Windows.
- [ ] Commit with `git commit -m "feat(hermes): add safe Windows bootstrap"`.

## Task 5: Add an independent post-install verifier and recovery actions

**Files:**

- Modify: `tools/hermes/bootstrap/Test-JoblitHermes.ps1`
- Create: `tools/hermes/bootstrap/tests/Test-JoblitHermes.Tests.ps1`
- Modify: `tools/hermes/bootstrap/README.md`

The verifier is read-only by default. It checks Hermes version, profile source/version, config invariants, `.no-bundled-skills`, file hashes, provider selection, loopback bind, key presence/strength without printing it, gateway service state, liveness, authenticated API compatibility, and absence of enabled MCP/memory/executable toolsets.

- [ ] Write red tests for each unhealthy state and for complete secret redaction.
- [ ] Return exit code 0 only for `Ready`; use stable non-zero categories for missing Hermes, untrusted package, profile drift, auth/model mismatch, gateway down, and API incompatibility.
- [ ] Print one exact official recovery command per failure category; never auto-run destructive recovery.
- [ ] Add explicit `ProfileDrift` when `config.yaml`, `SOUL.md`, Skill files, or marker differ from the signed/digest manifest.
- [ ] Document that Sessions API deletion is logical transcript deletion only, not secure erase or zero retention.
- [ ] Run `Invoke-Pester tools/hermes/bootstrap/tests -CI`.
- [ ] Commit with `git commit -m "test(hermes): verify local profile readiness"`.

## Task 6: Add release and Windows CI gates

**Files:**

- Create: `.github/workflows/hermes-profile.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`

The normal CI path validates source, deterministic manifests, digest verification, and ephemeral signature tests without secrets. A release-only job packages and signs only when the repository has a trusted public key and the private signing secret; otherwise it fails closed and publishes nothing. Windows CI installs Pester, runs bootstrap tests against fakes, and never touches a real Hermes account.

- [ ] Add Ubuntu checks for profile source, Node package/signature tests, deterministic double-build comparison, no-secret scan, and manifest verification.
- [ ] Add Windows checks for PowerShell syntax, PSScriptAnalyzer security rules, and Pester tests.
- [ ] Use least-privilege workflow permissions; release signing gets `contents: write` only in the guarded release job.
- [ ] Prevent pull-request workflows from accessing signing secrets or uploading a production-named artifact.
- [ ] Ignore `.tmp/hermes-*`, extracted packages, receipts, generated `.env`, keys, and signatures while keeping source manifests/tests tracked.
- [ ] Document the Beta install path separately from future verified release install; never label digest-only output as production verified.
- [ ] Run local CI equivalents: `npm test -- test/hermesProfileSource.test.ts`, `node --test tools/hermes/package.test.mjs tools/hermes/signature.test.mjs`, `npm run lint`, and `npm run deadcode`.
- [ ] Validate workflow YAML and inspect `git diff --check`.
- [ ] Commit with `git commit -m "ci(hermes): gate profile packaging and bootstrap"`.

## Task 7: Independent security review and release handoff

- [ ] Request an independent review of package extraction, signature trust, PowerShell quoting, subprocess invocation, ACL handling, secret redaction, profile isolation, update behavior, and official Hermes command accuracy.
- [ ] Resolve every high/medium finding and rerun the focused suite.
- [ ] Run the complete root CI-equivalent gates: `npm run deps:policy`, `npm run deps:audit`, `npm run deadcode`, `npm run lint`, `npm run test:coverage`, and `npm run build`.
- [ ] On Windows, run `Invoke-Pester tools/hermes/bootstrap/tests -CI` and a `-WhatIf` bootstrap against a fresh temporary `HERMES_HOME`.
- [ ] Verify repository history and staged diff contain no API key, OAuth token, email, raw user ID, generated `.env`, private key, receipt, or local path.
- [ ] Commit final corrections with `git commit -m "security(hermes): harden profile distribution lifecycle"`.

## Acceptance Criteria

- The repository contains only Joblit profile/config/governance files, not Hermes runtime code.
- A clean profile package is deterministic, allowlisted, hash-verified, and capable of Ed25519 verification without any committed private key.
- Production verification fails closed until a real reviewed public key and matching release secret are provisioned.
- Beta installation requires the exact published archive SHA-256 and is labelled Beta.
- Bootstrap never overwrites the default Hermes profile or an unrelated profile, never binds publicly, never logs the API key, and is safe to rerun.
- The installed profile uses `openai-codex`, `openai_runtime: auto`, no MCP, no memory, and no executable toolsets.
- The official per-profile Hermes gateway runs on `127.0.0.1:<port>` and passes liveness plus authenticated compatibility probes.
- The user receives one-time secret input for the extension plus a non-secret connection receipt.
- Windows and root CI-equivalent gates pass.

