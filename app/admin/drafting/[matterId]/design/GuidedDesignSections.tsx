'use client'

import type { ReactNode } from 'react'
import { GuidedSection, type GuidedSectionHandle } from '@/components/intake/GuidedSection'
import type { DesignSectionSummary } from '@/lib/designSheetReadiness'

export interface DesignSectionDef {
  id: string
  title: string
  subtitle?: string
  render: () => ReactNode
  visible?: boolean
}

interface GuidedDesignSectionsProps {
  sections: DesignSectionDef[]
  summaries: Record<string, DesignSectionSummary>
  openSection: string
  onToggle: (sectionId: string) => void
  sectionRefs: React.MutableRefObject<Record<string, GuidedSectionHandle | null>>
}

export function GuidedDesignSections({
  sections,
  summaries,
  openSection,
  onToggle,
  sectionRefs,
}: GuidedDesignSectionsProps) {
  const visible = sections.filter((s) => s.visible !== false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {visible.map((section, index) => {
        const summary = summaries[section.id]
        const status = summary?.status ?? 'none'
        const complete = status === 'complete'
        const subtitle = section.subtitle
          ?? (status === 'attention' && summary?.missing?.length
            ? `${summary.missing.length} item${summary.missing.length === 1 ? '' : 's'} needed`
            : summary?.detail ?? undefined)

        return (
          <GuidedSection
            key={section.id}
            ref={(handle) => { sectionRefs.current[section.id] = handle }}
            number={index + 1}
            title={section.title}
            subtitle={subtitle}
            complete={complete}
            open={openSection === section.id}
            onToggle={() => onToggle(section.id)}
          >
            {section.render()}
          </GuidedSection>
        )
      })}
    </div>
  )
}
