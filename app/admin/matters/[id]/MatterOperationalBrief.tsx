import { OperationalBrief } from '@/components/lifecycle/OperationalBrief'
import { stageLabel } from '@/types/database'
import type { matterOperationalBrief } from '@/lib/lifecycle/matter'

type Brief = ReturnType<typeof matterOperationalBrief>

export function MatterOperationalBrief({ brief }: { brief: Brief }) {
  return (
    <OperationalBrief brief={{
      known: brief.known,
      missing: brief.missing,
      clientFollowUp: brief.clientFollowUp,
      attorneyDecision: brief.attorneyDecision,
      conflicts: brief.conflicts,
      nextStageLabel: brief.nextStage ? stageLabel(brief.nextStage) : null,
      nextStageBlockers: brief.blockers.map(item => item.label),
      meetingPreparation: brief.meetingPreparation,
    }} />
  )
}
