import { StaffSettingsClient } from './StaffSettingsClient'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'

export default async function AdminSettingsPage() {
  const auth = await getCachedClaims()
  const role = auth ? await getCachedUserRole(auth.id) : null
  return <StaffSettingsClient initialTab="models" isAdministrator={role === 'admin'} currentUserId={auth?.id ?? ''} />
}
