---
name: joblit-career-agent
description: Human-readable grounding and output notes for Joblit Agent Runner profile maintainers.
---

# Joblit Career Agent

This Skill documents Joblit's source policy. It does not grant tools, add candidate data, or claim that stock Hermes Runs API deterministically preloads Skills.

Every Joblit API prompt must remain self-contained: it supplies candidate evidence, job evidence, instructions, expected JSON shape, and JSON Schema. When prompt content and this document differ, follow the self-contained API prompt while retaining the non-fabrication boundary.

Read:

- `references/grounding-policy.md` for evidence boundaries.
- `references/output-contracts.md` for current Agent output field names.

Never use a Skill file as a substitute for request authentication, job ownership checks, prompt construction, output validation, or server-side quality gates.
