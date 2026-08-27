import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatPhoneInput } from '@/lib/phone'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'

/**
 * Creating a lead only. Editing one lives on the record page and the
 * detail rail, which patch a field at a time through the validated lead-field
 * endpoint. This dialog collects a single "Client name", while an edit has to
 * write first and last name separately — the two shapes never reconciled, and
 * the edit request had been failing validation outright.
 */
export interface LeadEditorForm {
  name: string
  email: string
  phone: string
  practiceArea: string
  fee: string
}
interface LeadEditorDialogProps {
  open: boolean
  form: LeadEditorForm
  saving: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (form: LeadEditorForm) => void
  onSave: () => void
}

export function LeadEditorDialog({
  open,
  form,
  saving,
  onOpenChange,
  onFormChange,
  onSave,
}: LeadEditorDialogProps) {
  const update = (values: Partial<LeadEditorForm>) => onFormChange({ ...form, ...values })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>
            A prospective matter becomes Hired when the engagement agreement is signed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Client name" value={form.name} onChange={event => update({ name: event.target.value })} />
          <Input type="email" placeholder="Email" value={form.email} onChange={event => update({ email: event.target.value })} />
          <Input type="tel" placeholder="(555) 555-5555" value={formatPhoneInput(form.phone)} onChange={event => update({ phone: formatPhoneInput(event.target.value) })} />
          <Select value={form.practiceArea} onValueChange={practiceArea => update({ practiceArea })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRACTICE_AREA_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="Quoted flat fee (optional)"
            value={form.fee}
            onChange={event => update({ fee: event.target.value })}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
