'use client'

import { TabsContent } from '@/components/ui/tabs'
import { MatterOverviewContacts } from './MatterOverviewContacts'
import { MatterAdditionalContactsTab } from './MatterAdditionalContactsTab'
import type { MatterContact, PipelineMatter } from '@/types/database'

interface MatterPeopleTabProps {
  matterId: string
  matter: PipelineMatter
  initialContacts: MatterContact[]
}

export function MatterPeopleTab({ matterId, matter, initialContacts }: MatterPeopleTabProps) {
  return (
    <TabsContent value="people" className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold">People</h3>
        <p className="text-xs text-muted-foreground">
          Household members, fiduciaries, beneficiaries, and other contacts for this matter.
        </p>
      </div>

      <div id="household" className="scroll-mt-24">
        <MatterOverviewContacts matterId={matterId} matter={matter} />
      </div>

      <MatterAdditionalContactsTab
        matterId={matterId}
        matter={matter}
        initialContacts={initialContacts}
        embedded
      />
    </TabsContent>
  )
}
