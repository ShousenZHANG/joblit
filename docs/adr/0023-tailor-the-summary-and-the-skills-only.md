# ADR-0023: Tailor the summary and the skills, and nothing else

- Status: Accepted
- Date: 2026-08-17
- Supersedes the generation half of ADR-0001 and ADR-0002's bullet review; retires
  the evidence ledger those two introduced.
- Does **not** supersede ADR-0011 (document-level publication) or ADR-0015
  (no server-side model keys). Both hold unchanged.

## Context

Tailoring produced three things per job: a rewritten CV summary, up to three
AI-added experience bullets, and three cover-letter paragraphs. The bullets
were the expensive third.

They arrived with a grounding gate, an evidence ledger (`EvidenceSnapshot` +
`ClaimEvidence`, built at every commit), a review verdict, and a `review_blocked`
outcome threaded through the commit boundary, both edit routes and finalize.
The gate blocked on exactly two conditions: an accepted added bullet with no
supporting evidence, and a numeric claim whose digits appeared nowhere in the
candidate's profile.

Two things were true at once. The machinery was the largest single body of
logic in the application layer, and it was guarding content the product did not
need. A resume's experience bullets are the candidate's own record; a model
rewriting them produces claims the candidate must then defend in an interview,
which is why the same failure mode already retired AI-proposed skills
(`skillsAdditions`, see CONTEXT.md → AI Content) — the model kept proposing
skills the candidate had no evidence for, and the gate blocked nearly every
draft that carried them.

What per-job tailoring is actually for is narrower: state the target role in the
summary, and put the skills that role asks for where a recruiter will see them.
Both are things the candidate already has.

## Decision

Tailoring changes the summary and the skills section. It writes no experience
bullets and invents no skills.

**Summary.** Regenerated per job, `120..350` characters — a window, not a
ceiling, because a model fills whatever space it is given and a summary long
enough to become a paragraph is a summary recruiters skip. Guarded by three
deterministic checks at the import boundary
(`lib/server/ai/summaryLint.ts`):

1. it must contain the posting's job title with seniority words stripped, so a
   candidate claims the role and not the level;
2. every number in it must already appear on the master profile;
3. every gazetteer-recognised skill in it must already appear on the master
   profile.

**Skills.** The model returns *index references* into the candidate's own skill
bank — `{ group, items }` where both are positions in `ResumeProfile.skills` —
selecting, dropping and ordering. It never returns a skill name. The server
rejects any index that does not resolve against the profile
(`SKILLS_SELECTION_INVALID`), and the render path resolves indexes back into the
profile's own strings.

**Cover letter.** Unchanged: three body paragraphs.

**Deleted.** `addedBullets` and the whole bullet pipeline; `evidenceLedger.ts`,
`persistReviewLedger.ts`, `evidenceHashing.ts`; the `EvidenceSnapshot` and
`ClaimEvidence` tables, the `EvidenceKind` enum and `Application.reviewReport`;
the `review` and `evidence` halves of the AI Content aggregate; the
`review_blocked` commit outcome and `refresh_review` command; the tailoring PDF
preview route and both preview panes; the standalone `/jobs/[id]/tailor` route
tree, folded into a single dialog.

## Why references instead of generated text

This is the load-bearing choice, and it is what makes deleting the ledger safe.

A gate that judges generated text is a probabilistic check on a probabilistic
output. The retired grounding gate demonstrated both failure directions: it
blocked drafts that were fine, and it could not prove the ones it passed. A
model that can only return integers cannot fabricate — the failure mode is
addressed out of existence rather than detected after the fact.

The same reasoning sets the summary rules. All three are string comparisons
against the profile and the posting. None of them asks a model to judge a
model, which is precisely what the previous gate did.

New skills still enter a resume the same way they always should have: the
candidate types them into the Resume Studio.

## Consequences

**The evidence ledger's remaining value was small.** Its two blocking rules
were bullet-shaped. Once bullets stop being generated, rule one has nothing to
judge and rule two guards a single 350-character field — which the summary lint
now does with no stored state. Two tables and a per-commit build step bought
one check that a `String.includes` performs.

**Keywords in context are lost.** The industry evidence for JD tailoring
favours keywords inside experience bullets over a skills block, which
recruiters discount when it reads as a wall. This decision accepts that cost:
the alternative is generating experience text, and the candidate's ability to
defend every line of their own resume outranks a second-order screening gain.
Bullet *reordering* — selection without rewriting, under the same index-
reference pattern as skills — would recover part of it without reintroducing
fabrication, and is the natural next step if the gap proves to matter.

**Nothing renders a PDF until Finalize.** The preview compiled LaTeX on every
edit through a single remote renderer protected by one circuit breaker. With
the reviewable delta now a summary, a skills order and three paragraphs, a text
diff carries the same information, and Finalize remains idempotent for a
repeated click.

**A v1 row still reads.** `aiContentSchema` upgrades it on read: the ledger and
the bullets are dropped, the summary and cover survive, and the skills selection
is left absent — which the renderer treats as "use the master profile's skills
as they are", exactly what that row already produced. Published PDFs are
untouched.

**The prompt must show the bank.** A model cannot return an index it cannot
see, so the resume prompt now carries the candidate's numbered skill groups.
`RESUME_PROMPT_SNAPSHOT_LIMITS.skills` was raised to match
`ResumeProfileSchema.skills` (12 groups of 30) — a tighter snapshot cap would
not merely shorten the prompt, it would make the skills past the cap
permanently unselectable with nothing telling the user which ones.
