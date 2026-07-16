# Joblit Hermes Windows bootstrap

This bootstrap installs only Joblit-owned profile files into an opaque per-account stock Hermes profile. It does not download, patch, vendor, or import Hermes runtime code. Install or update Hermes from its official project first: <https://github.com/NousResearch/hermes-agent>.

Requirements: Windows PowerShell 5.1 or PowerShell 7, Node.js 22+, stock Hermes `>=0.18.2`, and a profile name supplied by authenticated Joblit context in the form `joblit-<16-64 lowercase hex characters>`. Never derive the name from an email, display name, or raw database ID.

If the current Joblit UI has not supplied an opaque name yet, create one locally and keep the value shown in the install receipt:

```powershell
$profileName = 'joblit-' + ([guid]::NewGuid().ToString('N').Substring(0, 16))
```

## Preview

Preview performs package verification and read-only preflight checks. It does not change profile, auth, `.env`, service, or network state.

```powershell
.\tools\hermes\bootstrap\Install-JoblitHermes.ps1 `
  -PackagePath .\joblit-hermes-profile.zip `
  -ProfileName joblit-0123456789abcdef `
  -ExpectedArchiveSha256 <64-lowercase-hex> `
  -WhatIf
```

## Unverified Beta digest install

Beta mode requires the exact SHA-256 published beside the archive. It proves archive identity against that caller-supplied digest, but is labelled `beta-digest`; it is never a verified production release.

```powershell
.\tools\hermes\bootstrap\Install-JoblitHermes.ps1 `
  -PackagePath .\joblit-hermes-profile.zip `
  -ProfileName joblit-0123456789abcdef `
  -Port 8642 `
  -ExpectedArchiveSha256 <64-lowercase-hex>
```

## Production install

Production mode requires an Ed25519 manifest signature from a reviewed key in `integrations/hermes/trust/release-keys.json`. The initial registry is intentionally empty, so production install fails closed until release trust is provisioned.

```powershell
.\tools\hermes\bootstrap\Install-JoblitHermes.ps1 `
  -PackagePath .\joblit-hermes-profile.zip `
  -ProfileName joblit-0123456789abcdef `
  -Production
```

The script verifies package contents before any Hermes mutation, promotes the verified files to a stable profile-scoped source under `~/.hermes/joblit-distributions/<profile>/current`, then invokes official commands equivalent to:

```text
hermes profile install <persistent-verified-directory> --name <profile> --yes
hermes profile update <profile> --yes
hermes -p <profile> auth status openai-codex
hermes -p <profile> auth add openai-codex  # only when status is logged out
hermes -p <profile> gateway install --start-now --start-on-login
```

It binds only `127.0.0.1`, creates a random 32-byte API key, atomically writes the profile-local `.env` with a current-user ACL, and advertises the opaque profile name as `API_SERVER_MODEL_NAME`. It probes `/health` plus authenticated `/v1/capabilities`, `/v1/models`, and `/v1/toolsets`, validates the exact Runs API routes, and rejects any enabled executable tools. It never sends a billable run. A newly generated API key appears once for pasting into Joblit; structured status and the receipt contain only its fingerprint.

Reruns preserve a strong existing key and unrelated well-formed environment variables. Existing managed profiles use `hermes profile update`; a legacy temporary source is migrated once with `profile install --force`. An unrelated profile, unknown `.env`, public bind, weak key, occupied fresh port, config difference, profile drift, or untrusted package stops installation. After reviewing a verified config change, `-ForceConfigUpdate` is the only path that adds `--force-config` to `hermes profile update`.

## Read-only readiness check

```powershell
.\tools\hermes\bootstrap\Test-JoblitHermes.ps1 -ProfileName joblit-0123456789abcdef
```

Exit categories: `0 Ready`, `10 MissingHermes`, `20 UntrustedPackage`, `30 ProfileDrift`, `40 AuthModelMismatch`, `50 GatewayDown`, `60 ApiIncompatible`. The verifier prints one official recovery action and never changes local state or reveals the API key.

Deleting a Hermes Session through its Sessions API is logical transcript deletion only. It is not secure erase, proof of zero retention, or deletion of provider-side records.
