# Web Vercel Clean URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing Expo Web export behind Vercel Authentication with extensionless Expo Router paths working.

**Architecture:** Expo continues to produce static files in `mobile/dist`. Vercel `cleanUrls` maps extensionless requests to exported HTML files, and one filesystem-fallback rewrite serves `/` for dynamic Expo Router deep links.

**Tech Stack:** Expo SDK 57, Expo Router static export, Vercel static hosting

## Global Constraints

- Keep Vercel Authentication enabled.
- Do not expose a public production alias while fixed administrator credentials are embedded.
- Do not add per-route rewrites, a custom server, deployment automation,
  dependencies, or a FastAPI deployment.
- Backend-dependent features remain unavailable until `EXPO_PUBLIC_API_URL` points to a separately deployed API.

---

### Task 1: Enable Clean URLs and redeploy

**Files:**
- Create: `mobile/vercel.json`

**Interfaces:**
- Consumes: Expo's `mobile/dist/*.html` static export.
- Produces: Vercel extensionless routes such as `/capture`.

- [ ] **Step 1: Confirm the current deployment reproduces the routing failure**

Run:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://worth-cupm5h9py-ylw5s-projects.vercel.app/capture
```

Expected: `302` to Vercel Authentication anonymously; the authenticated deployment smoke already records `/capture` as `404`.

- [ ] **Step 2: Add the minimal Vercel configuration**

Create `mobile/vercel.json`:

```json
{
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/"
    }
  ]
}
```

- [ ] **Step 3: Verify the Expo Web export**

Run:

```bash
cd mobile
npx expo export --platform web
```

Expected: exit code `0`, `Exported: dist`, and generated HTML plus JavaScript assets under `mobile/dist`.

- [ ] **Step 4: Deploy without assigning a public alias**

Run from the repository root:

```bash
vercel deploy mobile/dist \
  --yes \
  --project worth \
  --local-config mobile/vercel.json \
  --logs
```

Expected: a Preview deployment reaches `READY`.

- [ ] **Step 5: Verify protected routes and assets**

Run each request with `vercel curl`, targeting the new deployment URL:

```bash
vercel curl / --deployment "$DEPLOYMENT_URL" -- --silent --output /dev/null --write-out '%{http_code}\n'
vercel curl /capture --deployment "$DEPLOYMENT_URL" -- --silent --output /dev/null --write-out '%{http_code}\n'
vercel curl /memories --deployment "$DEPLOYMENT_URL" -- --silent --output /dev/null --write-out '%{http_code}\n'
vercel curl /asset/example --deployment "$DEPLOYMENT_URL" -- --silent --output /dev/null --write-out '%{http_code}\n'
```

Expected: every route returns `200`. Request the generated JavaScript bundle the same way and expect `200` with a non-zero body.

- [ ] **Step 6: Verify anonymous access remains protected**

Run:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$DEPLOYMENT_URL"
vercel alias ls
```

Expected: anonymous access returns `302` to `vercel.com/sso-api`; no public alias points to the new deployment.

- [ ] **Step 7: Commit the deployment configuration**

```bash
git add mobile/vercel.json
git diff --cached --check
git commit -m "chore: configure Expo web clean URLs"
```
