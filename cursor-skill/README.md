# Joblit Cursor Skill (installer entry)

This repo ships a Cursor Skill at `skills/joblit/`. This `cursor-skill/` folder is kept as a **convenience entry point** for users who look for a Cursor skill folder name directly.

Repo: `https://github.com/ShousenZHANG/joblit.git`

## Install

### Option A — manual copy (Cursor)

Copy `skills/joblit` into your Cursor skills directory:

```bash
mkdir -p ~/.cursor/skills
cp -r skills/joblit ~/.cursor/skills/joblit
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cursor\skills"
Copy-Item -Recurse -Force "skills\joblit" "$env:USERPROFILE\.cursor\skills\joblit"
```

### Option B — skills CLI

```bash
npx skills add https://github.com/ShousenZHANG/joblit.git --skill joblit -y -g
```

