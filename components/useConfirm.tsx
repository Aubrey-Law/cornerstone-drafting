'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * `window.confirm`, with the app's own dialog.
 *
 * Ten destructive actions asked for confirmation through the browser's native
 * dialog — an OS chrome box that ignores the theme, cannot say which button is
 * the dangerous one, and in several browsers offers "prevent this page from
 * creating more dialogs", which silently turns every later confirm into an
 * instant `false`. On a page whose next question is "delete this asset?", a
 * confirm that answers itself is the wrong kind of quiet.
 *
 * The shape is deliberately promise-based so the call sites keep the control
 * flow they already had:
 *
 *     if (!(await confirm({ title: 'Delete this asset?' }))) return
 *
 * against the `if (!window.confirm(…)) return` it replaces. Nothing else about
 * those handlers had to move.
 *
 * The dialog is rendered by the component that owns the hook — `{confirmDialog}`
 * anywhere in its tree — rather than through a provider, so no route has to be
 * wired up before a component can ask a question.
 */

export interface ConfirmOptions {
  title: string
  /** The consequence, when it is not obvious from the title. */
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the action as destructive. Irreversible actions should set it. */
  destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  // A promise left hanging when the owner unmounts never settles, and the
  // handler awaiting it never reaches its `finally` — so a spinner started
  // before the question would spin for the life of the page.
  const pendingRef = useRef<PendingConfirm | null>(null)
  // Mirrored in an effect, not assigned during render: a ref written while
  // rendering is torn by a concurrent or StrictMode re-render, and React's own
  // lint rule says so.
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false)
    }
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...options, resolve })
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    setPending(current => {
      current?.resolve(value)
      return null
    })
  }, [])

  const confirmDialog = (
    <AlertDialog
      open={pending !== null}
      // Escape and the overlay both route here, so dismissing any way that is
      // not the action button answers no.
      onOpenChange={open => {
        if (!open) settle(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.body ? (
            <AlertDialogDescription>{pending.body}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {pending?.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={cn(
              pending?.destructive && 'bg-destructive text-white hover:bg-destructive/90',
            )}
          >
            {pending?.confirmLabel ?? 'Continue'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, confirmDialog }
}

export interface PromptOptions {
  title: string
  /** The consequence, when it is not obvious from the title. */
  body?: string
  /** The field's label. Say whether an answer is optional here. */
  label: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the action as destructive. Irreversible actions should set it. */
  destructive?: boolean
  /** Holds the action until something other than whitespace is typed. */
  required?: boolean
  /** Holds the action until the field matches this exactly — a type-to-confirm. */
  requireExact?: string
  /** A textarea rather than a single line, for anything sentence-shaped. */
  multiline?: boolean
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void
}

/**
 * `window.prompt`, with the app's own dialog — and with the two answers kept
 * apart.
 *
 * `window.prompt` returns null when the person presses Cancel and '' when they
 * submit it empty, and both are falsy. Every call site in this app tested the
 * result for truthiness, so both answers took the same branch. On the client
 * signing page that meant a client who pressed Cancel to back out declined
 * their agreement anyway, and the link was dead by the time they noticed.
 *
 * So the contract here is explicit rather than truthy:
 *
 *   - `null`   — they backed out. Do nothing.
 *   - a string — they confirmed. It is trimmed, and may be '' when the field
 *                was optional and left blank.
 *
 * `if (value === null) return` is the guard; `if (!value) return` would fold
 * the two back together, which is the bug this exists to prevent.
 */
export function usePrompt() {
  const [pending, setPending] = useState<PendingPrompt | null>(null)
  const [value, setValue] = useState('')

  // Same unmount safety as useConfirm: a promise left hanging never settles,
  // and the handler awaiting it never reaches its `finally`.
  const pendingRef = useRef<PendingPrompt | null>(null)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(null)
    }
  }, [])

  const prompt = useCallback((options: PromptOptions) => {
    setValue('')
    return new Promise<string | null>(resolve => {
      setPending({ ...options, resolve })
    })
  }, [])

  const settle = useCallback((result: string | null) => {
    setPending(current => {
      current?.resolve(result)
      return null
    })
  }, [])

  const trimmed = value.trim()
  const blocked = pending
    ? (pending.requireExact !== undefined && value !== pending.requireExact) ||
      (pending.required === true && trimmed.length === 0)
    : false

  const field = pending?.multiline ? (
    <Textarea
      id="app-prompt-field"
      rows={3}
      value={value}
      placeholder={pending?.placeholder}
      onChange={event => setValue(event.target.value)}
    />
  ) : (
    <Input
      id="app-prompt-field"
      value={value}
      placeholder={pending?.placeholder}
      onChange={event => setValue(event.target.value)}
    />
  )

  const promptDialog = (
    <AlertDialog
      open={pending !== null}
      // Escape and the overlay both route here, so dismissing any way that is
      // not the action button is a cancel — never an empty answer.
      onOpenChange={open => {
        if (!open) settle(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.body ? (
            <AlertDialogDescription>{pending.body}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        <div className="space-y-1">
          <Label htmlFor="app-prompt-field" className="text-xs">
            {pending?.label}
          </Label>
          {field}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(null)}>
            {pending?.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            onClick={() => settle(trimmed)}
            className={cn(
              pending?.destructive && 'bg-destructive text-white hover:bg-destructive/90',
            )}
          >
            {pending?.confirmLabel ?? 'Continue'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { prompt, promptDialog }
}
