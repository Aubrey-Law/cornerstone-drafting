'use client'

import type { ReactNode } from 'react'
import {
  DesignField as PackageDesignField,
  DesignChildField as PackageDesignChildField,
  DesignTextareaField as PackageDesignTextareaField,
  type DesignSectionChange,
} from '@aubrey-law/estate-fields/react'
import type { SharedFieldId } from '@/lib/sharedFields'
import type { DesignSheet } from '@/types/database'
import type { SectionProps } from '@/app/admin/drafting/[matterId]/design/sections/shared'

type DesignFieldProps = {
  fieldId: SharedFieldId
  sheet: DesignSheet
  onChange: SectionProps['onChange']
  originalValue?: string
  valueOverride?: string
  context?: {
    clientName?: string | null
    spouseName?: string | null
  }
  className?: string
  placeholder?: string
  footer?: ReactNode
}

export function DesignField(props: DesignFieldProps) {
  return (
    <PackageDesignField
      {...props}
      onChange={props.onChange as unknown as DesignSectionChange}
    />
  )
}

type DesignChildFieldProps = {
  fieldId: 'child_name' | 'child_dob' | 'child_relationship' | 'child_parentage'
  value: string
  onChange: (value: string) => void
  context?: {
    clientName?: string | null
    spouseName?: string | null
  }
  footer?: ReactNode
}

export function DesignChildField(props: DesignChildFieldProps) {
  return <PackageDesignChildField {...props} />
}

type DesignTextareaFieldProps = {
  fieldId: SharedFieldId
  sheet: DesignSheet
  onChange: SectionProps['onChange']
  originalValue?: string
  valueOverride?: string
  footer?: ReactNode
  placeholder?: string
}

export function DesignTextareaField(props: DesignTextareaFieldProps) {
  return (
    <PackageDesignTextareaField
      {...props}
      onChange={props.onChange as unknown as DesignSectionChange}
    />
  )
}
