'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ensureUserProfile } from '@/lib/auth/ensureUserProfile'
import {
  MIN_CLIENT_PASSWORD_LENGTH,
  isExistingAccountAuthError,
} from '@/lib/auth/clientPassword'
import { intakeSignupSchema, type IntakeSignupValues } from '@/lib/validation/clientAccountForms'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/forms/FieldError'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const inputCls =
  'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground'

export default function IntakeAuthForm({
  inviteToken,
  invitedEmail,
  returnTo = '/intake',
}: {
  inviteToken: string
  invitedEmail?: string
  /** Sanitized server-side by portalReturnPath. */
  returnTo?: string
}) {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<IntakeSignupValues>({
    resolver: zodResolver(intakeSignupSchema),
    defaultValues: {
      email: invitedEmail ?? '',
      password: '',
      confirmPassword: '',
    },
  })

  const [email, password, confirmPassword] = useWatch({
    control,
    name: ['email', 'password', 'confirmPassword'],
  })

  const signInHref = `/auth/login?redirectTo=${encodeURIComponent(returnTo)}`
  const rootError = errors.root?.message

  async function onSubmit(values: IntakeSignupValues) {
    clearErrors('root')

    const signupRes = await fetch('/api/intake/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken,
        email: values.email.trim(),
        password: values.password,
      }),
    })

    if (!signupRes.ok) {
      const body = await signupRes.json().catch(() => ({}))
      const msg = typeof body.error === 'string' ? body.error : 'Could not create your account.'
      setError('root', {
        message:
          isExistingAccountAuthError(msg) || signupRes.status === 409
            ? 'An account with this email already exists. Sign in to continue.'
            : msg,
      })
      return
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    })

    if (!signInError && signInData.user) {
      await ensureUserProfile(supabase, signInData.user)
    }

    if (signInError) {
      setError('root', {
        message:
          'Your account was created, but we could not sign you in automatically. Use the sign-in link below.',
      })
      return
    }

    toast.success('Welcome — starting your intake')
    router.replace(returnTo)
    router.refresh()
  }

  return (
    <form noValidate onSubmit={e => void handleSubmit(onSubmit)(e)} className="space-y-4">
      <div>
        <Label htmlFor="intake-email">Email address</Label>
        <Input
          id="intake-email"
          type="email"
          autoComplete="email"
          readOnly={Boolean(invitedEmail)}
          className={inputCls}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'intake-email-error' : undefined}
          {...register('email')}
        />
        <FieldError id="intake-email-error" message={errors.email?.message} />
        {invitedEmail ? (
          <p className="mt-1 text-xs text-muted-foreground">
            This invitation is tied to the email on your matter.
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="intake-password">Create a password</Label>
        <Input
          id="intake-password"
          type="password"
          autoComplete="new-password"
          className={inputCls}
          placeholder={`At least ${MIN_CLIENT_PASSWORD_LENGTH} characters`}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'intake-password-error' : undefined}
          {...register('password')}
        />
        <FieldError id="intake-password-error" message={errors.password?.message} />
      </div>

      <div>
        <Label htmlFor="intake-confirm-password">Confirm password</Label>
        <Input
          id="intake-confirm-password"
          type="password"
          autoComplete="new-password"
          className={inputCls}
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? 'intake-confirm-password-error' : undefined}
          {...register('confirmPassword')}
        />
        <FieldError
          id="intake-confirm-password-error"
          message={errors.confirmPassword?.message}
        />
      </div>

      {rootError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {rootError}
          {rootError.includes('already exists') ? (
            <>
              {' '}
              <Link href={signInHref} className="font-medium underline">
                Sign in
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || !email || !password || !confirmPassword}
      >
        {isSubmitting ? 'Creating account…' : 'Create account & continue'}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <Link href={signInHref} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
