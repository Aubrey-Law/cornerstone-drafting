'use client'

import { cn } from '@/lib/utils'
import {
  LEGAL_INSURANCE_PLAN_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
} from '@/lib/sharedFields'
import { FormField, TextInput } from './IntakeFormPrimitives'

import type { StepProps } from './IntakeWizard'

const REFERRAL_SOURCES = REFERRAL_SOURCE_OPTIONS.map((option) => option.value)
const LEGAL_INSURANCE_PLANS = LEGAL_INSURANCE_PLAN_OPTIONS.map((option) => option.value)

export function StepReferral({ data, update }: StepProps) {
  const source = data.referral_source as string | undefined

  return (
    <div className="space-y-6">
      <FormField label="How did you hear about us?" optional>
        <div className="flex flex-wrap gap-2">
          {REFERRAL_SOURCES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                update('referral_source', option)
                if (option !== 'Legal Insurance') {
                  update('legal_insurance_plan', '')
                  update('legal_insurance_member_id', '')
                }
                if (option !== 'Referral') {
                  update('referral_name', '')
                }
              }}
              aria-pressed={source === option}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                source === option
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </FormField>

      {source === 'Legal Insurance' && (
        <>
          <FormField label="Legal Insurance Plan">
            <div className="flex flex-wrap gap-2">
              {LEGAL_INSURANCE_PLANS.map((plan) => (
                <button
                  key={plan}
                  type="button"
                  onClick={() => update('legal_insurance_plan', plan)}
                  aria-pressed={data.legal_insurance_plan === plan}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                    data.legal_insurance_plan === plan
                      ? 'border-accent bg-accent text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
                  )}
                >
                  {plan}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Member ID / Case Number">
            <TextInput
              value={(data.legal_insurance_member_id as string) ?? ''}
              onChange={(value) => update('legal_insurance_member_id', value)}
              placeholder="Enter your member ID or case number"
            />
          </FormField>
        </>
      )}

      {source === 'Referral' && (
        <FormField label="Who referred you? We'd love to thank them!">
          <TextInput
            value={(data.referral_name as string) ?? ''}
            onChange={(value) => update('referral_name', value)}
            placeholder="Name of the person who referred you"
          />
        </FormField>
      )}
    </div>
  )
}
