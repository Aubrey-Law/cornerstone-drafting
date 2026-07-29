'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_CLIENT_PASSWORD_LENGTH, validateNewClientPassword } from '@/lib/auth/clientPassword'
import { formatPhoneInput } from '@/lib/phone'
import { supabase } from '@/lib/supabaseClient'
import { TurnstileWidget } from './TurnstileWidget'

export function PublicIntakeStartForm({ siteKey }: { siteKey: string }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setExisting(false)
    const passwordError = validateNewClientPassword(password, confirmPassword)
    if (passwordError) return setError(passwordError)
    if (!turnstileToken && siteKey) return setError('Complete the security check.')

    setLoading(true)
    try {
      const response = await fetch('/api/intake/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone, password, turnstileToken }),
      })
      const body = await response.json().catch(() => ({})) as {
        error?: string
        message?: string
        existingAccount?: boolean
      }
      if (!response.ok) {
        if (body.existingAccount) setExisting(true)
        throw new Error(body.error || body.message || 'Could not start intake')
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) throw new Error('Your account was created. Sign in to continue.')
      toast.success('Welcome — starting your intake')
      router.replace('/intake')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start intake')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={event => void submit(event)} className="space-y-4">
      <div>
        <Label htmlFor="public-intake-name">Full name</Label>
        <Input id="public-intake-name" required autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="public-intake-email">Email address</Label>
        <Input id="public-intake-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="public-intake-phone">Phone number</Label>
        <Input id="public-intake-phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(formatPhoneInput(e.target.value))} placeholder="(555) 555-5555" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="public-intake-password">Create password</Label>
          <Input id="public-intake-password" type="password" required minLength={MIN_CLIENT_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="public-intake-confirm">Confirm password</Label>
          <Input id="public-intake-confirm" type="password" required minLength={MIN_CLIENT_PASSWORD_LENGTH} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
        </div>
      </div>
      {siteKey ? (
        <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Public intake registration is not configured.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {existing && (
        <p className="text-sm">
          <Link className="font-medium text-accent underline" href="/auth/login?redirectTo=/intake">Sign in</Link>
          {' or '}
          use “Forgot password?” on the sign-in page.
        </p>
      )}
      <Button type="submit" className="w-full" disabled={loading || !siteKey}>
        {loading ? 'Creating your secure intake…' : 'Start secure intake'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account? <Link className="font-medium text-accent hover:underline" href="/auth/login?redirectTo=/intake">Sign in</Link>
      </p>
    </form>
  )
}
