'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

interface AuthState {
  token: string | null
  session: Session | null
}

const AuthContext = createContext<AuthState>({ token: null, session: null })

export function AuthTokenProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, session: null })

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setState({ token: session?.access_token ?? null, session })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setState({ token: session?.access_token ?? null, session })
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/**
 * Returns the current Supabase access token, or null while loading / signed out.
 * Subscribes once at the provider level — does not trigger a per-component getSession() round-trip.
 */
export function useAccessToken(): string | null {
  return useContext(AuthContext).token
}

/**
 * Returns the current Supabase session, or null while loading / signed out.
 * Use when you need user info (email, user_metadata) in addition to the access token.
 */
export function useAuthSession(): Session | null {
  return useContext(AuthContext).session
}
