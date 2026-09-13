import { NavigationTiming } from './components/NavigationTiming'
import { redirect } from 'next/navigation'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getFirmConfig } from '@/lib/firmConfig'
import { resolveFirmModel } from '@/lib/firmModels'
import { ANTHROPIC_MODEL_OPTIONS } from '@/lib/userPreferences'
import AdminLayoutClient from './AdminLayoutClient'
import { AuthTokenProvider } from '@/lib/auth/AuthTokenProvider'
import { profileServerRequest } from '@/lib/performance/serverRequestTiming'

const ADMIN_ROLES = ['attorney', 'admin']

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/** Friendly name for the model the assistant actually runs on — never hardcoded. */
async function assistantModelLabel(): Promise<string | null> {
  const model = (await resolveFirmModel('assistant'))?.trim()
  if (!model) return null
  const known = ANTHROPIC_MODEL_OPTIONS.find(option => option.id === model)
  return known ? known.label.replace(' (default)', '') : model
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profiled = await profileServerRequest('admin-layout', async measure => {
    const auth = await measure('auth', getCachedClaims)
    if (!auth) {
      redirect('/auth/login')
    }

    const role = await measure('role', () => getCachedUserRole(auth.id))
    if (!role || !ADMIN_ROLES.includes(role)) {
      redirect('/auth/login')
    }

    const firm = getFirmConfig()
    const meta = (auth.claims.user_metadata ?? {}) as { full_name?: string; name?: string }
    const userName =
      meta.full_name ??
      meta.name ??
      auth.email ??
      firm.attorneyShortName
    const userInitials = initialsFor(userName)
    const modelLabel = await measure('model-label', assistantModelLabel)

    return (
      <AuthTokenProvider>
        <div className="admin-root">
          <NavigationTiming />
          <AdminLayoutClient
            userName={userName}
            userInitials={userInitials}
            assistantModelLabel={modelLabel}
          >
            {children}
          </AdminLayoutClient>
        </div>
      </AuthTokenProvider>
    )
  })
  return profiled.value
}
