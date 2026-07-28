# ADR-0011: Derive Application publication per document

- Status: Accepted
- Date: 2026-07-28

## Context

An Application stores one combined `aiContent` aggregate but publishes two
independent documents: Resume and Cover. The historical `Application.status`
could only describe the whole row. Finalizing either target wrote `FINAL`, while
editing either target wrote `DRAFT`. Consequently a Cover edit could make a
current Resume appear stale, and finalizing only Resume could incorrectly claim
that Cover was also current.

The product contract already requires per-document Finalize. The existing
single-row aggregate, whole-content compare-and-swap token, artifact lifecycle,
and Tailoring Run acceptance protocol remain valuable and must not fork into
parallel implementations.

## Decision

### Keep one Application aggregate and add four document identities

`Application.aiContent` remains the canonical combined proposal and
`aiContentHash` remains the whole-row compare-and-swap token. Add:

- `resumeContentHash`
- `resumePublishedHash`
- `coverContentHash`
- `coverPublishedHash`

A content hash is SHA-256 over a versioned, target-scoped projection of every
input that can change the rendered PDF. Resume includes the resolved summary,
experience index, accepted added bullet text, normalized Master Resume render
input, and effective render locale. Cover includes the three resolved
paragraphs, candidate header fields, role, company, and effective render
locale. Aggregate review, evidence, provenance, timestamps, and the other
target are excluded.

Document status is derived, never independently stored:

| Projection | Meaning |
|---|---|
| `MISSING` | The target has no publishable proposal content. |
| `DRAFT` | Current target content is not represented by the current PDF. The previous PDF may remain downloadable. |
| `FINAL` | A current PDF exists and `publishedHash = contentHash`. |

`Application.status` is retained as a compatibility projection. It is `FINAL`
when every present document is `FINAL`; missing optional targets are neutral.
Otherwise it is `DRAFT`.

### Centralize every transition

One Application Publication module owns target hashing, conservative legacy projection, status
projection, and state transitions. Draft edits and discard carry the previous
published hashes forward. A publication command advances only the artifact
targets committed by that command. Preview never advances a published hash.

Manual import, server batch generation, and Editor Finalize continue to converge
through the existing atomic Application artifact commit. That commit derives
the artifact content version from the target content hash and writes the four
publication columns, aggregate compatibility status, PDF pointer, artifact
lifecycle transition, review ledger, and Tailoring Run receipts together.
For a PDF commit, the transaction re-reads and share-locks the Profile and Job
render sources, then compares their exact render context with the snapshot used
for that PDF target. A mismatch rejects the commit and retires the staged
artifact. When a target-scoped comparison succeeds, aggregate projection still
uses the complete context rebuilt under those locks; it never reprojects the
other target from an older request snapshot.

Profile mutations acquire the Profile row lock before updating linked
Applications. This `Profile -> Application` order is shared with publication
transactions and prevents delete/rebase operations from inverting the lock
order.

Tailoring Run receipts add nullable `documentContentHash`. New receipts record
the target identity accepted by the command; historical receipts remain valid
without inventing a value.

### Normalize legacy rows conservatively

The migration is additive and does not manufacture hashes. A historical
aggregate `aiContentHash` or versioned URL cannot prove the Master Resume, Job,
locale, and renderer contract now included in a v2 target hash. Therefore every
pre-cutover PDF without an explicit target `publishedHash` remains downloadable
but is projected as Draft until that target is explicitly finalized.

## Consequences

- Resume and Cover can be Draft or Final independently.
- Editing one target cannot dirty the other.
- Updating the Master Resume or render-relevant Job fields makes the affected
  existing PDF Draft instead of returning it as an idempotent Finalize replay.
- Profile updates rebase each target independently, so a Resume-only change
  preserves an unchanged Cover publication proof.
- Reverting to content already represented by the current PDF restores Final
  without another upload.
- Repeat Finalize is target-idempotent and no longer depends on aggregate
  Application status.
- Whole-row browser concurrency remains intentionally conservative through
  `aiContentHash`; per-target compare-and-swap is a separate future decision.
- Four nullable columns are sufficient for the closed Resume/Cover contract.
  Publication history and arbitrary document types remain out of scope.

## Alternatives considered

### Persist per-target status fields

Rejected because status would duplicate facts already expressed by the content
hash, published hash, and PDF pointer and could drift from them.

### Add ApplicationDocument and immutable Publication tables

Rejected for this phase. They support arbitrary target types and publication
history, but the PRD explicitly defers history and currently has exactly two
closed targets. The publication module is the seam through which that internal
storage model can change later without changing callers.

## References

- ADR-0002 — unified Tailor edit flow
- ADR-0009 — Tailoring Run acceptance protocol
- ADR-0010 — durable Application artifact lifecycle
- PRD-0001 — Tailor Edit Step
