'use client'

import { Checkbox } from '@/components/ui/checkbox'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import { AttorneyNoteBanner, DesignSectionContent, SectionBlock } from './shared'
import { getFiduciaryDisplayOptions, setFiduciaryDisplayOptions } from '@/lib/designSheetDocumentInclusions'
import type { SectionProps } from './shared'
import { FiduciaryCardGrid } from './FiduciaryCard'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function getFiduciaryPoolContactIds(sheet: DesignSheet): string[] {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.fiduciary_pool_contact_ids
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : []
}

function setFiduciaryPoolContactIds(sheet: DesignSheet, ids: string[]) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  return {
    ...decisions,
    fiduciary_pool_contact_ids: uniqueIds(ids),
  }
}

export function FiduciariesSectionEP({ sheet, contacts, matter, onChange, onAddContact, onUpdateContact }: Props) {
  const fiduciaryDisplayOptions = getFiduciaryDisplayOptions(sheet)
  const fiduciaryPoolContactIds = getFiduciaryPoolContactIds(sheet)
  const clientName = (sheet.client_name ?? matter.client_name ?? 'Client').trim()
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim() || null

  const updateDisplayOption = (key: keyof typeof fiduciaryDisplayOptions, checked: boolean) => {
    onChange('decisions', setFiduciaryDisplayOptions(sheet, { [key]: checked }))
  }

  const updatePool = (ids: string[]) => {
    onChange('decisions', setFiduciaryPoolContactIds(sheet, ids))
  }

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Add all potential decisionmakers and fiduciaries below. These contacts appear as options when
        you nominate trustees, personal representatives, guardians, and agents on the Trust Details,
        Will Details, and other document sections.
      </AttorneyNoteBanner>

      <SectionBlock
        title="All Fiduciaries and Decisionmakers"
        subtitle="Add all potential decisionmakers and fiduciaries below. These contacts appear as options for fiduciary roles on the following pages."
      >
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800/40 dark:bg-blue-950/20">
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            Add a fiduciary in the grid below. These will appear as options for fiduciary roles on the
            Trust Details, Will Details, and other document pages.
          </p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={fiduciaryDisplayOptions.show_phone_numbers}
              onCheckedChange={value => updateDisplayOption('show_phone_numbers', value === true)}
            />
            <span className="text-sm text-foreground">Show fiduciary phone numbers in documents</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={fiduciaryDisplayOptions.show_addresses}
              onCheckedChange={value => updateDisplayOption('show_addresses', value === true)}
            />
            <span className="text-sm text-foreground">Show fiduciary addresses in documents</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={fiduciaryDisplayOptions.show_email_addresses}
              onCheckedChange={value => updateDisplayOption('show_email_addresses', value === true)}
            />
            <span className="text-sm text-foreground">Show fiduciary email addresses in documents</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={fiduciaryDisplayOptions.show_dates_of_birth}
              onCheckedChange={value => updateDisplayOption('show_dates_of_birth', value === true)}
            />
            <span className="text-sm text-foreground">Show fiduciary dates of birth in documents</span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 sm:col-span-2">
            <Checkbox
              checked={fiduciaryDisplayOptions.show_relationships}
              onCheckedChange={value => updateDisplayOption('show_relationships', value === true)}
            />
            <span className="text-sm text-foreground">Show fiduciary relationships in documents</span>
          </label>
        </div>

        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Fiduciaries</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter information for each fiduciary, including alternates, co-fiduciaries, PRs, executors,
            contingent agents, and trust recipients. They will be available to designate roles on the following pages.
          </p>
        </div>

        <FiduciaryCardGrid
          sheet={sheet}
          contacts={contacts}
          poolContactIds={fiduciaryPoolContactIds}
          clientName={clientName}
          spouseName={spouseName}
          onChange={onChange}
          onAddContact={onAddContact}
          onUpdateContact={onUpdateContact}
          onPoolChange={updatePool}
        />
      </SectionBlock>
    </DesignSectionContent>
  )
}
