'use client'

import * as React from 'react'
import { Input as BaseInput } from '@aubrey-law/ui/input'
import { formatPhoneInput } from '@/lib/phone'

export * from '@aubrey-law/ui/input'

/**
 * The shared primitive is a plain input. Formatting `type="tel"` as the user
 * types is this firm's phone-number policy, so it stays here in the root app
 * rather than in the design system every app inherits.
 */
function Input({ type, onChange, ...props }: React.ComponentProps<'input'>) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (type === 'tel') {
        const formatted = formatPhoneInput(event.currentTarget.value)
        event.currentTarget.value = formatted
        event.target.value = formatted
      }
      onChange?.(event)
    },
    [onChange, type],
  )
  return <BaseInput type={type} onChange={handleChange} {...props} />
}

export { Input }
