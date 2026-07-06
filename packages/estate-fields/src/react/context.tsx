'use client'

import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type { DesignSheetKey, DesignSheetLike } from '../core/designSheetKeys'

export type PrefilledInputProps = {
  label: string
  value: string
  originalValue?: string
  onChange?: (value: string) => void
  type?: string
  fieldName?: DesignSheetKey | string
}

export type PrefilledSelectProps = {
  label: string
  value: string
  originalValue?: string
  options: { value: string; label: string }[]
  onChange?: (value: string) => void
  fieldName?: DesignSheetKey | string
}

export type FieldLabelProps = { children: ReactNode }

export type TextareaProps = {
  id?: string
  value: string
  onChange: (event: { target: { value: string } }) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  maxLength?: number
  'data-design-field'?: string
}

export type DesignFieldComponents = {
  PrefilledInput: ComponentType<PrefilledInputProps>
  PrefilledSelect: ComponentType<PrefilledSelectProps>
  FieldLabel: ComponentType<FieldLabelProps>
  Textarea: ComponentType<TextareaProps>
  cn: (...classes: Array<string | false | null | undefined>) => string
  designFieldTargetId: (field: string) => string
}

const DesignFieldComponentsContext = createContext<DesignFieldComponents | null>(null)

export function DesignFieldComponentsProvider({
  value,
  children,
}: {
  value: DesignFieldComponents
  children: ReactNode
}) {
  return (
    <DesignFieldComponentsContext.Provider value={value}>
      {children}
    </DesignFieldComponentsContext.Provider>
  )
}

export function useDesignFieldComponents(): DesignFieldComponents {
  const ctx = useContext(DesignFieldComponentsContext)
  if (!ctx) {
    throw new Error('useDesignFieldComponents requires DesignFieldComponentsProvider')
  }
  return ctx
}

export type DesignSectionChange = (field: DesignSheetKey | string, value: unknown) => void

export type DesignSectionProps<TSheet = DesignSheetLike> = {
  sheet: TSheet
  onChange: DesignSectionChange
}
