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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'
import type { LeadListRow } from '@/lib/leads/viewTypes'

export interface LeadEditorForm {
  name: string
  email: string
  phone: string
  practiceArea: string
  fee: string
  status: string
}
interface LeadEditorDialogProps {
  open: boolean
  editingLead: LeadListRow | null
  form: LeadEditorForm
  saving: boolean
  onOpenChange: (open: boolean) => void
  onFormChange: (form: LeadEditorForm) => void
  onSave: () => void
}

export function LeadEditorDialog({
  open,
  editingLead,
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
          <DialogTitle>{editingLead ? 'Edit lead' : 'New lead'}</DialogTitle>
          <DialogDescription>
            A prospective matter becomes Hired when the engagement agreement is signed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Client name" value={form.name} onChange={event => update({ name: event.target.value })} />
          <Input type="email" placeholder="Email" value={form.email} onChange={event => update({ email: event.target.value })} />
          <Input placeholder="Phone (optional)" value={form.phone} onChange={event => update({ phone: event.target.value })} />
          <Select value={form.practiceArea} onValueChange={practiceArea => update({ practiceArea })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRACTICE_AREA_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editingLead && (
            <Select value={form.status} onValueChange={status => update({ status })}>
              <SelectTrigger aria-label="Matter status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          )}
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
            {saving ? 'Saving…' : editingLead ? 'Save changes' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
