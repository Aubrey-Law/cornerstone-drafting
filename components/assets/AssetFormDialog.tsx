'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatAssetCurrency, parseCurrencyInput } from '@/lib/assets/format'
import type { OwnershipLabels } from '@/lib/assets/labels'
import {
  ASSET_CATEGORIES,
  CATEGORY_DETAILS,
  type AssetCategory,
  type Ownership,
} from '@/lib/estateTax'
import type { AssetIntakeInput, AssetIntakeRow } from '@/types/assetIntake'

interface AssetFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset?: AssetIntakeRow | null
  ownershipLabels: OwnershipLabels
  saving?: boolean
  onSave: (input: AssetIntakeInput, assetId?: string) => Promise<void>
}

function emptyForm(): AssetIntakeInput {
  return {
    category: 'bank',
    description: '',
    value: 0,
    ownership: 'client',
    details: {},
  }
}

export function AssetFormDialog({
  open,
  onOpenChange,
  asset,
  ownershipLabels,
  saving = false,
  onSave,
}: AssetFormDialogProps) {
  const isEdit = Boolean(asset?.id)
  const [form, setForm] = useState<AssetIntakeInput>(emptyForm())
  const [valueInput, setValueInput] = useState('')

  useEffect(() => {
    if (!open) return
    if (asset) {
      setForm({
        category: (asset.category as AssetCategory) || 'other',
        description: asset.description ?? '',
        value: Number(asset.value) || 0,
        ownership: asset.ownership ?? 'client',
        details: { ...(asset.details ?? {}) },
      })
      setValueInput(asset.value ? formatAssetCurrency(asset.value).replace(/^\$/, '') : '')
    } else {
      setForm(emptyForm())
      setValueInput('')
    }
  }, [open, asset])

  const config = CATEGORY_DETAILS[form.category]

  function setDetail(key: string, raw: string) {
    setForm(prev => ({
      ...prev,
      details: { ...prev.details, [key]: raw },
    }))
  }

  function setDetailNumber(key: string, raw: string) {
    setForm(prev => ({
      ...prev,
      details: { ...prev.details, [key]: parseCurrencyInput(raw) },
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const description = form.description.trim()
    if (!description) {
      toast.error('Description is required')
      return
    }
    const value = parseCurrencyInput(valueInput)
    if (value < 0) {
      toast.error('Value must be zero or greater')
      return
    }
    await onSave({ ...form, description, value }, asset?.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit asset' : 'Add new asset'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={form.category}
              onValueChange={v => {
                setForm(prev => ({
                  ...prev,
                  category: v as AssetCategory,
                  details: {},
                }))
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_CATEGORIES.map(cat => (
                  <SelectItem key={cat.key} value={cat.key}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{config?.descriptionLabel ?? 'Description'}</Label>
            <Input
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder={config?.descriptionLabel ?? 'Asset description'}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{config?.valueLabel ?? 'Value'}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  className="pl-7"
                  inputMode="decimal"
                  value={valueInput}
                  onChange={e => setValueInput(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ownership</Label>
              <Select
                value={form.ownership}
                onValueChange={v => setForm(prev => ({ ...prev, ownership: v as Ownership }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">{ownershipLabels.client}</SelectItem>
                  <SelectItem value="spouse">{ownershipLabels.spouse}</SelectItem>
                  <SelectItem value="joint">{ownershipLabels.joint}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {config?.extraFields.map(field => (
            <div key={field.key} className="space-y-2">
              <Label>{field.label}</Label>
              {field.type === 'select' ? (
                <Select
                  value={String(form.details[field.key] ?? '')}
                  onValueChange={v => setDetail(field.key, v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={field.placeholder ?? 'Select…'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map(opt => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === 'number' ? (
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    className="pl-7"
                    inputMode="decimal"
                    value={
                      form.details[field.key] != null && form.details[field.key] !== ''
                        ? String(form.details[field.key])
                        : ''
                    }
                    onChange={e => setDetailNumber(field.key, e.target.value)}
                    placeholder={field.placeholder ?? '0'}
                  />
                </div>
              ) : (
                <Input
                  value={String(form.details[field.key] ?? '')}
                  onChange={e => setDetail(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save changes' : 'Add asset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
