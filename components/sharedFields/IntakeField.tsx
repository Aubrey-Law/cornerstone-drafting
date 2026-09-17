'use client'

import { cn } from '@/lib/utils'
import { IntakeField as PackageIntakeField } from '@aubrey-law/estate-fields/react'
import type { SharedFieldContext, SharedFieldId } from '@/lib/sharedFields'

type IntakeFieldProps = {
  fieldId: SharedFieldId
  value: unknown
  onChange: (value: unknown) => void
  variant?: 'select' | 'pills'
  context?: SharedFieldContext
  placeholder?: string
  id?: string
  required?: boolean
}

export function IntakeField(props: IntakeFieldProps) {
  return (
    <PackageIntakeField
      {...props}
      classNames={{
        pill: (active) =>
          cn(
            'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
            active
              ? 'border-accent bg-accent text-white'
              : 'border-border bg-white text-foreground hover:border-input',
          ),
        select:
          'w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        input:
          'w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
      }}
    />
  )
}
