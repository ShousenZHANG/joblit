# Joblit Cursor Skill

Install this skill so Cursor’s AI understands the `joblit` codebase (structure, APIs, conventions) when contributing or debugging.

Repo: `https://github.com/ShousenZHANG/joblit.git`

## Install

### Option A — manual copy (Cursor)

Copy `skills/jobflow` into your Cursor skills directory:

```bash
mkdir -p ~/.cursor/skills
cp -r skills/jobflow ~/.cursor/skills/jobflow
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cursor\skills"
Copy-Item -Recurse -Force "skills\jobflow" "$env:USERPROFILE\.cursor\skills\jobflow"
```

### Option B — skills CLI

```bash
npx skills add https://github.com/ShousenZHANG/joblit.git --skill jobflow -y -g
```

## Contents

- `SKILL.md` — main AI instructions
- `references/` — deeper path and flow references

