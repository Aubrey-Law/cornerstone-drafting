'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionBlock, type SectionProps } from './shared'

const VARIABLE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/

function extrasFromSheet(sheet: SectionProps['sheet']): Array<{ key: string; value: string }> {
  const decisions = sheet.decisions as Record<string, unknown> | null | undefined
  const extras = decisions?.extras
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return []
  return Object.entries(extras as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => ({ key, value: value as string }))
}

/**
 * Attorney-defined template variables. Each row becomes `extras.<name>` in the
 * document generator, so a template can reference `{{ extras.<name> }}` with
 * no code changes.
 */
export function AdditionalVariablesSection({ sheet, onChange }: SectionProps) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() => extrasFromSheet(sheet))
  const [newKey, setNewKey] = useState('')

  const persist = (nextRows: Array<{ key: string; value: string }>) => {
    const extras: Record<string, string> = {}
    for (const row of nextRows) {
      if (VARIABLE_NAME.test(row.key)) extras[row.key] = row.value
    }
    onChange('decisions', previous => ({
      ...((previous.decisions as Record<string, unknown> | null) ?? {}),
      extras,
    }))
  }

  const addRow = () => {
    const key = newKey.trim()
    if (!VARIABLE_NAME.test(key) || rows.some(row => row.key === key)) return
    const nextRows = [...rows, { key, value: '' }]
    setRows(nextRows)
    setNewKey('')
    persist(nextRows)
  }

  const removeRow = (key: string) => {
    const nextRows = rows.filter(row => row.key !== key)
    setRows(nextRows)
    persist(nextRows)
  }

  return (
    <SectionBlock
      title="Additional Template Variables"
      subtitle="Custom values templates can reference as {{ extras.name }} — no code changes needed"
    >
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <code className="w-56 shrink-0 truncate rounded bg-muted px-2 py-1.5 text-xs">
              extras.{row.key}
            </code>
            <input
              type="text"
              value={row.value}
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Value rendered into the document"
              onChange={event => {
                const nextRows = rows.map((entry, i) => i === index ? { ...entry, value: event.target.value } : entry)
                setRows(nextRows)
              }}
              onBlur={() => persist(rows)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove extras.${row.key}`}
              onClick={() => removeRow(row.key)}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKey}
            className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
            placeholder="variable_name"
            onChange={event => setNewKey(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addRow()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!VARIABLE_NAME.test(newKey.trim()) || rows.some(row => row.key === newKey.trim())}
            onClick={addRow}
          >
            <Plus className="mr-1 h-4 w-4" /> Add variable
          </Button>
        </div>
        <p className="text-micro text-muted-foreground">
          Letters, numbers, and underscores only (must start with a letter). Reference in a
          template as {'{{ extras.variable_name }}'} — saved automatically.
        </p>
      </div>
    </SectionBlock>
  )
}
