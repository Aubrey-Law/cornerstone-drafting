import { Suspense } from 'react'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { SettingsNav } from './SettingsNav'

/** Every settings page — tabs and their own routes alike — shares the side menu. */
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCachedClaims()
  const role = auth ? await getCachedUserRole(auth.id) : null

  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <Suspense fallback={null}>
        <SettingsNav isAdministrator={role === 'admin'} />
      </Suspense>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
