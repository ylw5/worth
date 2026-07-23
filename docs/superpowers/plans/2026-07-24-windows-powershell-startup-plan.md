# Windows PowerShell Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local App and API startup work from Windows PowerShell while preserving macOS/Linux commands.

**Architecture:** Let Expo load public App configuration from `mobile/.env.local`, then keep the npm start command shell-independent. Document platform-specific virtual-environment and Supabase commands in the root README.

**Tech Stack:** Expo SDK 57, npm, PowerShell, Python venv, FastAPI, Vercel CLI, Supabase CLI

## Global Constraints

- Support Windows PowerShell, not traditional CMD.
- Keep macOS/Linux instructions working.
- Do not add `cross-env`, `dotenv-cli`, or a custom launcher.
- Keep secrets out of tracked files.

---

### Task 1: Make Expo startup shell-independent

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/src/lib/api.ts`

**Interfaces:**
- Consumes: Expo CLI's native loading of `EXPO_PUBLIC_*` values from `mobile/.env.local`.
- Produces: A cross-platform `npm start` command and LAN API fallback when `EXPO_PUBLIC_API_URL` is blank.

- [ ] **Step 1: Confirm the current script is platform-specific**

Run:

```bash
node -e "const s=require('./mobile/package.json').scripts.start; if (!s.includes('set -a')) process.exit(1)"
```

Expected: exit code `0`, proving the current script contains POSIX-only syntax.

- [ ] **Step 2: Replace the start script**

Set the script to:

```json
"start": "expo start --lan"
```

- [ ] **Step 3: Preserve automatic API host fallback for a blank env value**

Change:

```ts
process.env.EXPO_PUBLIC_API_URL ??
```

to:

```ts
process.env.EXPO_PUBLIC_API_URL ||
```

- [ ] **Step 4: Verify the new command and TypeScript**

Run:

```bash
node -e "const s=require('./mobile/package.json').scripts.start; if (s !== 'expo start --lan') process.exit(1)"
cd mobile
npx tsc --noEmit
```

Expected: both commands exit `0`.

### Task 2: Document PowerShell and Unix startup

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `mobile/.env.example`, root `.env.local`, `server/.env`, and the commands from Task 1.
- Produces: Copy-pasteable PowerShell and macOS/Linux setup, startup, and verification commands.

- [ ] **Step 1: Add platform-specific Supabase commands**

Document the existing macOS/Linux flow and this PowerShell equivalent:

```powershell
vercel link
vercel integration add supabase
vercel env pull .env.local --environment=development --yes

$worthEnv = Get-Content .env.local | ConvertFrom-StringData
$env:POSTGRES_URL_NON_POOLING = $worthEnv.POSTGRES_URL_NON_POOLING.Trim('"')
npx supabase db push --db-url $env:POSTGRES_URL_NON_POOLING --include-all
```

- [ ] **Step 2: Add platform-specific API commands**

Document PowerShell:

```powershell
Set-Location server
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Set-Location ..
vercel env pull server/.env --environment=development --yes
Set-Location server
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Keep the corresponding `.venv/bin/python -m ...` commands for macOS/Linux.

- [ ] **Step 3: Document the mobile env file and App startup**

Tell users to create `mobile/.env.local` from `mobile/.env.example` and fill:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_ADMIN_EMAIL=
EXPO_PUBLIC_ADMIN_PASSWORD=
```

Explain that the Supabase values correspond to `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the root `.env.local`. `EXPO_PUBLIC_API_URL` may remain blank because LAN discovery is automatic.

- [ ] **Step 4: Add PowerShell verification commands**

Document:

```powershell
Set-Location mobile
npm run lint
npx tsc --noEmit

Set-Location ..\server
.\.venv\Scripts\python.exe -m pytest -q
```

- [ ] **Step 5: Run the complete local checks**

Run:

```bash
git diff --check
cd mobile
npm run lint
npx tsc --noEmit
cd ../server
.venv/bin/python -m pytest -q
```

Expected: no whitespace errors; lint, TypeScript, and pytest all pass.

- [ ] **Step 6: Commit the implementation**

```bash
git add README.md mobile/package.json mobile/src/lib/api.ts docs/superpowers/plans/2026-07-24-windows-powershell-startup-plan.md
git commit -m "fix: support Windows PowerShell startup"
```
