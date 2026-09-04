import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <section className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          Nothing lives at this address. It may have moved as the workbench takes over screens
          from Cornerstone.
        </p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Back to the Workbench home
        </Link>
      </section>
    </main>
  )
}
