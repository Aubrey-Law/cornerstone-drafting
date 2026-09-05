import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@aubrey-law/ui/button'
import { SignOutButton } from '@/components/SignOutButton'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { getSessionUser } from '@/lib/supabase/server'

/**
 * The attorney's home. A placeholder for the Today view, but a real
 * authenticated page: reaching it proves the session round-trip works.
 *
 * The proxy has already denied an anonymous request, so the redirect below is
 * the second line rather than the gate — it covers the case where this page is
 * reached by a path the matcher does not select.
 */
export default async function TodayPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Aubrey Law</p>
        <h1 className="text-3xl font-semibold tracking-tight">Workbench</h1>
        <p className="text-muted-foreground">
          Signed in as {user.email ?? 'an account with no email on file'} ({user.role}). Matters,
          tasks and the drafting surfaces land here phase by phase.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link href="/review">Review a draft</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/funding">Funding</Link>
        </Button>
        <SignOutButton />
      </div>
    </main>
  )
}
