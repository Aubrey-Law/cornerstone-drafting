'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends Omit<ComponentProps<typeof Input>, 'id' | 'type'> {
  id: string
  label: string
  labelAction?: ReactNode
  helpText?: string
  toggleLabel?: string
}

export function PasswordInput({
  id,
  label,
  labelAction,
  helpText,
  toggleLabel = 'password',
  className,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const helpId = helpText ? `${id}-help` : undefined

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Input
          {...inputProps}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={helpId}
          className={cn('h-11 pr-11', className)}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex size-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-label={`${visible ? 'Hide' : 'Show'} ${toggleLabel}`}
          aria-pressed={visible}
          onClick={() => setVisible(current => !current)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {helpText && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {helpText}
        </p>
      )}
    </div>
  )
}
