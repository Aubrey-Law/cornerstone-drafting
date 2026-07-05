'use client'

import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { useCallback } from 'react'
import type { UserPreferences } from '@/lib/userPreferences'

export function useUserPreferences() {
  const accessToken = useAccessToken()

  const savePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    if (!accessToken) return null
    const response = await fetch('/api/admin/me/preferences', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preferences: patch }),
    })
    const data = await response.json().catch(() => ({})) as { preferences?: UserPreferences; error?: string }
    if (!response.ok) return null
    return data.preferences ?? null
  }, [accessToken])

  const loadPreferences = useCallback(async () => {
    if (!accessToken) return null
    const response = await fetch('/api/admin/me/preferences', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json().catch(() => ({})) as { preferences?: UserPreferences }
    if (!response.ok) return null
    return data.preferences ?? null
  }, [accessToken])

  return { savePreferences, loadPreferences }
}
