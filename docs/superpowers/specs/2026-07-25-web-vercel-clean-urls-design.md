# Web Vercel Clean URLs Design

## Goal

Deploy the existing Expo Web static export to the linked `worth` Vercel project
so Expo Router paths such as `/capture` resolve without a `.html` suffix.

## Design

- Add `mobile/vercel.json` with `"cleanUrls": true` and one filesystem-fallback
  rewrite to `/` so Expo Router can resolve dynamic deep links such as
  `/asset/<id>` in the browser.
- Keep Expo's existing static export (`npx expo export --platform web`) and deploy
  the generated `mobile/dist` directory.
- Keep Vercel Authentication enabled and remove public production aliases. The
  client currently embeds fixed administrator credentials, so the deployment
  must not be publicly accessible.
- Do not add per-route rewrites, a custom server, deployment automation, or
  dependencies.
- Do not deploy the FastAPI server in this change. Features that require
  `EXPO_PUBLIC_API_URL` remain unavailable until a separate backend deployment.

## Verification

- Expo Web export completes.
- The protected deployment returns HTTP 200 for `/`, `/capture`, `/memories`,
  a representative dynamic route, and the generated JavaScript bundle.
- An anonymous request redirects to Vercel Authentication.
- No public production alias points to the deployment.
