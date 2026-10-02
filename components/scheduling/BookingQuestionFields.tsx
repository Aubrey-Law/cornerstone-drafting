'use client'

import { FOCUS } from '@/components/scheduling/bookingUi'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type BookingQuestion, MAX_ANSWER_LENGTH } from '@/lib/appointments/bookingQuestions'

const FIELD = 'h-12 rounded-lg bg-card px-3.5 text-base md:text-base @3xl/booking:h-[46px]'
const FIELD_LABEL = 'mb-1.5 text-base leading-snug font-medium text-foreground'

function Optional({ required }: { required: boolean }) {
  return required ? null : <span className="font-normal text-muted-foreground">(optional)</span>
}

/** The type's custom booking questions, rendered on the details step. */
export default function BookingQuestionFields({
  questions,
  answers,
  onChange,
}: {
  questions: BookingQuestion[]
  answers: Record<string, string>
  onChange: (questionId: string, answer: string) => void
}) {
  return (
    <>
      {questions.map(q => {
        const id = `booking-question-${q.id}`
        const value = answers[q.id] ?? ''
        if (q.kind === 'choice' || q.kind === 'yes_no') {
          const options = q.kind === 'yes_no' ? ['Yes', 'No'] : q.options
          return (
            <fieldset key={q.id} className="@3xl/booking:col-span-2">
              <legend className={`${FIELD_LABEL} flex gap-2`}>
                {q.label}
                <Optional required={q.required} />
              </legend>
              <div className={`flex gap-2 ${q.kind === 'yes_no' ? 'flex-row' : 'flex-col @3xl/booking:flex-row @3xl/booking:flex-wrap'}`}>
                {options.map((option, i) => {
                  const checked = value === option
                  return (
                    <label
                      key={option}
                      className={`flex min-h-11 cursor-pointer items-center rounded-lg border px-3.5 py-2.5 text-base transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                        checked
                          ? 'border-brand-teal bg-selected font-medium text-selected-foreground'
                          : 'border-border bg-card text-foreground hover:border-brand-teal'
                      }`}
                    >
                      <input
                        type="radio"
                        name={id}
                        value={option}
                        className="sr-only"
                        // One required radio makes the whole group required.
                        required={q.required && i === 0}
                        checked={checked}
                        onChange={() => onChange(q.id, option)}
                      />
                      {option}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        }
        return (
          <div key={q.id} className="@3xl/booking:col-span-2">
            <Label htmlFor={id} className={FIELD_LABEL}>
              {q.label}
              <Optional required={q.required} />
            </Label>
            {q.kind === 'long_text' ? (
              <Textarea
                id={id}
                className={`rounded-lg bg-card px-3.5 text-base md:text-base ${FOCUS}`}
                rows={3}
                required={q.required}
                maxLength={MAX_ANSWER_LENGTH.long_text}
                value={value}
                onChange={e => onChange(q.id, e.target.value)}
              />
            ) : (
              <Input
                id={id}
                className={FIELD}
                required={q.required}
                maxLength={MAX_ANSWER_LENGTH.short_text}
                value={value}
                onChange={e => onChange(q.id, e.target.value)}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
