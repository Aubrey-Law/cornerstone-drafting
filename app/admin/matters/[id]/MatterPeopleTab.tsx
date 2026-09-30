'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MatterOverviewContacts } from './MatterOverviewContacts'
import { MatterAdditionalContactsTab } from './MatterAdditionalContactsTab'
import { MatterFiduciaryCard } from './MatterFiduciaryCard'
import { EMPTY_PLAN_MIRROR, type MatterPlanMirror } from '@/lib/matter/planMirror'
import { RecordTabHeader } from '@/components/RecordTabHeader'
import type { MatterContact, PipelineMatter } from '@/types/database'

interface MatterPeopleTabProps {
  matterId: string
  matter: PipelineMatter
  initialContacts: MatterContact[]
  planMirror?: MatterPlanMirror
  recordLabel?: 'matter' | 'lead'
}

export type PersonAddKind = 'spouse' | 'child' | 'fiduciary' | 'beneficiary'
export interface PersonAddRequest {
  kind: PersonAddKind
  nonce: number
}

export function MatterPeopleTabContent({
  matterId,
  matter,
  initialContacts,
  planMirror = EMPTY_PLAN_MIRROR,
  recordLabel = 'matter',
}: MatterPeopleTabProps) {
  const [addRequest, setAddRequest] = useState<PersonAddRequest | null>(null)
  const requestAdd = (kind: PersonAddKind) => {
    setAddRequest({ kind, nonce: Date.now() })
  }

  return (
    <div className="space-y-6">
      <RecordTabHeader
        title="People"
        description={`Household, fiduciary, and beneficiary roles for this ${recordLabel}.`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" />
                Add person
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => requestAdd('spouse')}>Spouse</DropdownMenuItem>
              <DropdownMenuItem onClick={() => requestAdd('child')}>Child</DropdownMenuItem>
              <DropdownMenuItem onClick={() => requestAdd('fiduciary')}>Fiduciary</DropdownMenuItem>
              <DropdownMenuItem onClick={() => requestAdd('beneficiary')}>Beneficiary</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {recordLabel === 'matter' && (
        <MatterFiduciaryCard matterId={matterId} planMirror={planMirror} />
      )}

      <div id="household" className="scroll-mt-24">
        <MatterOverviewContacts matterId={matterId} matter={matter} addRequest={addRequest} />
      </div>

      <MatterAdditionalContactsTab
        matterId={matterId}
        matter={matter}
        initialContacts={initialContacts}
        addRequest={addRequest}
        embedded
      />
    </div>
  )
}

/** The same content as its own tab, for the matter workspace. */
export function MatterPeopleTab(props: MatterPeopleTabProps) {
  return (
    <TabsContent value="people">
      <MatterPeopleTabContent {...props} />
    </TabsContent>
  )
}
