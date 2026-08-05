'use client'

import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { SectionProps } from './shared'
import { FiduciaryGrid } from './FiduciaryGrid'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
}

/** @deprecated The unified FiduciariesSection renders this grid for every plan type. */
export function FiduciariesSectionEP({
  sheet,
  onChange,
  contacts,
  matter,
}: Props) {
  return (
    <FiduciaryGrid
      sheet={sheet as DesignSheet}
      contacts={contacts}
      matter={matter}
      onChange={onChange}
    />
  )
}
