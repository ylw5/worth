import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState } from 'react';

import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

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
      const session = await ensureSession();
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
    ensureSession()
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
