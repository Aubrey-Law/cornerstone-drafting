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
