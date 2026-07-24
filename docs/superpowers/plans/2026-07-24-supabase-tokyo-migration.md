# Supabase Tokyo Migration Implementation Plan

> **For agentic workers:** Execute these steps inline and stop before cutover if any count, authentication, or Storage verification fails.

**Goal:** Move Worth from Supabase `us-east-1` to Tokyo `ap-northeast-1` without deleting the Virginia project.

**Architecture:** Provision a second Vercel Marketplace Supabase resource with `TOKYO_`-prefixed variables, rebuild its schema from the repository migrations, and copy the single administrator plus business rows and private Storage objects. Cut canonical environment variables over only after source/target counts and authenticated reads match.

**Tech Stack:** Vercel CLI, Supabase CLI, Supabase Auth Admin API, PostgREST, Storage API, repository SQL migrations.

## Global Constraints

- Keep `supabase-cordovan-queen` unchanged as the rollback source.
- Never print, commit, or persist database passwords, API keys, administrator credentials, or `XIANYU_COOKIE`.
- Target Vercel/Supabase region is Tokyo `hnd1` / `ap-northeast-1`.
- Do not switch canonical environment variables until schema, data, Storage, and authentication checks pass.
- Do not commit generated environment files or migration exports.

---

### Task 1: Provision the isolated Tokyo resource

**Files:**
- No tracked files modified.

- [x] Create a free Vercel Marketplace Supabase resource named `supabase-worth-tokyo` with metadata `region=hnd1` and environment prefix `TOKYO_`.
- [x] Pull development variables into a temporary environment file.
- [x] Verify the generated Postgres pooler hostname contains `ap-northeast-1`.
- [x] Verify the original unprefixed resource still resolves to `us-east-1`.

### Task 2: Rebuild and verify the schema

**Files:**
- Read: `supabase/migrations/*.sql`

- [x] Link or address the Tokyo database using `TOKYO_POSTGRES_URL_NON_POOLING`.
- [x] Apply every repository migration with `npx supabase db push --db-url "$TOKYO_POSTGRES_URL_NON_POOLING" --include-all`.
- [x] Query every expected public table through the target REST API.
- [x] Verify the private `asset-photos` bucket exists.

### Task 3: Copy authentication, rows, and Storage

**Files:**
- Temporary JSON and object files only.

- [x] Create the confirmed Tokyo administrator with the existing local administrator email and password.
- [x] Record the source and target administrator UUIDs without printing either value.
- [x] Export all rows from `assets`, `valuations`, `wishlist_items`, `purchase_evaluations`, `evaluation_messages`, `sell_plan_snapshots`, `asset_sales`, `asset_status_events`, `analysis_runs`, `market_snapshots`, `asset_forecasts`, and `replacement_scenarios`.
- [x] Replace owner UUIDs and owner-prefixed Storage paths with the target administrator UUID.
- [x] Import tables in foreign-key order while preserving business IDs and timestamps.
- [x] Copy every private object to its rewritten owner-prefixed target path and preserve its content type.

### Task 4: Verify and cut over

**Files:**
- Update ignored local environment files only after verification.

- [x] Compare source and target row counts for every table.
- [x] Compare source and target Storage object counts.
- [x] Sign in to Tokyo with the administrator credentials and read the six migrated assets under RLS.
- [x] Upload and delete one temporary target Storage object to verify write policy.
- [x] Replace canonical Supabase/Postgres variables in Vercel development and production with the verified Tokyo values.
- [x] Pull canonical variables into `.env.local`, `server/.env`, and `mobile/.env.local` while preserving non-Supabase secrets.
- [x] Run the authenticated server smoke test and mobile TypeScript checks.
- [x] Keep the Virginia resource connected only as a rollback source; do not delete it.
