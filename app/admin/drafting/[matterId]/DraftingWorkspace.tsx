'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronRight, FilePenLine, FileText, ListChecks, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { computeDesignSheetReadiness, parseDesignFocusParam } from '@/lib/designSheetReadiness'
import { nextConsumedDesignFocus, shouldConsumeDesignFocus } from '@/lib/designFocusNavigation'
import { useDesignSheetState } from '@/lib/designSheet/useDesignSheetState'
import DesignSheetPage from '@/app/admin/drafting/[matterId]/design/DesignSheetPage'
import type { DesignSheet, MatterContact, MatterDocument, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
const GenerateStep = dynamic(() => import('./GenerateStep'), { ssr: false })
const ReviewStep = dynamic(() => import('./ReviewStep'), { ssr: false })

type Step = 'design' | 'generate' | 'review'

const STEPS: { id: Step; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'design',   label: 'Design',   icon: FileText,     description: 'Plan structure, fiduciaries, assets' },
  { id: 'generate', label: 'Generate', icon: FilePenLine,  description: 'Run the document generator' },
  { id: 'review',   label: 'Review',   icon: ListChecks,   description: 'Review and share drafts' },
]

function isStep(value: string | null): value is Step {
  return value === 'design' || value === 'generate' || value === 'review'
}

interface DraftingWorkspaceProps {
  matterId: string
  matter: PipelineMatter
  contacts: MatterContact[]
  sheet: DesignSheet | null
  lpData: {
    li_plan_coverage: string
    li_design_sheet_data: Record<string, unknown>
    li_design_sheet_approved: boolean
  } | null
  intakeSnapshot: IntakeSnapshot | null
  hubMatter: DraftingHubMatter | null
  sharedDrafts: MatterDocument[]
}

export default function DraftingWorkspace({
  matterId,
  matter,
  contacts,
  sheet,
  lpData,
  intakeSnapshot,
  hubMatter,
  sharedDrafts,
}: DraftingWorkspaceProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawStep = searchParams.get('step')
  const isLP = normalizePracticeArea(matter.practice_area) === 'EP-LP'

  // Own design-sheet state at the workspace level so Guided ↔ Express switches (and
  // step changes) do not remount a fresh hook and wipe in-progress edits with the
  // stale server `sheet` prop.
  const designState = useDesignSheetState({
    matterId,
    matter,
    contacts,
    sheet,
    lpData,
    applyDefaults: true,
  })

  const designReadiness = useMemo(() => {
    return computeDesignSheetReadiness({
      sheet: designState.sheet,
      matter,
      isLP,
      lpData: designState.lpDataState,
    })
  }, [designState.lpDataState, designState.sheet, isLP, matter])
  const designComplete = designReadiness?.complete ?? false
  const step: Step = isStep(rawStep) ? rawStep : defaultStep(designComplete, hubMatter)

  const stepStatus = useMemo(() => computeStepStatus(designComplete, hubMatter), [designComplete, hubMatter])

  // A `focus=<sectionId>:<targetField>` param (from a preflight "Fix" link) is
  // captured when it appears, handed to the design sheet to scroll/focus, then
  // cleared from the URL so a refresh doesn't re-trigger it.
  const rawFocus = searchParams.get('focus')
  const [initialFocus, setInitialFocus] = useState<{ sectionId: string; targetField: string | null } | null>(() =>
    parseDesignFocusParam(rawFocus),
  )
  const consumedFocusRef = useRef<string | null>(rawFocus)

  useEffect(() => {
    if (!rawFocus) {
      consumedFocusRef.current = nextConsumedDesignFocus(rawFocus, consumedFocusRef.current)
      return
    }
    if (!shouldConsumeDesignFocus(rawFocus, consumedFocusRef.current)) return
    consumedFocusRef.current = rawFocus
    const parsed = parseDesignFocusParam(rawFocus)
    if (parsed) {
      setInitialFocus(parsed)
      const params = new URLSearchParams(searchParams.toString())
      params.set('section', parsed.sectionId)
      params.delete('focus')
      router.replace(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('focus')
    router.replace(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
  }, [rawFocus, searchParams, router, matterId])

  const setStep = (next: Step) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('step', next)
    router.replace(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
  }

  const rawDesignSection = searchParams.get('section')
  const clientDisplayName = matter.client_name || 'Unnamed client'

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      {/* Workspace header */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-4">
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-2 text-sm">
              <li className="shrink-0">
                <Link href="/admin/drafting" className="font-medium text-muted-foreground hover:text-foreground">
                  Drafting
                </Link>
              </li>
              <li aria-hidden="true" className="text-muted-foreground">/</li>
              <li className="truncate font-semibold text-foreground" aria-current="page">
                {clientDisplayName}
              </li>
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-4">
            <Link
              href={`/admin/drafting/${matterId}/quick`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Quick draft a document
            </Link>
            <Link
              href={`/admin/matters/${matterId}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to matter
            </Link>
          </div>
        </div>

        {/* Stepper */}
        <nav className="mt-3 flex items-center gap-1 overflow-x-auto" aria-label="Drafting steps">
          {STEPS.map((s, idx) => {
            const active = step === s.id
            const status = stepStatus[s.id]
            const Icon = s.icon
            return (
              <div key={s.id} className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(s.id)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <span className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    status === 'complete' ? 'bg-success/15 text-success'
                      : active ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {status === 'complete' ? <CheckCircle2 className="h-3 w-3" /> : idx + 1}
                  </span>
                  <Icon className="h-3.5 w-3.5" />
                  <span>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
            )
          })}
        </nav>
      </div>

      {/* Step body */}
      <div className={cn(
        'min-h-0 flex-1',
        step === 'design' ? 'overflow-hidden' : 'overflow-y-auto',
      )}>
        {step === 'design' && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <DesignSheetPage
                matterId={matterId}
                matter={matter}
                contacts={contacts}
                sheet={sheet}
                lpData={lpData}
                intakeSnapshot={intakeSnapshot}
                designState={designState}
                embedded
                onOpenDrafting={() => setStep('generate')}
                initialFocus={initialFocus}
                requestedSectionId={rawDesignSection}
              />
            </div>
          </div>
        )}
        {step === 'generate' && (
          <div className="mx-auto max-w-5xl p-4 md:p-6">
            <GenerateStep
              matterId={matterId}
              hubMatter={hubMatter}
              sourcePreview={{
                matter,
                sheet: designState.sheet,
                contacts: designState.contactsState,
                intakeSnapshot,
              }}
              onAdvance={() => setStep('review')}
            />
          </div>
        )}
        {step === 'review' && (
          <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
            <ReviewStep matterId={matterId} hubMatter={hubMatter} sharedDrafts={sharedDrafts} />
          </div>
        )}
      </div>
    </div>
  )
}

function defaultStep(designComplete: boolean, hubMatter: DraftingHubMatter | null): Step {
  if (!designComplete) return 'design'
  if (!hubMatter || hubMatter.draftCount === 0) return 'generate'
  return 'review'
}

function computeStepStatus(
  designComplete: boolean,
  hubMatter: DraftingHubMatter | null,
): Record<Step, 'complete' | 'pending'> {
  const generateComplete = !!hubMatter && hubMatter.draftCount > 0
  return {
    design: designComplete ? 'complete' : 'pending',
    generate: generateComplete ? 'complete' : 'pending',
    review: 'pending',
  }
}
