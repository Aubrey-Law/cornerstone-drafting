'use client'

import type { RefObject } from 'react'
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
import { buttonVariants } from '@/components/ui/button'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import { cn } from '@/lib/utils'

/**
 * Discarding deletes a draft outright, which is safe precisely because it was
 * never issued: no number was taken and nothing reached the client. The
 * charges go back to the ledger, so the work is not lost — only the grouping.
 *
 * An issued invoice is voided instead, which keeps its number on the record.
 */
export function DiscardInvoiceDialog({
  open,
  onOpenChange,
  lineCount,
  subtotalCents,
  discarding,
  returnFocusRef,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lineCount: number
  subtotalCents: number
  discarding: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onConfirm: () => Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft invoice?</AlertDialogTitle>
          <AlertDialogDescription>
            The draft is deleted and its {lineCount} charge{lineCount === 1 ? '' : 's'} —{' '}
            {moneyExact(subtotalCents)} — go back to the ledger, ready to be billed again.
            No invoice number was used, so nothing is left behind.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Keep draft</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            disabled={discarding}
            onClick={event => {
              event.preventDefault()
              void onConfirm()
            }}
          >
            {discarding ? 'Discarding…' : 'Discard draft'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
