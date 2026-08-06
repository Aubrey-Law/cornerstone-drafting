'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FieldLabel, SectionBlock, type SectionProps } from './shared'
import type { AssetItem } from '@/types/database'

const CATEGORIES: { value: AssetItem['category']; label: string; color: string }[] = [
  { value: 'real_property',  label: 'Real Property',    color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/50' },
  { value: 'financial',      label: 'Financial Account', color: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800/50' },
  { value: 'retirement',     label: 'Retirement',        color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800/50' },
  { value: 'life_insurance', label: 'Life Insurance',    color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800/50' },
  { value: 'business',       label: 'Business Interest', color: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800/50' },
  { value: 'other',          label: 'Other',             color: 'bg-muted text-muted-foreground border-border' },
]

function categoryMeta(cat: AssetItem['category']) {
  return CATEGORIES.find(c => c.value === cat) ?? CATEGORIES[CATEGORIES.length - 1]
}

function formatValue(n: number | null): string {
  if (!n) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function parseValue(s: string): number | null {
  const cleaned = s.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function newAsset(): AssetItem {
  return {
    id: crypto.randomUUID(),
    category: 'financial',
    description: '',
    institution: '',
    estimated_value: null,
    notes: '',
  }
}

export function AssetsSection({ sheet, onChange }: SectionProps) {
  const [assets, setAssets] = useState<AssetItem[]>(Array.isArray(sheet.assets) ? sheet.assets : [])

  function commit(next: AssetItem[]) {
    setAssets(next)
    onChange('assets', next)
  }

  function addAsset() {
    commit([...assets, newAsset()])
  }

  function removeAsset(id: string) {
    commit(assets.filter(a => a.id !== id))
  }

  function updateAsset(id: string, patch: Partial<AssetItem>) {
    const next = assets.map(a => a.id === id ? { ...a, ...patch } : a)
    commit(next)
  }

  const totalValue = assets.reduce((sum, a) => sum + (a.estimated_value ?? 0), 0)

  return (
    <div>
      <SectionBlock title="Asset Inventory" subtitle="Key assets to be coordinated with the estate plan">
        {assets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted py-10 text-center">
            <p className="text-sm text-muted-foreground">No assets added yet.</p>
            <Button variant="outline" size="sm" className="mt-3 text-xs gap-1.5" onClick={addAsset}>
              <Plus className="h-3.5 w-3.5" /> Add First Asset
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {assets.map(asset => {
              const meta = categoryMeta(asset.category)
              return (
                <div key={asset.id} className="rounded-lg border border-border bg-card p-3">
                  {/* Category badge + delete */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.color)}>
                      {meta.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAsset(asset.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {/* Category */}
                    <div>
                      <FieldLabel>Type</FieldLabel>
                      <Select
                        value={asset.category}
                        onValueChange={v => updateAsset(asset.id, { category: v as AssetItem['category'] })}
                      >
                        <SelectTrigger className="bg-card border-border text-sm h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Description */}
                    <div>
                      <FieldLabel>Description</FieldLabel>
                      <Input
                        value={asset.description}
                        onChange={e => updateAsset(asset.id, { description: e.target.value })}
                        placeholder={asset.category === 'real_property' ? '123 Main St' : 'e.g. Joint checking'}
                        className="bg-card border-border h-9 text-sm"
                      />
                    </div>

                    {/* Estimated value */}
                    <div>
                      <FieldLabel>Est. Value</FieldLabel>
                      <Input
                        value={asset.estimated_value != null ? formatValue(asset.estimated_value) : ''}
                        onChange={e => updateAsset(asset.id, { estimated_value: parseValue(e.target.value) })}
                        placeholder="$0"
                        className="bg-card border-border h-9 text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <FieldLabel>Institution / Holder</FieldLabel>
                      <Input
                        value={asset.institution}
                        onChange={e => updateAsset(asset.id, { institution: e.target.value })}
                        placeholder="e.g. Fidelity, Chase"
                        className="bg-card border-border h-9 text-sm"
                      />
                    </div>
                    <div>
                      <FieldLabel>Notes</FieldLabel>
                      <Input
                        value={asset.notes}
                        onChange={e => updateAsset(asset.id, { notes: e.target.value })}
                        placeholder="Beneficiary designation, TOD, joint tenancy…"
                        className="bg-card border-border h-9 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={addAsset}>
              <Plus className="h-3.5 w-3.5" /> Add Asset
            </Button>
          </div>
        )}
        <footer className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            Gross estate total · {assets.length} item{assets.length === 1 ? '' : 's'}
          </span>
          <span className="tabular-nums text-base font-semibold text-foreground">
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              maximumFractionDigits: 0,
            }).format(totalValue)}
          </span>
        </footer>
      </SectionBlock>
    </div>
  )
}
