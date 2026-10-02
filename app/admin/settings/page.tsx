import { redirect } from 'next/navigation'
import { StaffSettingsClient } from './StaffSettingsClient'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  // Templates moved to the Library; keep old bookmarks and links working.
  if ((await searchParams).tab === 'templates') redirect('/admin/works?tab=email-templates')
  const auth = await getCachedClaims()
  const role = auth ? await getCachedUserRole(auth.id) : null
  return <StaffSettingsClient isAdministrator={role === 'admin'} />
}
