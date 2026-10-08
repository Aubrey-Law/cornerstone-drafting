'use client'

import { useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { toast } from 'sonner'

interface SpouseData {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  email?: string
  phone?: string
  [key: string]: unknown
}

interface ChildData {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  relationship_type?: string
  [key: string]: unknown
}

interface FiduciaryEntry {
  first_name?: string
  last_name?: string
  relationship?: string
  phone?: string
  email?: string
  address?: string
  priority: number
  [key: string]: unknown
}

async function callContactsApi(token: string, body: Record<string, unknown>, publicToken = false) {
  const res = await fetch('/api/intake/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(publicToken ? { 'X-Intake-Token': token } : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export function useContacts(intakeId: string, options: { throwOnError?: boolean; publicIntakeToken?: string } = {}) {
  const { throwOnError = false, publicIntakeToken } = options
  const getToken = useCallback(async () => {
    if (publicIntakeToken) return publicIntakeToken
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token && throwOnError) throw new Error('Your session has expired. Please refresh and try again.')
    return session?.access_token ?? null
  }, [publicIntakeToken, throwOnError])

  const saveSpouse = useCallback(
    async (data: SpouseData) => {
      const token = await getToken()
      if (!token) return
      try {
        await callContactsApi(token, { action: 'save_spouse', intakeId, data: formatPhoneFieldsDeep(data) }, !!publicIntakeToken)
      } catch (err) {
        console.error('Save spouse error:', err)
        toast.error('Failed to save spouse information.')
        if (throwOnError) throw err
      }
    },
    [intakeId, getToken, publicIntakeToken, throwOnError]
  )

  const saveChildren = useCallback(
    async (children: ChildData[]) => {
      const token = await getToken()
      if (!token) return
      try {
        await callContactsApi(token, { action: 'save_children', intakeId, children }, !!publicIntakeToken)
      } catch (err) {
        console.error('Save children error:', err)
        toast.error('Failed to save children information.')
        if (throwOnError) throw err
      }
    },
    [intakeId, getToken, publicIntakeToken, throwOnError]
  )

  const saveFiduciaries = useCallback(
    async (
      entries: FiduciaryEntry[],
      role: string,
      forParty: 'client' | 'spouse'
    ) => {
      const token = await getToken()
      if (!token) return
      try {
        await callContactsApi(token, { action: 'save_fiduciaries', intakeId, entries: formatPhoneFieldsDeep(entries), role, forParty }, !!publicIntakeToken)
      } catch (err) {
        console.error('Save fiduciaries error:', err)
        toast.error('Failed to save fiduciary information.')
        if (throwOnError) throw err
      }
    },
    [intakeId, getToken, publicIntakeToken, throwOnError]
  )

  const saveAdditionalContacts = useCallback(
    async (contactsPayload: Record<string, unknown>[]) => {
      const token = await getToken()
      if (!token) return
      try {
        await callContactsApi(token, {
          action: 'save_additional_contacts',
          intakeId,
          contacts: formatPhoneFieldsDeep(contactsPayload),
        }, !!publicIntakeToken)
      } catch (err) {
        console.error('Save additional contacts error:', err)
        toast.error('Failed to save additional contacts.')
        if (throwOnError) throw err
      }
    },
    [intakeId, getToken, publicIntakeToken, throwOnError]
  )

  return { saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts }
}
