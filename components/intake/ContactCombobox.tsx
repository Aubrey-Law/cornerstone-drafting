'use client'

import * as React from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

export interface ContactSuggestion {
  id: string
  first_name: string | null
  last_name: string | null
  relationship_label: string | null
}

interface Props {
  value: string
  onChange: (next: string) => void
  suggestions: ContactSuggestion[]
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}

function suggestionLabel(s: ContactSuggestion): string {
  const name = [s.first_name, s.last_name]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ')
  return name
}

function suggestionSubLabel(s: ContactSuggestion): string {
  const label = typeof s.relationship_label === 'string' ? s.relationship_label.trim() : ''
  return label
}

export default function ContactCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
  style,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  // Filter suggestions client-side by case-insensitive substring on the joined
  // "first last" plus the relationship_label. cmdk's built-in filter would
  // work too, but we render our own list so we don't need its filter mode.
  const query = value.trim().toLowerCase()
  const filtered = React.useMemo(() => {
    if (suggestions.length === 0) return []
    if (!query) return suggestions
    return suggestions.filter((s) => {
      const name = suggestionLabel(s).toLowerCase()
      const label = suggestionSubLabel(s).toLowerCase()
      return name.includes(query) || label.includes(query)
    })
  }, [suggestions, query])

  function handlePick(s: ContactSuggestion) {
    const name = suggestionLabel(s)
    if (name) onChange(name)
    setOpen(false)
    // Return focus to the input — clicking a popover item moves focus away.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={(e) => {
            // Close on blur unless focus moves into the popover content.
            if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('[data-radix-popper-content-wrapper]')) {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-[34px] px-2.5 text-[13px] md:text-[13px]"
          style={style}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="p-0 w-(--radix-popover-trigger-width) min-w-[260px]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matching contacts.</CommandEmpty>
            <CommandGroup>
              {filtered.map((s) => {
                const name = suggestionLabel(s) || '(unnamed)'
                const sub = suggestionSubLabel(s)
                return (
                  <CommandItem
                    key={s.id}
                    value={`${name} ${sub}`}
                    onSelect={() => handlePick(s)}
                    onMouseDown={(e) => e.preventDefault() /* keep focus on input */}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{name}</span>
                      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
