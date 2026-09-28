'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReviewFinding } from '@aubrey-law/citations/review/types'
import { isCitable, orderFindings } from '@/lib/review/order'
import { TONE_BADGE, severityTone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

export type Disposition = 'accepted' | 'rejected' | 'deferred'

const OUTCOME_LABEL: Record<ReviewFinding['outcome'], string> = {
  deviation: 'Deviation',
  absent: 'Absent',
  compliant: 'Compliant',
  not_applicable: 'Not applicable',
}

const DISPOSITIONS: Array<{ value: Disposition; label: string }> = [
  { value: 'accepted', label: 'Accept' },
  { value: 'rejected', label: 'Reject' },
  { value: 'deferred', label: 'Defer' },
]

/**
 * Why an uncited finding says so out loud.
 *
 * The model produced a quote and the verifier could not find it in the
 * document, exactly once, where it claimed. The rationale may still be worth
 * the attorney's attention, so the finding is not hidden — but it must never
 * read as a checkable claim, and it can never reach an export. Saying both is
 * what keeps "verified" meaning something.
 */
function CitationRefusal({ attempted }: { attempted: string | null }) {
  return (
    <div className="space-y-1 rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Not citable.</span> The quoted words could not
        be found in this document, so this finding is excluded from the export and from any redline.
        Read it as a lead to check by hand.
      </p>
      {/* The attempted words, so a paraphrase can be told from a verifier that
          is being too strict. Without them the finding is an assertion with
          nothing to check. */}
      {attempted ? <p className="italic">It tried to quote: “{attempted}”</p> : null}
    </div>
  )
}

export function FindingsList({
  findings,
  selected,
  onSelect,
  dispositions,
  onDispose,
}: {
  findings: ReviewFinding[]
  selected: string | null
  onSelect: (ruleNumber: string) => void
  dispositions: Partial<Record<string, Disposition>>
  onDispose: (ruleNumber: string, disposition: Disposition) => void
}) {
  if (findings.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No findings. Every rule in the playbook was either met or did not bear on this document.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {orderFindings(findings).map((finding) => {
        const citable = isCitable(finding)
        const where =
          finding.citation === null
            ? null
            : finding.citation.page === null
              ? `¶ ${finding.citation.blockIndex}`
              : `p${finding.citation.page} · ¶ ${finding.citation.blockIndex}`

        return (
          <li
            key={finding.ruleNumber}
            data-testid={`finding-${finding.ruleNumber}`}
            aria-current={selected === finding.ruleNumber ? 'true' : undefined}
            className={`space-y-3 p-4 ${selected === finding.ruleNumber ? 'bg-muted' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Rule {finding.ruleNumber}</span>
              <Badge variant="outline" className={cn('text-micro', TONE_BADGE[severityTone(finding.severity)])}>
                {OUTCOME_LABEL[finding.outcome].toLowerCase()}
                {finding.severity ? ` · ${finding.severity}` : ''}
              </Badge>
            </div>

            <p className="text-sm">{finding.rationale}</p>

            {citable && finding.citation ? (
              <blockquote className="border-l-2 border-border pl-3 text-sm">
                <span className="text-foreground">“{finding.citation.quote}”</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{where}</span>
              </blockquote>
            ) : null}

            {finding.citationRefusal ? <CitationRefusal attempted={finding.attemptedQuote} /> : null}

            {finding.proposedLanguage ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Proposed: </span>
                {finding.proposedLanguage}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {citable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-action="show"
                  onClick={() => onSelect(finding.ruleNumber)}
                >
                  Show in document
                </Button>
              ) : null}
              {DISPOSITIONS.map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={dispositions[finding.ruleNumber] === value ? 'default' : 'ghost'}
                  aria-pressed={dispositions[finding.ruleNumber] === value}
                  onClick={() => onDispose(finding.ruleNumber, value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
