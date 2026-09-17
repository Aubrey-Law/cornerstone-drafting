import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The root 404. Without this file Next serves its own unstyled page — no theme,
 * no fonts, no way back — which is what a client following a stale link to a
 * document or an expired intake URL has been landing on.
 *
 * Deliberately not `RouteErrorState`: that one is a client component that
 * reports to Sentry and offers a retry. A 404 is not an error to report, and
 * retrying the same URL does the same nothing, so this stays a server component
 * that only offers a way out.
 *
 * Both destinations are safe for either audience: `/admin` bounces a client to
 * the login and then to their own portal, and `/dashboard` does the same in
 * reverse for staff.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <FileQuestion className="size-10 text-muted-foreground" aria-hidden />
      <div className="max-w-md space-y-1">
        <h1 className="text-lg font-semibold">This page doesn&apos;t exist</h1>
        <p className="text-sm text-muted-foreground">
          The link may be out of date, or the page may have moved. Nothing has been lost — it is
          reachable from wherever you signed in.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" asChild>
          <Link href="/admin">Go to the firm app</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">Go to the client portal</Link>
        </Button>
      </div>
    </main>
  )
}
