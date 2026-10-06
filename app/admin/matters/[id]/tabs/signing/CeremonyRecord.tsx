'use client'

import { useActionState, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { Ceremony } from '@/lib/ceremony/repository'
import { ceremonyProblems, type Problem } from '@/lib/ceremony/validation'
import { documentLabel, requirementsFor, type DocumentKind } from '@/lib/execution/requirements'
import { formatDate } from '@/lib/funding/format'
import { TONE_NOTICE, type Tone } from '@/lib/ui/tone'
import { recordCeremony, recordCeremonyDocument } from './ceremonyActions'

const SEVERITY_TONE: Record<Problem['severity'], Tone> = {
  invalid: 'danger',
  incomplete: 'warning',
}

type CeremonyFormState = { message: string | null }
type CeremonyAction = (previous: CeremonyFormState | null, form: FormData) => Promise<CeremonyFormState>

/** Runs a save and, when it succeeds, asks the view to reload. */
function withReload(action: CeremonyAction, onSaved?: () => void) {
  return async (previous: CeremonyFormState, form: FormData) => {
    const result = await action(previous, form)
    if (!result.message) onSaved?.()
    return result
  }
}

function ProblemList({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="space-y-2" data-testid="problems">
      {problems.map((problem) => (
        <li
          key={`${problem.documentKind ?? 'ceremony'}:${problem.message}`}
          className={TONE_NOTICE[SEVERITY_TONE[problem.severity]]}
        >
          <span className="font-medium">
            {problem.severity === 'invalid' ? 'May not be valid. ' : 'Still outstanding. '}
          </span>
          {problem.message}
        </li>
      ))}
    </ul>
  )
}

/**
 * What happened at the appointment.
 *
 * The checklist above says what each document needs; this records what it got,
 * and says so immediately when the two disagree. A will recorded with one
 * witness is not a will, and the moment to notice that is now — while the
 * people are still reachable — rather than years later when someone reads the
 * file for the first time.
 */
export function CeremonyRecord({
  matterId,
  ceremony,
  kinds,
  onSaved,
}: {
  matterId: string
  ceremony: Ceremony | null
  kinds: DocumentKind[]
  /** Called after a save succeeds, so the view can reload the record. */
  onSaved?: () => void
}) {
  const [state, submit, pending] = useActionState(withReload(recordCeremony, onSaved), { message: null })
  const [roles, setRoles] = useState({
    witnessOneName: ceremony?.witnessOneName ?? '',
    witnessTwoName: ceremony?.witnessTwoName ?? '',
    notaryName: ceremony?.notaryName ?? '',
    healthCareAgentName: ceremony?.healthCareAgentName ?? '',
  })

  const problems = useMemo(
    () =>
      ceremonyProblems(
        {
          witnessOneName: roles.witnessOneName || null,
          witnessTwoName: roles.witnessTwoName || null,
          notaryName: roles.notaryName || null,
          healthCareAgentName: roles.healthCareAgentName || null,
        },
        ceremony?.documents ?? [],
      ),
    [roles, ceremony],
  )

  const field = (key: keyof typeof roles) => ({
    value: roles[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setRoles((current) => ({ ...current, [key]: event.target.value })),
  })

  const signingProxy = kinds.includes('health_care_proxy')

  return (
    <Card data-testid="ceremony-record">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">The signing</CardTitle>
        <CardDescription className="text-xs">
          Who was in the room and what they signed. This is the file&rsquo;s answer years later,
          when nobody remembers.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form action={submit} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="ceremonyId" value={ceremony?.id ?? ''} />

          <div className="space-y-1.5">
            <Label htmlFor="scheduledFor">When</Label>
            <Input
              id="scheduledFor"
              name="scheduledFor"
              type="datetime-local"
              defaultValue={ceremony?.scheduledFor?.slice(0, 16) ?? ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Where</Label>
            <Input id="location" name="location" defaultValue={ceremony?.location ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="witnessOneName">First witness</Label>
            <Input id="witnessOneName" name="witnessOneName" {...field('witnessOneName')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="witnessTwoName">Second witness</Label>
            <Input id="witnessTwoName" name="witnessTwoName" {...field('witnessTwoName')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notaryName">Notary</Label>
            <Input id="notaryName" name="notaryName" {...field('notaryName')} />
          </div>
          {signingProxy ? (
            <div className="space-y-1.5">
              <Label htmlFor="healthCareAgentName">Health care agent</Label>
              <Input id="healthCareAgentName" name="healthCareAgentName" {...field('healthCareAgentName')} />
              {/* Asked because the agent may not witness their own appointment.
                  Making someone name them is most of the check. */}
              <p className="text-xs text-muted-foreground">
                Named so the proxy can be checked: the agent may not witness it.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <NativeSelect id="status" name="status" defaultValue={ceremony?.status ?? 'scheduled'}>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="originalsLocation">Originals kept at</Label>
            <Input
              id="originalsLocation"
              name="originalsLocation"
              placeholder="Firm vault, client, bank box…"
              defaultValue={ceremony?.originalsLocation ?? ''}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="note">Note</Label>
            <Input id="note" name="note" defaultValue={ceremony?.note ?? ''} />
          </div>

          {state.message ? (
            <p role="alert" className={`sm:col-span-2 ${TONE_NOTICE.danger}`}>
              {state.message}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : ceremony ? 'Save the appointment' : 'Start the record'}
            </Button>
          </div>
        </form>

        <ProblemList problems={problems} />

        {ceremony ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">What was signed</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {kinds.map((kind) => (
                <DocumentEntry
                  key={kind}
                  matterId={matterId}
                  ceremonyId={ceremony.id}
                  kind={kind}
                  record={ceremony.documents.find((doc) => doc.documentKind === kind) ?? null}
                  onSaved={onSaved}
                />
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Start the record above, then tick off each document as it is signed.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentEntry({
  matterId,
  ceremonyId,
  kind,
  record,
  onSaved,
}: {
  matterId: string
  ceremonyId: string
  kind: DocumentKind
  record: Ceremony['documents'][number] | null
  onSaved?: () => void
}) {
  const [state, submit, pending] = useActionState(withReload(recordCeremonyDocument, onSaved), { message: null })
  const [executed, setExecuted] = useState(record?.executed ?? false)
  const requirement = requirementsFor(kind)

  return (
    <li className="px-4 py-3" data-testid={`ceremony-${kind}`}>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="ceremonyId" value={ceremonyId} />
        <input type="hidden" name="documentKind" value={kind} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`executed-${kind}`}
              name="executed"
              checked={executed}
              onCheckedChange={(checked) => setExecuted(checked === true)}
            />
            <Label htmlFor={`executed-${kind}`} className="font-medium">
              {documentLabel(kind)}
            </Label>
          </div>
          <span className="text-xs text-muted-foreground">
            {requirement.witnesses > 0 ? `${requirement.witnesses} witnesses` : 'No witnesses'}
            {record?.signedOn ? ` · signed ${formatDate(record.signedOn)}` : ''}
          </span>
        </div>

        {executed ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`signedOn-${kind}`}>Signed on</Label>
              <Input id={`signedOn-${kind}`} name="signedOn" type="date" required defaultValue={record?.signedOn ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`witnessCount-${kind}`}>Witnesses</Label>
              <Input
                id={`witnessCount-${kind}`}
                name="witnessCount"
                type="number"
                min={0}
                max={4}
                defaultValue={record?.witnessCount ?? requirement.witnesses}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox id={`notarized-${kind}`} name="notarized" defaultChecked={record?.notarized ?? false} />
              <Label htmlFor={`notarized-${kind}`} className="font-normal">
                Notarised
              </Label>
            </div>
            {requirement.recording ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`recordedOn-${kind}`}>Recorded on</Label>
                  <Input id={`recordedOn-${kind}`} name="recordedOn" type="date" defaultValue={record?.recordedOn ?? ''} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`recordingReference-${kind}`}>Book and page</Label>
                  <Input
                    id={`recordingReference-${kind}`}
                    name="recordingReference"
                    defaultValue={record?.recordingReference ?? ''}
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {state.message ? (
          <p role="alert" className={TONE_NOTICE.danger}>
            {state.message}
          </p>
        ) : null}

        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </li>
  )
}
