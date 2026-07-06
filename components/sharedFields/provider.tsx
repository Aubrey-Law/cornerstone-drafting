'use client'

import type { ReactNode } from 'react'
import {
  DesignFieldComponentsProvider,
  type DesignFieldComponents,
} from '@aubrey-law/estate-fields/react'
import { Textarea } from '@/components/ui/textarea'
import {
  FieldLabel,
  PrefilledInput,
  PrefilledSelect,
} from '@/app/admin/drafting/[matterId]/design/sections/shared'
import { cn } from '@/lib/utils'
import { designFieldTargetId } from '@/lib/designSheetReadiness'

const designFieldComponents: DesignFieldComponents = {
  PrefilledInput,
  PrefilledSelect,
  FieldLabel,
  Textarea,
  cn,
  designFieldTargetId,
}

export function SharedFieldsProvider({ children }: { children: ReactNode }) {
  return (
    <DesignFieldComponentsProvider value={designFieldComponents}>
      {children}
    </DesignFieldComponentsProvider>
  )
}

export { designFieldComponents }
