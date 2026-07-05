'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronRight, FilePenLine, FileText, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { computeDesignSheetReadiness, parseDesignFocusParam } from '@/lib/designSheetReadiness'
import DesignSheetShell from '@/app/admin/drafting/[matterId]/design/DesignSheetShell'
import ExpressDesignSheet from '@/app/admin/drafting/[matterId]/design/ExpressDesignSheet'
import type { DesignSheet, MatterContact, MatterDocument, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import GenerateStep from './GenerateStep'
import ReviewStep from './ReviewStep'

type Step = 'design' | 'generate' | 'review'
type DesignView = 'guided' | 'express'

const DESIGN_VIEW_STORAGE_KEY = 'drafting-design-view'

const STEPS: { id: Step; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'design',   label: 'Design',   icon: FileText,     description: 'Plan structure, fiduciaries, assets' },
  { id: 'generate', label: 'Generate', icon: FilePenLine,  description: 'Run the document generator' },
  { id: 'review',   label: 'Review',   icon: ListChecks,   description: 'Review and share drafts' },
]

function isStep(value: string | null): value is Step {
  return value === 'design' || value === 'generate' || value === 'review'
}

function isDesignView(value: string | null): value is DesignView {
  return value === 'guided' || value === 'express'
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
  const designReadiness = useMemo(() => {
    if (!sheet) return null
    return computeDesignSheetReadiness({ sheet, matter, isLP, lpData })
  }, [isLP, lpData, matter, sheet])
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
    if (!rawFocus || consumedFocusRef.current === rawFocus) return
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

  // Design entry mode: URL wins for shareable links; localStorage remembers the
  // attorney's default for future drafting sessions.
  const rawDesignView = searchParams.get('design')
  const rawDesignSection = searchParams.get('section')
  const [preferredDesignView, setPreferredDesignView] = useState<DesignView>('guided')
  useEffect(() => {
    if (isDesignView(rawDesignView)) {
      setPreferredDesignView(rawDesignView)
      window.localStorage.setItem(DESIGN_VIEW_STORAGE_KEY, rawDesignView)
      return
    }

    const stored = window.localStorage.getItem(DESIGN_VIEW_STORAGE_KEY)
    if (isDesignView(stored)) setPreferredDesignView(stored)
  }, [rawDesignView])
  const designView: DesignView = isDesignView(rawDesignView) ? rawDesignView : preferredDesignView
  const setDesignView = (next: DesignView) => {
    setPreferredDesignView(next)
    window.localStorage.setItem(DESIGN_VIEW_STORAGE_KEY, next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('design', next)
    router.replace(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
  }

  const clientDisplayName = matter.client_name || 'Unnamed client'
  const practiceText = practiceAreaLabel(matter.practice_area)

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      {/* Workspace header */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" asChild>
              <Link href="/admin/drafting">
                <ArrowLeft className="h-3.5 w-3.5" />
                Drafting
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-foreground">{clientDisplayName}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {matter.matter_name || 'Matter'} · {practiceText}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">Drafting workspace</Badge>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/admin/drafting/${matterId}/design`}>
                <FileText className="h-3.5 w-3.5" />
                Design sheet
              </Link>
            </Button>
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
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <span className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    status === 'complete' ? 'bg-success/15 text-success'
                      : active ? 'bg-accent text-white'
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
            <div className="flex shrink-0 items-center justify-end border-b border-border bg-card px-4 py-1.5 md:px-5">
              <div className="flex items-center rounded-md bg-muted p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDesignView('guided')}
                  className={cn(
                    'rounded px-2.5 py-1 font-medium transition-colors',
                    designView === 'guided' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Section by section
                </button>
                <button
                  type="button"
                  onClick={() => setDesignView('express')}
                  className={cn(
                    'rounded px-2.5 py-1 font-medium transition-colors',
                    designView === 'express' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Fast entry
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {designView === 'express' ? (
                <ExpressDesignSheet
                  matterId={matterId}
                  matter={matter}
                  contacts={contacts}
                  sheet={sheet}
                  lpData={lpData}
                  intakeSnapshot={intakeSnapshot}
                  onOpenDrafting={() => setStep('generate')}
                  initialFocus={initialFocus}
                />
              ) : (
                <DesignSheetShell
                  matterId={matterId}
                  matter={matter}
                  contacts={contacts}
                  sheet={sheet}
                  lpData={lpData}
                  intakeSnapshot={intakeSnapshot}
                  embedded
                  onOpenDrafting={() => setStep('generate')}
                  initialFocus={initialFocus}
                  activeSectionId={rawDesignSection}
                />
              )}
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
                sheet,
                contacts,
                intakeSnapshot,
              }}
              onAdvance={() => setStep('review')}
            />
          </div>
        )}
        {step === 'review' && (
          <div className="h-full overflow-y-auto p-4 md:p-6">
            <div className="mx-auto max-w-[1180px]">
              <ReviewStep matterId={matterId} hubMatter={hubMatter} sharedDrafts={sharedDrafts} />
            </div>
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
