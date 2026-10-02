'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  BOOKING_QUESTION_KIND_LABELS,
  BOOKING_QUESTION_KINDS,
  type BookingQuestion,
  type BookingQuestionKind,
  MAX_BOOKING_QUESTIONS,
  MAX_QUESTION_LABEL,
  newBookingQuestionId,
} from '@/lib/appointments/bookingQuestions'

/**
 * Per-type booking questions in Settings → Scheduling. Edits are local until
 * the section's Save; the server sanitizes (blank questions and choice
 * questions with fewer than two options are dropped).
 */
export function BookingQuestionsEditor({
  value,
  onChange,
}: {
  value: BookingQuestion[]
  onChange: (next: BookingQuestion[]) => void
}) {
  function update(index: number, patch: Partial<BookingQuestion>) {
    onChange(value.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...value]
    const [q] = next.splice(index, 1)
    next.splice(index + delta, 0, q)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No extra questions. Clients see name, email, phone and an optional notes box.
        </p>
      )}
      {value.map((q, i) => {
        const n = i + 1
        const choiceTooShort =
          q.kind === 'choice' && q.options.filter(o => o.trim()).length < 2
        return (
          <div key={q.id} className="rounded-md border border-border bg-card p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <Label htmlFor={`bq-label-${q.id}`} className="text-xs">
                  Question {n}
                </Label>
                <Input
                  id={`bq-label-${q.id}`}
                  className="mt-1 h-8"
                  maxLength={MAX_QUESTION_LABEL}
                  placeholder="e.g. What prompted you to reach out?"
                  value={q.label}
                  onChange={e => update(i, { label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`bq-kind-${q.id}`} className="text-xs">
                  Answer type
                </Label>
                <NativeSelect
                  id={`bq-kind-${q.id}`}
                  className="mt-1 h-8"
                  value={q.kind}
                  onChange={e => {
                    const kind = e.target.value as BookingQuestionKind
                    update(i, { kind, options: kind === 'choice' && q.options.length === 0 ? ['', ''] : q.options })
                  }}
                >
                  {BOOKING_QUESTION_KINDS.map(kind => (
                    <option key={kind} value={kind}>
                      {BOOKING_QUESTION_KIND_LABELS[kind]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {q.kind === 'choice' && (
              <div className="mt-3">
                <Label htmlFor={`bq-options-${q.id}`} className="text-xs">
                  Options (one per line)
                </Label>
                <Textarea
                  id={`bq-options-${q.id}`}
                  className="mt-1 text-sm"
                  rows={3}
                  value={q.options.join('\n')}
                  onChange={e => update(i, { options: e.target.value.split('\n') })}
                />
                {choiceTooShort && (
                  <p className="mt-1 text-xs text-amber">
                    Add at least two options, or this question won&apos;t be saved.
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={e => update(i, { required: e.target.checked })}
                />
                Required
              </label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={i === 0}
                  aria-label={`Move question ${n} up`}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={i === value.length - 1}
                  aria-label={`Move question ${n} down`}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= MAX_BOOKING_QUESTIONS}
        onClick={() =>
          onChange([
            ...value,
            { id: newBookingQuestionId(), label: '', kind: 'short_text', required: false, options: [] },
          ])
        }
      >
        + Add question
      </Button>
      {value.length >= MAX_BOOKING_QUESTIONS && (
        <p className="text-xs text-muted-foreground">Up to {MAX_BOOKING_QUESTIONS} questions per type.</p>
      )}
    </div>
  )
}
