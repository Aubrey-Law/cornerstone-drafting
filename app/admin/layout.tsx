import { redirect } from 'next/navigation'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getFirmConfig } from '@/lib/firmConfig'
import { isSmsConfigured, isVoiceConfigured } from '@/lib/communications/config'
import { resolveFirmModel } from '@/lib/firmModels'
import { ANTHROPIC_MODEL_OPTIONS } from '@/lib/userPreferences'
import AdminLayoutClient from './AdminLayoutClient'
import { AuthTokenProvider } from '@/lib/auth/AuthTokenProvider'

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
  const auth = await getCachedClaims()
  if (!auth) {
    redirect('/auth/login')
  }

  const role = await getCachedUserRole(auth.id)
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

  return (
    <AuthTokenProvider>
      <div className="admin-root">
        <AdminLayoutClient
          userName={userName}
          userInitials={userInitials}
          voiceEnabled={isVoiceConfigured()}
          smsEnabled={isSmsConfigured()}
          assistantModelLabel={await assistantModelLabel()}
        >
          {children}
        </AdminLayoutClient>
      </div>
    </AuthTokenProvider>
  )
}
