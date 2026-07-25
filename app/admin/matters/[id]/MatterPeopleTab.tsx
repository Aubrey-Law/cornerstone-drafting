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
import type { MatterContact, PipelineMatter } from '@/types/database'

interface MatterPeopleTabProps {
  matterId: string
  matter: PipelineMatter
  initialContacts: MatterContact[]
}

export type PersonAddKind = 'spouse' | 'child' | 'fiduciary' | 'beneficiary'
export interface PersonAddRequest {
  kind: PersonAddKind
  nonce: number
}

export function MatterPeopleTab({ matterId, matter, initialContacts }: MatterPeopleTabProps) {
  const [addRequest, setAddRequest] = useState<PersonAddRequest | null>(null)
  const requestAdd = (kind: PersonAddKind) => {
    setAddRequest({ kind, nonce: Date.now() })
  }

  return (
    <TabsContent value="people" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">People</h3>
          <p className="text-xs text-muted-foreground">
            Household, fiduciary, and beneficiary roles for this matter.
          </p>
        </div>
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
      </div>

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
    </TabsContent>
  )
}
