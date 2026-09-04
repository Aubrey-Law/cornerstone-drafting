import { Suspense } from 'react'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · Aubrey Law Workbench' }

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-muted-foreground">Aubrey Law</p>
        <h1 className="text-2xl font-semibold tracking-tight">Workbench</h1>
      </div>
      {/* useSearchParams needs a Suspense boundary to keep this page static. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
