'use client'

import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { wizardStreetLine } from '@/lib/intakeContactAddress'
import { FINANCIAL_DETAILS_ROOT_KEYS, isFinancialDetailsRootKey } from '@/lib/intakeFinancialFields'
import { isReferralDetailKey, packReferralDetailsIntoFamilyDetails } from '@/lib/intakeReferralDetails'
import { intakeExcludedGuardianTextFromRequestBody } from '@/lib/intakeContactHydration'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { toast } from 'sonner'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useAutoSave(intakeId: string, delay = 1500, publicIntakeToken?: string) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(
    async (data: Record<string, unknown>): Promise<boolean> => {
      const payload: Record<string, unknown> = {}
      const financialDetails: Record<string, unknown> = {}
      // _fid_* keys are still the wizard/server wire format for contact_roles.
      // Children and additional contacts travel as top-level contact payloads.
      const fiduciaryEntries: Record<string, unknown> = {}

      // Pass 1: non-underscore fields
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('_')) continue
        if (isFinancialDetailsRootKey(key)) continue
        if (isReferralDetailKey(key)) continue
        // referral_source has no dedicated column on client_intake — it lives
        // inside family_details.referral.source (packed below). Skip it here
        // so the UPDATE doesn't fail with "column does not exist".
        if (key === 'referral_source') continue
        if (key.startsWith('financial_')) {
          financialDetails[key.slice('financial_'.length)] = value
        } else {
          payload[key] = value
        }
      }

      if (payload.preferred_pronoun === undefined && payload.pronouns !== undefined) {
        payload.preferred_pronoun = payload.pronouns
      }
      delete payload.pronouns

      // Pass 2: underscore fields — persist the ones that matter
      for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith('_')) continue

        if (key === '_fid_excluded_guardian') {
          payload.excluded_guardian = intakeExcludedGuardianTextFromRequestBody({
            _fid_excluded_guardian: value,
          })

        } else if (key.startsWith('_fid_')) {
          // Pack fiduciary role arrays into fiduciary_entries (strip leading _)
          fiduciaryEntries[key.slice(1)] = value

        } else if (key === '_children') {
          payload.children = value

        } else if (key === '_additional_contacts') {
          payload.additional_contacts = value

        } else if (key === '_review_choices') {
          // F4a: review_choices lives in its own client_intake column now,
          // not nested in fiduciary_entries. Send as top-level body field.
          payload.review_choices = value

        } else if (key === '_spouse') {
          // Unpack _spouse object into individual spouse_* columns
          const spouseObj = value as Record<string, unknown> | undefined
          if (spouseObj && typeof spouseObj === 'object') {
            const s = spouseObj
            if (s.first_name     !== undefined) payload.spouse_first_name     = s.first_name
            if (s.last_name      !== undefined) payload.spouse_last_name      = s.last_name
            if (s.middle_name    !== undefined) payload.spouse_middle_name    = s.middle_name
            if (s.suffix         !== undefined) payload.spouse_suffix         = s.suffix
            if (s.prior_names    !== undefined) payload.spouse_prior_names    = s.prior_names
            if (s.preferred_name !== undefined) payload.spouse_preferred_name = s.preferred_name
            const spousePreferredPronoun =
              s.preferred_pronoun !== undefined ? s.preferred_pronoun : s.pronouns
            if (spousePreferredPronoun !== undefined) payload.spouse_preferred_pronoun = spousePreferredPronoun
            if (s.date_of_birth  !== undefined) payload.spouse_date_of_birth  = (s.date_of_birth as string) || null
            if (s.is_us_citizen  !== undefined) payload.spouse_is_us_citizen  = s.is_us_citizen
            if (s.phone          !== undefined) payload.spouse_phone          = s.phone
            if (s.email          !== undefined) payload.spouse_email          = s.email
          }
        }
        // All other _ fields are local UI state only — skip
      }

      // Merge asset-type checkboxes + circumstances into JSONB blob (same column as modal totals).
      for (const k of FINANCIAL_DETAILS_ROOT_KEYS) {
        if (data[k] !== undefined) {
          financialDetails[k] = data[k]
        }
      }

      if (Object.keys(financialDetails).length > 0) {
        payload.financial_details = financialDetails
      }
      if (Object.keys(fiduciaryEntries).length > 0) {
        payload.fiduciary_entries = fiduciaryEntries
      }

      const familyDetails = packReferralDetailsIntoFamilyDetails(data)
      if (familyDetails !== undefined) {
        payload.family_details = familyDetails
      }

      // Keep DB `address_line1` in sync when the wizard field is `street_address`.
      if ('street_address' in payload) {
        const line = wizardStreetLine(data as Record<string, unknown>).trim()
        const existing =
          typeof payload.address_line1 === 'string'
            ? payload.address_line1.trim()
            : ''
        payload.address_line1 =
          line.length > 0 ? line : existing.length > 0 ? existing : null
        delete payload.street_address
      }

      setStatus('saving')

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (publicIntakeToken) {
        // Public token-based auth — no Supabase session required
        headers['X-Intake-Token'] = publicIntakeToken
      } else {
        const { data: { session } } = await supabase.auth.getSession()
        const sessionToken = session?.access_token
        if (!sessionToken) {
          setStatus('error')
          console.error('Auto-save error: no auth session')
          return false
        }
        headers['Authorization'] = `Bearer ${sessionToken}`
      }

      try {
        const res = await fetch('/api/intake', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...formatPhoneFieldsDeep(payload), existingId: intakeId }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setStatus('error')
          toast.error('Failed to save your progress. Please try again.')
          console.error('Auto-save error:', err)
          return false
        }
      } catch (err) {
        setStatus('error')
        toast.error('Failed to save your progress. Please try again.')
        console.error('Auto-save error:', err)
        return false
      }
      setStatus('saved')
      return true
    },
    [intakeId, publicIntakeToken]
  )

  const debouncedSave = useCallback(
    (data: Record<string, unknown>) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => persist(data), delay)
    },
    [persist, delay]
  )

  const saveNow = useCallback(
    (data: Record<string, unknown>) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      return persist(data)
    },
    [persist]
  )

  const latestRef = useRef<Record<string, unknown> | null>(null)
  const trackForFlush = useCallback((data: Record<string, unknown>) => {
    latestRef.current = data
  }, [])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (latestRef.current) {
      const ok = await persist(latestRef.current)
      latestRef.current = null
      return ok
    }
    return true
  }, [persist])

  return { status, debouncedSave, saveNow, flush, trackForFlush }
}
