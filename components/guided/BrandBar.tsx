'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { AutosavePill, type GuidedSaveStatus } from './AutosavePill'

interface BrandBarProps {
  saveStatus: GuidedSaveStatus
  matterLabel?: string
  actions?: ReactNode
  savedLabel?: string
  dirtyLabel?: string
}

export function BrandBar({
  saveStatus,
  matterLabel,
  actions,
  savedLabel,
  dirtyLabel,
}: BrandBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
      flexWrap: 'wrap',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <Image
          src="/aubrey-law-logo.svg"
          alt="Aubrey Law"
          width={160}
          height={19}
          priority
          style={{ height: 'auto', width: 'clamp(130px, 28vw, 160px)' }}
        />
        {matterLabel && (
          <span style={{
            font: '500 12px/1 var(--gi-sans)',
            color: 'var(--gi-faint)',
            borderLeft: '1px solid var(--gi-faint-border)',
            paddingLeft: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {matterLabel}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {actions}
        <AutosavePill saveStatus={saveStatus} savedLabel={savedLabel} dirtyLabel={dirtyLabel} />
      </div>
    </div>
  )
}
