'use client'

import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  getCollegePrepDesign,
  getDesignPlanTrack,
  switchDesignPlanTrack,
  type DesignPlanTrack,
} from '@/lib/collegePrepDesign'
import { collegePrepDesignFromIntake } from '@/lib/designSheet/seedCollegePrep'
import type { IntakeSnapshot } from '@/lib/queries'
import { SectionBlock, type SectionProps } from './shared'

interface PlanTrackSwitchProps extends SectionProps {
  intakeSnapshot: IntakeSnapshot | null
}

const TRACK_LABELS: Record<DesignPlanTrack, string> = {
  estate: 'Estate Plan',
  college_prep: 'College Preparation Plan',
}

/**
 * Moves an already-seeded design sheet onto the other plan track.
 *
 * Seeding runs once against a blank sheet, so a matter whose questionnaire was
 * chosen late — or chosen wrong — has no other way onto the right track. The
 * switch is a real change to what gets drafted, so it confirms first and says
 * exactly what it will do.
 */
export function PlanTrackSwitch({ sheet, onChange, intakeSnapshot }: PlanTrackSwitchProps) {
  const [confirming, setConfirming] = useState(false)
  const track = getDesignPlanTrack(sheet)
  const target: DesignPlanTrack = track === 'college_prep' ? 'estate' : 'college_prep'

  // The student's own answers, when this matter's intake collected them.
  const intakeAnswers = intakeSnapshot?.intake_track === 'college_prep'
    ? collegePrepDesignFromIntake(intakeSnapshot)
    : null
  const alreadyAnswered = Boolean(getCollegePrepDesign(sheet).school_name)

  const confirmSwitch = () => {
    onChange('decisions', previous => switchDesignPlanTrack(previous, {
      track: target,
      answers: target === 'college_prep' ? intakeAnswers : null,
    }))
    setConfirming(false)
  }

  return (
    <SectionBlock
      title="Plan track"
      subtitle="Which plan this sheet drafts. It decides the sections, the documents, and the drafting checks."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-medium text-foreground">{TRACK_LABELS[track]}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {track === 'college_prep'
              ? 'Power of attorney, health care proxy, HIPAA, living will, and the FERPA release.'
              : 'Trust, will, powers of attorney, health care, and transfers.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setConfirming(true)}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Switch to {TRACK_LABELS[target]}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to the {TRACK_LABELS[target]}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {target === 'college_prep' ? (
                  <>
                    <p>
                      The trust, will, and deed come off the plan, along with the estate-plan
                      summary, signing guide, and role guide. Document selections you made by hand
                      reset to the College Preparation Plan defaults.
                    </p>
                    <p>
                      {intakeAnswers
                        ? 'This matter’s questionnaire answers will fill in the College Preparation Plan section.'
                        : alreadyAnswered
                          ? 'The College Preparation Plan answers already on this sheet are kept.'
                          : 'This matter’s intake used the estate questionnaire, so the College Preparation Plan section starts empty — you will fill it in at the meeting.'}
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      The estate sections come back and document selections reset to the estate
                      defaults, so confirm the plan type and documents next.
                    </p>
                    <p>
                      Any College Preparation Plan answers stay on the sheet and stop driving the
                      plan, so you can switch back without re-entering them.
                    </p>
                  </>
                )}
                <p className="text-muted-foreground">
                  Client and family facts, fiduciary nominations, and the health care and power of
                  attorney provisions are not affected.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>
              Switch to {TRACK_LABELS[target]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionBlock>
  )
}
