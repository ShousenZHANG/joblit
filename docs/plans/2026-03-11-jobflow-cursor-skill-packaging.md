# Joblit Cursor Skill (A+B install) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a single-source Cursor Skill for Joblit that supports both manual copy installation and `npx skills add` installation.

**Architecture:** Put the canonical skill under `skills/joblit/` and keep `cursor-skill/` as a lightweight installer entry that points users to the canonical folder, avoiding dual maintenance.

**Tech Stack:** Markdown files only (Cursor Skill format).

---

### Task 1: Create canonical skill folder

**Files:**
- Create: `skills/joblit/SKILL.md`
- Create: `skills/joblit/README.md`
- Create: `skills/joblit/references/PATHS.md`
- Create: `skills/joblit/references/FLOWS.md`

- [ ] **Step 1: Add `skills/joblit/SKILL.md`**
Expected: Short skill with triggers, mental model, key paths, non-negotiable rules.

- [ ] **Step 2: Add `skills/joblit/README.md`**
Expected: Two install options:
1) manual copy to `~/.cursor/skills/joblit`
2) `npx skills add https://github.com/ShousenZHANG/joblit.git --skill joblit -y -g`

- [ ] **Step 3: Add `references/` docs**
Expected: PATHS and FLOWS contain the high-signal indexes without bloating SKILL.md.

### Task 2: Convert `cursor-skill/` to installer entry

**Files:**
- Modify: `cursor-skill/README.md`
- Delete: `cursor-skill/SKILL.md`
- Delete: `cursor-skill/references/PATHS.md`

- [ ] **Step 4: Update `cursor-skill/README.md`**
Expected: It points users to `skills/joblit/` for both installation methods.

- [ ] **Step 5: Remove duplicate skill content from `cursor-skill/`**
Expected: No second SKILL.md to maintain.

### Task 3: Verify and commit

- [ ] **Step 6: Verify repository status**

Run:

```bash
git status
```

Expected: New files in `skills/joblit/` tracked; deletions in `cursor-skill/` staged.

- [ ] **Step 7: Commit**

Run:

```bash
git add skills/joblit cursor-skill docs/superpowers/specs/2026-03-11-joblit-cursor-skill-packaging-design.md docs/plans/2026-03-11-joblit-cursor-skill-packaging.md
git commit -m "docs(skills): package joblit Cursor skill (manual copy + skills CLI)"
```

