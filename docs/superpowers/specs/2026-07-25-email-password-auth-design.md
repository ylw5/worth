# Email and Password Authentication Design

## Goal

Replace the fixed administrator auto-login with shared email/password
authentication for iOS, Android, and Web. New users can register and use the app
immediately.

## Authentication

- Reuse the installed Supabase client and its existing persisted session storage.
- Support sign-in and sign-up with email and password on one screen.
- Disable Supabase Confirm Email so a successful sign-up returns a session
  immediately.
- Restore an existing session at startup and subscribe to Supabase auth changes.
- Add sign-out to the account screen.
- Remove runtime use of `EXPO_PUBLIC_ADMIN_EMAIL` and
  `EXPO_PUBLIC_ADMIN_PASSWORD`. Existing administrator data stays attached to
  that Supabase user and remains available by signing in with the same account.

## Navigation

- Keep the root index route as the authentication entry point.
- Redirect an authenticated user from the index route to the asset list.
- Guard the tab navigator and top-level asset routes on the client and return
  unauthenticated users to the index route.
- Do not use Expo Router `Stack.Protected`: protected routes are omitted during
  static generation, while this deployment needs direct static Web routes.

## Interface

- The index screen offers a compact toggle between `登录` and `注册`.
- Both modes contain email and password fields, one primary submit button, and
  an inline error message.
- Disable duplicate submission while the request is pending.
- The account screen displays the current email and a `退出登录` button.
- Replace the `固定管理员` role copy with ordinary account status.

## Data and Security

- Keep the existing `auth.uid()` RLS policies; no schema or existing user data
  migration is required.
- A new account starts with an empty private asset library.
- Keep only the Supabase URL and publishable/anon key in client environment
  variables.
- Validate non-empty normalized email and a password of at least six characters
  before calling Supabase.
- Keep Vercel Authentication enabled until the new auth flow and anonymous
  production smoke test pass. Public promotion is a separate final step after
  the fixed credentials are absent from the built bundle.

## Excluded

- Password reset
- OAuth or social login
- Profiles, display names, avatars, and roles
- Email verification
- Auth framework replacement

## Verification

- Unit-check input normalization and validation.
- Confirm sign-in, immediate sign-up, sign-out, and persisted-session recovery.
- Confirm unauthenticated deep links return to the auth screen.
- Confirm two users cannot read or mutate each other's rows or Storage objects.
- Export Expo Web, deploy with Clean URLs, and smoke-test the root, auth flow,
  tab routes, an asset route, and the generated JavaScript bundle.
- Confirm the built bundle does not contain the fixed administrator email or
  password before removing Vercel Authentication or assigning a public alias.
