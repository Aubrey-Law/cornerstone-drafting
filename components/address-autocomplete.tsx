'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { Input } from '@/components/ui/input'

export interface ParsedAddress {
  address_line1: string
  city: string
  state: string
  zip: string
  county: string
}

interface AddressAutocompleteProps {
  value: string
  onChange: (next: string) => void
  onPlaceSelected: (parsed: ParsedAddress) => void
  placeholder?: string
  id?: string
  /** Applied to the positioning wrapper, not the input. */
  className?: string
  /** Applied to the input itself — compact rails shrink it from the default. */
  inputClassName?: string
  'aria-label'?: string
  /** Lets a caller focus the field — React's autoFocus does not survive the
   *  read-to-edit swap these inline rows do. */
  inputRef?: Ref<HTMLInputElement>
  disabled?: boolean
}

interface PlaceAutocompleteResult {
  description: string
  place_id: string
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
}

interface PlaceDetailsResult {
  address_line1?: string
  city?: string
  state?: string
  zip?: string
  county?: string
}

function resultLine(result: PlaceAutocompleteResult) {
  return {
    primary: result.structured_formatting?.main_text || result.description.split(',')[0] || result.description,
    secondary: result.structured_formatting?.secondary_text || result.description.split(',').slice(1).join(',').trim(),
  }
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = 'Start typing an address...',
  id,
  className,
  inputClassName,
  'aria-label': ariaLabel,
  inputRef,
  disabled,
}: AddressAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [results, setResults] = useState<PlaceAutocompleteResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * What the operator has typed since the field last settled, or null when the
   * value came from anywhere else — a saved record rendering, a picked
   * suggestion, a re-mount. Suggestions follow typing only: keying the search
   * off `value` made the list reopen every time the stored address flowed back
   * in, so the panel sat there offering options nobody asked for.
   */
  const [query, setQuery] = useState<string | null>(null)

  useEffect(() => {
    if (disabled || query === null || query.trim().length < 5) {
      setResults([])
      setOpen(false)
      setError(null)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/places?action=autocomplete&input=${encodeURIComponent(query.trim())}`)
        if (!response.ok) throw new Error('Address search unavailable')
        const data: unknown = await response.json()
        const predictions = Array.isArray(data) ? (data as PlaceAutocompleteResult[]) : []
        setResults(predictions)
        setOpen(predictions.length > 0)
      } catch {
        setResults([])
        setOpen(false)
        setError('Address search unavailable. Enter manually.')
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [disabled, query])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setQuery(null)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSelect(result: PlaceAutocompleteResult) {
    const { primary } = resultLine(result)
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/places?action=details&place_id=${encodeURIComponent(result.place_id)}`)
      if (!response.ok) throw new Error('Address details unavailable')
      const details = await response.json() as PlaceDetailsResult
      const parsed: ParsedAddress = {
        address_line1: (details.address_line1 ?? '').trim(),
        city: (details.city ?? '').trim(),
        state: (details.state ?? '').trim(),
        zip: (details.zip ?? '').trim(),
        county: (details.county ?? '').replace(/ County$/i, '').trim(),
      }
      onPlaceSelected(parsed)
      onChange(parsed.address_line1 || primary)
    } catch {
      onChange(primary)
      setError('Address details unavailable. Enter manually.')
    } finally {
      setLoading(false)
      // A picked address is an answer, not a new search — leave the list shut
      // until the operator types again.
      setQuery(null)
      setResults([])
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={['relative', className].filter(Boolean).join(' ')}>
      <div className="relative">
        <Input
          id={id}
          type="text"
          className={inputClassName}
          aria-label={ariaLabel}
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open) return
            event.preventDefault()
            event.stopPropagation()
            setQuery(null)
            setOpen(false)
          }}
          onBlur={() => {
            // Selection runs on mousedown, so a blur means focus really left.
            setQuery(null)
            setOpen(false)
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {loading && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-micro text-muted-foreground">
            Searching
          </span>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-lg" role="listbox">
          {results.map((result) => {
            const { primary, secondary } = resultLine(result)
            return (
              <li key={result.place_id}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    void handleSelect(result)
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium text-foreground">{primary}</span>
                  {secondary && <span className="text-xs text-muted-foreground">{secondary}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
    </div>
  )
}
