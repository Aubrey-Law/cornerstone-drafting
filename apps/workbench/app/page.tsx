import Link from 'next/link'
import { Button } from '@aubrey-law/ui/button'

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Aubrey Law</p>
        <h1 className="text-3xl font-semibold tracking-tight">Workbench</h1>
        <p className="text-muted-foreground">
          Matter-centric drafting. The portal, drafting, intake and task surfaces land here phase
          by phase; nothing is wired to a matter yet.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/api/health?check=env">Check configuration</Link>
        </Button>
      </div>
    </main>
  )
}
