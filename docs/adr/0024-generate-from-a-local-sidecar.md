# ADR-0024: Generate from a local sidecar the browser triggers

- Status: Accepted
- Date: 2026-08-30
- Does **not** supersede ADR-0015 (no server-side model keys) or ADR-0023
  (tailor the summary and the skills only). Both hold unchanged, and this
  decision exists to keep the first one intact while removing the copy-paste
  step.
- Revisits the shape ADR-0022 retired — a process on the operator's machine —
  without reviving what made it fail. See "Why this is not the Runner".

## Context

Tailoring is manual copy/paste: the app issues a prompt, the user pastes it
into a chatbot, and pastes the answer back. That was the correct answer to
ADR-0015 — the server holds no model credential and calls no model, so the
generation has to happen somewhere the user controls.

The cost is the round trip. Every job means switching apps twice, and when a
gate rejects the answer, the user goes back and re-prompts by hand. Rejections
are not rare enough to ignore and not common enough to be the main event: a
60-case eval put first-pass at 90%, and the failures that repeat are the ones
a person has to babysit.

Three things had to stay true of any fix:

1. The server never holds a model credential and never calls a model.
2. The gates stay the judge. Nothing generated is accepted because a model
   said it was fine (ADR-0023).
3. It uses the operator's existing model subscription rather than adding
   per-token API spend.

## Decision

A local process — `tools/tailor/serve.mjs` — runs the generation loop on the
operator's machine, and the Tailor dialog calls it directly on loopback.

The loop is the one `tools/tailor/tailor.mjs` already ran from the terminal,
extracted into `tools/tailor/generateTailoring.mjs` so both entry points take
the same path:

```
build prompt (Joblit's own builder)
  -> hermes -z, openai-codex provider, operator's subscription
  -> acceptApplicationGeneration: decode, skills-by-index, summaryLint
  -> rejected? feed the typed error back and retry (cap 3, stop on repeat)
  -> accepted? hand the JSON to the browser
```

The browser then drives the same two session-authenticated calls a user would
have clicked through — import, then finalize — so one click ends at the
published PDF. The server sees exactly what it saw before; only the number of
human clicks changed. If the server refuses the import, the JSON falls back
into the paste box next to the error; if only the PDF render fails, the
imported draft lands on the review step for a manual publish.

**What one-click deliberately skips.** The review step is a prose-quality
check by a human — the gates verify groundedness, not writing. Chaining
straight to finalize trades that reading away for speed, with the operator's
eyes open: the review UI stays fully available afterwards (edit and re-publish
at any time). This trade is acceptable only because the operator is the sole
user; a product default would keep the human read.

## Amendment: the manual path is gone

This decision originally kept the copy-prompt/paste-result flow as a complete
fallback. It no longer exists. The prompt step, the paste box and the
skill-pack download were deleted from the dialog, which is now one button above
the Review and Publish phases.

The reasoning: a fallback nobody takes is not a safety net, it is a second
implementation to keep correct. It also made the entry point invisible — the
accordion opened on "copy the prompt", so the button that replaced that flow
sat collapsed inside the step it replaced.

What replaced it, deliberately narrower than a second flow:

- **A refused import keeps its result.** The generated JSON is held and the
  panel offers *Retry import* first — most refusals are transient (a rate
  limit, a blob upload) and re-running the model costs a minute and a slice of
  the subscription quota. *Copy the generated JSON* is the second escape, and
  falls back to a file download where the clipboard API is unavailable.
- **A failed render lands on Review.** The draft is stored and editable, so
  publishing is one click once the cause is fixed.
- **A wedged sidecar times out.** The sidecar runs the model with `spawnSync`,
  so a hung call blocks its event loop and it answers nothing further; the
  client gives up after five minutes rather than sitting on "Generating…"
  forever with no manual path to fall back to.

**No prompt provenance is claimed.** `promptMeta` was the receipt that a pasted
answer came from the prompt the server had issued — a guard against a human
pasting a stale prompt. The sidecar builds its own prompt from the profile as
it stands at generation time, so there is no stale prompt to catch, and sending
meta from a prompt that was never used would assert provenance the run does not
have. The import sends none.

**The generation locale is the import's locale.** The server resolves the
resume profile from the job's market; the sidecar takes a locale parameter that
defaulted to `en-AU`. Since skills are chosen by index into the candidate's own
bank, a CN job generated against the en-AU profile would select against one
bank and be stored against another — rejected if the indices fall out of range,
and silently wrong if they do not. The dialog passes
`marketStringToResumeLocale(job.market)` so both halves resolve the same
profile.

**Why loopback rather than the server.** Vercel cannot reach a laptop, and
moving generation server-side would mean the server holding a model
credential, which ADR-0015 forbids in terms that anticipated this exact
request. The alternative — the browser calling a model API directly with a
key in `localStorage` — satisfies ADR-0015 but abandons the subscription and
bills per token.

**Why the sidecar writes nothing.** It returns JSON to the page and stops.
Persistence stays with `POST /api/applications/manual-generate`, which is
session-authenticated and already owns that boundary.

**Auth, deliberately absent.** The sidecar binds to `127.0.0.1`, runs as the
operator, and uses the database credentials already in `.env`. There is no
per-request auth because there is no second user. CORS is a fixed allowlist —
the deployed origins and a local dev server — because echoing an arbitrary
Origin would let any page in the browser drive generation on this machine.

## Why this is not the Runner

ADR-0022 deleted a local process for zero adoption. The setup was the reason:
install Node and the Codex CLI, mint a bearer credential, keep a terminal
running, and only then generate. Three of those are gone here — no credential
to mint, no queue, no lease or receipt machinery — but one remains: a process
has to be running.

So the honest scope is that this is a personal tool. It is not a product
feature, and it will not be one until generation can happen without asking
someone to start a process. The manual path stays the default and stays
complete: the button fills the same textarea, and with the sidecar stopped
the dialog says so and the paste flow works exactly as before.

## Consequences

- The server is unchanged. No new route, no new credential, no new dependency.
- The gates remain the only judge, and the repair loop's feedback is their
  typed errors — not a model's opinion of a model's output.
- The model provider is replaceable. `hermes` is about thirty lines of the
  loop, and the subscription channel it uses could be closed by the provider
  at any time; swapping it for an API key or a different CLI is a local change.
- Generation cost stays at zero marginal spend, bounded by the operator's
  subscription quota rather than a token bill.
- A second user would need a real credential boundary before this could be
  exposed. Adding one is a new decision, not an extension of this one.
