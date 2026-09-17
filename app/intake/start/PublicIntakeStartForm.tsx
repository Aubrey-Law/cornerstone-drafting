'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/forms/FieldError'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_CLIENT_PASSWORD_LENGTH } from '@/lib/auth/clientPassword'
import {
  publicIntakeStartSchema,
  type PublicIntakeStartValues,
} from '@/lib/validation/clientAccountForms'
import { supabase } from '@/lib/supabaseClient'
import { TurnstileWidget } from './TurnstileWidget'

export function PublicIntakeStartForm({ siteKey }: { siteKey: string }) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [existing, setExisting] = useState(false)

  const schema = useMemo(() => publicIntakeStartSchema(Boolean(siteKey)), [siteKey])

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<PublicIntakeStartValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      turnstileToken: '',
    },
  })

  const describedBy = (base: string | null, errorId: string, invalid: boolean) =>
    [base, invalid ? errorId : null].filter(Boolean).join(' ') || undefined

  async function submit(values: PublicIntakeStartValues) {
    clearErrors('root')
    setExisting(false)
    try {
      const response = await fetch('/api/intake/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: values.fullName,
          email: values.email,
          phone: values.phone,
          password: values.password,
          turnstileToken: values.turnstileToken,
        }),
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
        email: values.email.trim().toLowerCase(),
        password: values.password,
      })
      if (signInError) throw new Error('Your account was created. Sign in to continue.')
      toast.success('Welcome — starting your intake')
      router.replace('/intake')
      router.refresh()
    } catch (caught) {
      setError('root', {
        message: caught instanceof Error ? caught.message : 'Could not start intake',
      })
    }
  }

  return (
    <form noValidate onSubmit={event => void handleSubmit(submit)(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="public-intake-name">Full name</Label>
        <Input
          className="h-11"
          id="public-intake-name"
          autoComplete="name"
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={describedBy(null, 'public-intake-name-error', Boolean(errors.fullName))}
          {...register('fullName')}
        />
        <FieldError id="public-intake-name-error" message={errors.fullName?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="public-intake-email">Email address</Label>
        <Input
          className="h-11"
          id="public-intake-email"
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={describedBy(null, 'public-intake-email-error', Boolean(errors.email))}
          {...register('email')}
        />
        <FieldError id="public-intake-email-error" message={errors.email?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="public-intake-phone">Phone number</Label>
        {/* Input formats type="tel" values through formatPhoneInput before onChange. */}
        <Input
          className="h-11"
          id="public-intake-phone"
          type="tel"
          autoComplete="tel"
          placeholder="(555) 555-5555"
          {...register('phone')}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="public-intake-password">Create password</Label>
          <div className="relative">
            <Input
              className="h-11 pr-11"
              id="public-intake-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy(
                'public-intake-password-help',
                'public-intake-password-error',
                Boolean(errors.password),
              )}
              {...register('password')}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex size-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(current => !current)}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
          <FieldError id="public-intake-password-error" message={errors.password?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="public-intake-confirm">Confirm password</Label>
          <div className="relative">
            <Input
              className="h-11 pr-11"
              id="public-intake-confirm"
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={describedBy(
                null,
                'public-intake-confirm-error',
                Boolean(errors.confirmPassword),
              )}
              {...register('confirmPassword')}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex size-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
              aria-pressed={showConfirmPassword}
              onClick={() => setShowConfirmPassword(current => !current)}
            >
              {showConfirmPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
          <FieldError id="public-intake-confirm-error" message={errors.confirmPassword?.message} />
        </div>
      </div>
      <p id="public-intake-password-help" className="text-xs text-muted-foreground">
        Use at least {MIN_CLIENT_PASSWORD_LENGTH} characters.
      </p>
      {siteKey ? (
        <div>
          <TurnstileWidget
            siteKey={siteKey}
            onToken={token => setValue('turnstileToken', token, { shouldValidate: true })}
          />
          <FieldError message={errors.turnstileToken?.message} />
        </div>
      ) : (
        <p className="rounded-md border border-amber-border bg-amber-bg p-3 text-sm text-amber">
          Public intake registration is not configured.
        </p>
      )}
      {errors.root?.message && (
        <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>
      )}
      {existing && (
        <p className="text-sm">
          <Link className="font-medium text-accent underline" href="/auth/login?redirectTo=/intake">Sign in</Link>
          {' or '}
          use “Forgot password?” on the sign-in page.
        </p>
      )}
      <Button type="submit" className="h-11 w-full" disabled={isSubmitting || !siteKey}>
        {isSubmitting ? 'Creating your secure intake…' : 'Start secure intake'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account? <Link className="font-medium text-accent hover:underline" href="/auth/login?redirectTo=/intake">Sign in</Link>
      </p>
    </form>
  )
}
