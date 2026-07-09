import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getOrCreateClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import '../guided.css'

export const dynamic = 'force-dynamic'

export default async function IntakeShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/intake')

  await getOrCreateClientIntakeForUser(supabase, user)

  return <>{children}</>
}
