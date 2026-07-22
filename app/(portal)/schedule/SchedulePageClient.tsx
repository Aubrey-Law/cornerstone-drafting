'use client'

import { useState } from 'react'
import BookingWidget, { type BookingWidgetType } from '@/components/scheduling/BookingWidget'
import { Button } from '@/components/ui/button'

export interface SchedulePageClientProps {
  types: BookingWidgetType[]
  defaultName: string
  defaultEmail: string
  defaultPhone: string
}

export default function SchedulePageClient({
  types,
  defaultName,
  defaultEmail,
  defaultPhone,
}: SchedulePageClientProps) {
  const [selectedType, setSelectedType] = useState<BookingWidgetType | null>(
    types.length === 1 ? types[0] : null,
  )

  if (types.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Online scheduling is not available right now. Please message the firm to set up a time.
      </div>
    )
  }

  if (!selectedType) {
    return (
      <div className="space-y-3">
        {types.map(type => (
          <button
            key={type.key}
            type="button"
            className="w-full rounded-lg border border-border bg-card p-5 text-left transition-colors hover:bg-accent"
            onClick={() => setSelectedType(type)}
          >
            <p className="text-sm font-semibold text-foreground">{type.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {type.durationMinutes} minutes
              {type.description ? ` · ${type.description}` : ''}
            </p>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      {types.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => setSelectedType(null)}
        >
          ← All appointment types
        </Button>
      )}
      <h2 className="text-lg font-semibold text-foreground">{selectedType.label}</h2>
      {selectedType.description && (
        <p className="mt-1 text-sm text-muted-foreground">{selectedType.description}</p>
      )}
      <div className="mt-4">
        <BookingWidget
          type={selectedType}
          defaultName={defaultName}
          defaultEmail={defaultEmail}
          defaultPhone={defaultPhone}
          emailLocked
        />
      </div>
    </div>
  )
}
