'use client'

import { useCallback } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { downloadBlob } from '@/lib/browserDownload'

/** Bearer-authenticated JSON calls and downloads for the payroll routes. */
export function usePayrollApi() {
  const token = useAccessToken()

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
    const body = await res.json().catch(() => ({})) as T & { error?: string }
    if (!res.ok) throw new Error(body.error ?? 'Payroll request failed')
    return body
  }, [token])

  const download = useCallback(async (path: string, filename: string) => {
    const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? 'Download failed')
    }
    downloadBlob(await res.blob(), filename)
  }, [token])

  return { token, request, download }
}
