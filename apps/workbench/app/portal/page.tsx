import { redirect } from 'next/navigation'
import { SignOutButton } from '@/components/SignOutButton'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * The client's home. No client accounts use the Workbench yet, which is exactly
 * why the portal is built first: it is the only surface that can be got wrong
 * for free.
 */
export default async function PortalHomePage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your matter</h1>
        <p className="text-muted-foreground">
          Signed in as {user.email ?? 'your account'}. Your documents and messages appear here as
          they are prepared.
        </p>
      </div>
      <SignOutButton />
    </main>
  )
}
