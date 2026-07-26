# Production Backend and APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy every Worth backend component and publish a standalone Android APK in a GitHub Release.

**Architecture:** Keep Supabase as the mobile data plane, deploy the existing FastAPI app as a separate Vercel project, and redeploy the existing Cloudflare scheduled valuation Worker. Build the Expo app as a release APK with production URLs injected at build time.

**Tech Stack:** FastAPI, Vercel Python Runtime, Supabase CLI, Cloudflare Python Workers, Expo SDK 57, Gradle, GitHub Releases

## Global Constraints

- Do not commit or print credentials.
- Preserve the existing `worth` Vercel web project.
- The APK must use HTTPS production services and run without Metro or a local API.
- Touch only deployment configuration required by this release.

---

### Task 1: Production configuration

**Files:**
- Create: `server/api/index.py`
- Create: `server/vercel.json`
- Replace: `server/pyproject.toml` with `server/pytest.ini`
- Modify: `server/requirements.txt`
- Create: `server/requirements-local.txt`
- Modify: `server/app/main.py`
- Modify: `server/app/background_removal.py`
- Modify: `server/tests/test_background_removal.py`
- Modify: `server/tests/test_openai_service.py`
- Modify: `README.md`
- Modify: `mobile/app.json`

**Interfaces:**
- Consumes: existing `app.main:app` FastAPI instance and Expo app config
- Produces: standard Vercel Python Function entrypoint and Android package `com.ylw5.worth`

- [ ] **Step 1: Add the Vercel FastAPI entrypoint**

```python
from app.main import app
```

- [ ] **Step 2: Keep pytest config from being treated as package metadata**

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 3: Keep local background removal optional in production**

```text
-r requirements.txt
rembg[cpu]>=2.0.77,<3
```

Catch the absent optional import so `/cutout` returns its existing `null` fallback on Vercel.

- [ ] **Step 4: Place the API next to the Tokyo Supabase project**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["hnd1"],
  "functions": {
    "api/**/*.py": {
      "maxDuration": 60,
      "excludeFiles": "{tests/**,**/test_*.py}"
    }
  },
  "rewrites": [{"source": "/(.*)", "destination": "/api"}]
}
```

- [ ] **Step 5: Add a stable Android application ID**

```json
"android": {
  "package": "com.ylw5.worth",
  "versionCode": 1
}
```

- [ ] **Step 6: Verify configuration**

Run: `cd server && .venv/bin/python -m pytest -q`

Expected: all server tests pass.

Run: `cd mobile && npm run lint && npx tsc --noEmit && npx expo config --type public`

Expected: lint and TypeScript pass; Expo config reports `com.ylw5.worth`.

### Task 2: Deploy FastAPI and database

**Files:**
- Create: `supabase/migrations/20260725131327_chat_tool_execution_trace.sql`
- Read only: `server/.env`
- Read only: `.env.local`

**Interfaces:**
- Consumes: existing local production secrets and Supabase migration files
- Produces: HTTPS FastAPI production URL and current production database schema

- [ ] **Step 1: Create and link the `worth-api` Vercel project**

Run: `vercel project add worth-api && vercel link --cwd server --project worth-api --yes`

Expected: `server/.vercel/project.json` names `worth-api`.

- [ ] **Step 2: Upload only required server environment variables**

Run `vercel env add` for `AI_GATEWAY_API_KEY`, `OPENAI_MODEL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `XIANYU_COOKIE`, reading values from ignored `server/.env` through stdin.

Expected: `vercel env ls --cwd server` lists each name for Production.

- [ ] **Step 3: Reconcile and apply pending Supabase migrations**

Restore the missing local migration file from production history, mark the already-present `202607250010` schema as applied, then run: `npx supabase db push --db-url "$worth_db_url" --include-all`

Expected: migration list reports local and remote histories aligned.

- [ ] **Step 4: Deploy and smoke-test FastAPI**

Run: `vercel deploy --prod --cwd server --yes`

Expected: `GET /health` returns `{"status":"ok"}`; an authenticated request reaches the production API.

### Task 3: Deploy scheduled valuation backend

**Files:**
- Read only: `cloudflare/wrangler.toml`

**Interfaces:**
- Consumes: existing Cloudflare secrets and `MarketWorkflow`
- Produces: deployed `worth-background` Worker with daily Cron

- [ ] **Step 1: Run Worker checks**

Run: `cd cloudflare && uv run pytest -q && uv run pywrangler deploy --dry-run`

Expected: tests pass and dry-run completes.

- [ ] **Step 2: Deploy Worker**

Run: `cd cloudflare && uv run pywrangler deploy`

Expected: Cloudflare reports a successful Worker and Workflow deployment.

### Task 4: Build and publish the APK

**Files:**
- Generated and ignored: `mobile/android/`
- Generated: `mobile/android/app/build/outputs/apk/release/app-release.apk`

**Interfaces:**
- Consumes: production FastAPI URL and existing ignored mobile credentials
- Produces: signed installable APK in a GitHub Release

- [ ] **Step 1: Generate the Android project**

Run: `cd mobile && CI=1 npx expo prebuild --platform android --clean`

Expected: `mobile/android/gradlew` exists and package is `com.ylw5.worth`.

- [ ] **Step 2: Build the standalone APK**

Run: `cd mobile/android && ./gradlew assembleRelease`

Expected: `app/build/outputs/apk/release/app-release.apk` exists.

- [ ] **Step 3: Verify the artifact**

Run: `apksigner verify --verbose mobile/android/app/build/outputs/apk/release/app-release.apk`

Expected: signature verification succeeds and the manifest contains `com.ylw5.worth`.

- [ ] **Step 4: Commit deployment configuration and push**

Run: `git add README.md server/api/index.py server/vercel.json server/pytest.ini server/pyproject.toml server/requirements.txt server/requirements-local.txt server/app/main.py server/app/background_removal.py server/tests/test_background_removal.py server/tests/test_openai_service.py mobile/app.json supabase/migrations/20260725131327_chat_tool_execution_trace.sql docs/superpowers/plans/2026-07-26-production-backend-and-apk.md && git commit -m "chore: configure production backend and Android release" && git push origin main`

Expected: `origin/main` contains the deployment configuration and no secrets.

- [ ] **Step 5: Publish GitHub Release**

Run: `gh release create v1.0.0 mobile/android/app/build/outputs/apk/release/app-release.apk#worth-v1.0.0.apk --repo ylw5/Six-of-Pentacles --title "Worth v1.0.0" --notes "Standalone Android APK using the production Worth backend."`

Expected: the public Release page contains downloadable `worth-v1.0.0.apk`.
