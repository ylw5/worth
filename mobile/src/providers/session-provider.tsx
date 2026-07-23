import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState } from 'react';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type SessionState = {
  session: Session | null;
  loading: boolean;
  error: string;
  retry: () => void;
};

const SessionContext = createContext<SessionState>({
  session: null,
  loading: true,
  error: '',
  retry: () => {},
});

async function getAdminSession() {
  const email = process.env.EXPO_PUBLIC_ADMIN_EMAIL;
  const password = process.env.EXPO_PUBLIC_ADMIN_PASSWORD;
  if (!isSupabaseConfigured || !email || !password) {
    throw new Error('管理员环境变量尚未配置');
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: login, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !login.session) {
    throw new Error('管理员自动登录失败，请重试');
  }
  return login.session;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: true,
    error: '',
    retry: () => {},
  });

  const authenticate = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const session = await getAdminSession();
      setState((current) => ({
        ...current,
        session,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : '管理员自动登录失败',
      }));
    }
  }, []);

  useEffect(() => {
    getAdminSession()
      .then((session) =>
        setState((current) => ({ ...current, session, loading: false })),
      )
      .catch((error) =>
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : '管理员自动登录失败',
        })),
      );
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((current) => ({ ...current, session, loading: false }));
    });
    return () => data.subscription.unsubscribe();
  }, [authenticate]);

  return (
    <SessionContext value={{ ...state, retry: authenticate }}>
      {children}
    </SessionContext>
  );
}

export const useSession = () => use(SessionContext);
