import type { Session } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

async function signInAsAdmin(): Promise<Session> {
  const email = process.env.EXPO_PUBLIC_ADMIN_EMAIL;
  const password = process.env.EXPO_PUBLIC_ADMIN_PASSWORD;
  if (!isSupabaseConfigured || !email || !password) {
    throw new Error('管理员环境变量尚未配置');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error('管理员自动登录失败，请重试');
  }
  return data.session;
}

/** Return a usable session, refreshing or re-logging in when needed. */
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (session) {
    const expiresAtMs = (session.expires_at ?? 0) * 1000;
    if (expiresAtMs > Date.now() + 60_000) return session;
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) return refreshed.session;
  }
  return signInAsAdmin();
}

/** Force recover after the server rejects the current access token. */
export async function recoverSession(): Promise<Session> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session) return refreshed.session;
  await supabase.auth.signOut().catch(() => undefined);
  return signInAsAdmin();
}
