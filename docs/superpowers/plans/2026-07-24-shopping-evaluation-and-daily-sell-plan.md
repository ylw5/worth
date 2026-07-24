# Shopping Evaluation and Daily Sell Plan Implementation Plan

**Goal:** Add an independent “评估” tab for fact-based pre-purchase analysis, and add a daily best sell combination with history and market refresh to each confirmed wishlist goal.

**Architecture:** Supabase remains the owner-scoped persistence layer. FastAPI performs external product-page parsing, AI-assisted product classification, deterministic personal-history matching, and deterministic sell-combination optimization. The Expo app orchestrates user-owned data through RLS, persists immutable evaluation/daily-plan snapshots, and keeps the existing asset, wishlist, and account flows.

**Tech Stack:** Expo SDK 57, Expo Router native tabs, React Native, TanStack Query, Supabase Postgres/RLS, FastAPI, DeepSeek V4 Chat Completions, OpenAI Responses API for vision fallback, pytest, Node test runner.

## Product Boundaries

- Wishlist items are confirmed needs and are never sent through purchase evaluation.
- Evaluation accepts a product URL, direct text, imported images, or a camera capture and analyzes it against the user's own asset history.
- Evaluation output is factual and never says “应该买” or “不应该买”.
- Each evaluation remains an owner-scoped conversation with persistent user and assistant messages.
- Daily sell plans only include assets explicitly marked `idle` or `listed`.
- A daily plan is lazily generated on first open; manual refresh updates market valuations first and replaces that day's snapshot.
- Historical daily snapshots remain stable even if later asset data changes.
- Market refresh failures fall back to the latest stored valuation and are surfaced to the user.

## Phase 1: Data foundation

- Add asset `subcategory` and lifecycle status (`in_use`, `idle`, `listed`, `sold`).
- Persist latest low/high market range on the asset row for efficient combination reads.
- Add owner-only `purchase_evaluations` snapshots.
- Add owner-only `sell_plan_snapshots`, unique per wishlist item and local calendar date.
- Extend mobile/server domain models and asset edit/detail UI.
- Add migration-level ownership checks and indexes.

## Phase 2: Evaluation tab

- Add safe HTTP(S) product-page reader with private-network blocking, redirect validation, size limits, and timeouts.
- Extract JSON-LD/OpenGraph title and price without allowing AI to invent price data.
- Use AI only to normalize product title and map it to the existing category plus a useful subcategory.
- Match only idle/listed/sold assets, preferring exact normalized subcategory.
- Return a structured evidence snapshot and neutral factual narrative.
- Add `(evaluation)` native tab, URL/text/image/camera inputs, conversational result screen, and newest-first evaluation history.
- Reuse the asset photo picker, private upload bucket, and OpenAI vision pipeline through a product-specific recognition schema.
- Persist a complete snapshot so past evaluations do not change when assets are edited.
- Persist conversation messages separately so users can continue a long evaluation flow across app launches.

## Phase 3: Daily wishlist sell plan

- Add deterministic sell-plan optimizer using conservative low prices when available.
- Prefer reaching the target with fewer items, then lower overage; if impossible, maximize coverage.
- Add wishlist detail screen showing today's plan, coverage, valuation time, and selected assets.
- Lazily generate one plan per day.
- Add “刷新行情与方案”: refresh only idle/listed assets, tolerate partial failures, then replace today's snapshot.
- Add daily history list and historical detail display.

## Phase 4: Verification

- Server tests: safe URL validation, page extraction, factual matching, sell-plan edge cases.
- Mobile tests: evaluation URL validation and sell-plan snapshot helpers.
- Run all Node tests, TypeScript, Expo lint, pytest, and diff checks.
- Verify empty history, no matching assets, no sellable assets, insufficient coverage, stale/failed valuation, and same-day refresh states.

## API Contracts

- `POST /products/parse`
  - Input: `{ url }`
  - Output: `{ url, title, price, category, subcategory }`
- `POST /products/normalize-text`
  - Input: `{ text, price? }`
  - Output: normalized product snapshot with `source_type: "text"`
- `POST /products/analyze-images`
  - Input: one to five private signed image URLs
  - Output: visually recognized product snapshot with `source_type: "image"`
- `POST /purchase-evaluations/evaluate`
  - Input: structured product plus owner-scoped asset summaries
  - Output: matched asset evidence and factual narrative
- `POST /purchase-evaluations/chat`
  - Input: immutable evaluation facts plus the bounded conversation history
  - Output: one neutral assistant message
- `POST /sell-plans/recommend`
  - Input: target price plus owner-scoped sellable asset valuation summaries
  - Output: selected items, conservative total, coverage ratio, and reachability

## Delivery Order

1. Migration and shared models.
2. Asset lifecycle editing.
3. Server product parsing/evaluation and tests.
4. Evaluation tab and persistence.
5. Server optimizer and tests.
6. Wishlist daily-plan UI, history, and refresh.
7. Full verification and handoff.
