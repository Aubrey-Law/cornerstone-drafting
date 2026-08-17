'use client'

import { useEffect, useState, type RefObject } from 'react'
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

/**
 * Voiding keeps the invoice and its number — a gap in the series reads as a
 * missing invoice to anyone auditing the books — and releases its charges so
 * they can be billed again.
 */
export function VoidInvoiceDialog({
  open,
  onOpenChange,
  invoiceNumber,
  voiding,
  returnFocusRef,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceNumber: string | null
  voiding: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

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
          <AlertDialogTitle>Void invoice {invoiceNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            The invoice keeps its number and stays on the record, marked void. Its
            charges go back to the ledger so they can be billed again.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Input
            id="void-reason"
            value={reason}
            onChange={event => setReason(event.target.value)}
            maxLength={500}
            className="min-h-11"
            placeholder="e.g. Wrong amount — reissuing"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Keep invoice</AlertDialogCancel>
          <AlertDialogAction
            disabled={voiding || reason.trim().length === 0}
            onClick={event => {
              event.preventDefault()
              void onConfirm(reason.trim())
            }}
          >
            {voiding ? 'Voiding…' : 'Void invoice'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
