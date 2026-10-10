'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { AuthShell } from '@/components/layout/AuthShell'
import { Button } from '@/components/ui/button'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const errorDescription = searchParams.get('error_description')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loadingSession, setLoadingSession] = useState(!!code)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (errorDescription) {
      toast.error(errorDescription)
      setLoadingSession(false)
      return
    }
    if (!code) return

    let cancelled = false
    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (cancelled) return
      if (error) toast.error(error.message)
      setLoadingSession(false)
    })()

    return () => {
      cancelled = true
    }
  }, [code, errorDescription])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.')
      return
    }

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(error.message)
      setSaving(false)
      return
    }

    await supabase.auth.signOut()
    toast.success('Password updated. Please sign in.')
    router.replace('/auth/login')
  }

  return (
    <div className="w-full max-w-md space-y-6 rounded-lg border border-border-strong bg-card p-5 shadow-md sm:p-8">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Account security</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Reset your password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a new password for your drafting account.
        </p>
      </div>

      {loadingSession ? (
        <p className="text-center text-sm text-muted-foreground">Verifying your reset link…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput
            id="new-password"
            label="New password"
            toggleLabel="new password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            helpText="Use at least 8 characters."
          />
          <PasswordInput
            id="confirm-password"
            label="Confirm password"
            toggleLabel="password confirmation"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          <Button type="submit" disabled={saving} className="h-11 w-full">
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/auth/login" className="font-medium text-primary hover:underline">
          Return to sign in
        </Link>
      </p>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <AuthShell>
        <ResetPasswordForm />
      </AuthShell>
    </Suspense>
  )
}
