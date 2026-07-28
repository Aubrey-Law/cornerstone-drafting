'use client'

import { Trash2 } from 'lucide-react'

import {
  AddButton,
  FormField,
  PhoneInput,
  Row2,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '@/components/intake/IntakeFormPrimitives'
import {
  CHILD_RELATIONSHIP_OPTIONS,
  PRONOUN_OPTIONS,
  SUFFIX_OPTIONS,
} from '@/lib/sharedFields'
import { cn } from '@/lib/utils'

import type { StepProps } from './IntakeWizard'

const SUFFIXES = SUFFIX_OPTIONS.map((option) => option.value)

export interface ChildEntry {
  id?: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  date_of_birth: string
  pronouns: string
  email: string
  phone: string
  same_address: boolean
  parent: string
  relationship?: string
  [key: string]: unknown
}

export function StepChildren({ data, update }: StepProps) {
  const children = (data._children as ChildEntry[]) ?? []
  const clientFirstName = (data.first_name as string) || 'Client'
  const spouse = data._spouse as Record<string, string> | undefined
  const spouseFirstName = spouse?.first_name || ''
  const isMarried = data.marital_status === 'married'

  function updateChildren(updated: ChildEntry[]) {
    update('_children', updated)
  }

  function addChild() {
    updateChildren([...children, {
      id: crypto.randomUUID(),
      first_name: '',
      middle_name: '',
      last_name: '',
      suffix: '',
      date_of_birth: '',
      pronouns: '',
      email: '',
      phone: '',
      same_address: false,
      parent: 'both',
      relationship: 'biological',
    }])
  }

  function removeChild(index: number) {
    updateChildren(children.filter((_, childIndex) => childIndex !== index))
  }

  function updateChild(index: number, field: string, value: unknown) {
    const updated = [...children]
    updated[index] = { ...updated[index], [field]: value }
    updateChildren(updated)
  }

  return (
    <div className="space-y-4">
      {children.map((child, index) => (
        <div key={child.id ?? index} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Child {index + 1}</span>
            <button
              type="button"
              onClick={() => removeChild(index)}
              aria-label={`Remove child ${index + 1}`}
              className="text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="First Name">
                <TextInput value={child.first_name} onChange={(value) => updateChild(index, 'first_name', value)} />
              </FormField>
              <FormField label="Middle Name">
                <TextInput value={child.middle_name ?? ''} onChange={(value) => updateChild(index, 'middle_name', value)} />
              </FormField>
              <FormField label="Last Name">
                <TextInput value={child.last_name} onChange={(value) => updateChild(index, 'last_name', value)} />
              </FormField>
              <FormField label="Suffix">
                <SelectInput
                  value={child.suffix ?? ''}
                  onChange={(value) => updateChild(index, 'suffix', value)}
                  placeholder="—"
                  options={SUFFIXES.map((suffix) => ({ value: suffix, label: suffix }))}
                />
              </FormField>
            </div>
            <Row2>
              <FormField label="Date of Birth">
                <TextInput value={child.date_of_birth} onChange={(value) => updateChild(index, 'date_of_birth', value)} type="date" />
              </FormField>
              <FormField label="Relationship">
                <SelectInput
                  value={child.relationship ?? 'biological'}
                  onChange={(value) => updateChild(index, 'relationship', value)}
                  options={CHILD_RELATIONSHIP_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Pronouns">
                <SelectInput
                  value={child.pronouns ?? ''}
                  onChange={(value) => updateChild(index, 'pronouns', value)}
                  placeholder="Select pronouns"
                  options={PRONOUN_OPTIONS}
                />
              </FormField>
              <div />
            </Row2>
            <Row2>
              <FormField label="Email">
                <TextInput value={child.email ?? ''} onChange={(value) => updateChild(index, 'email', value)} type="email" />
              </FormField>
              <FormField label="Phone">
                <PhoneInput value={child.phone ?? ''} onChange={(value) => updateChild(index, 'phone', value)} />
              </FormField>
            </Row2>
            <ToggleSwitch
              checked={child.same_address ?? false}
              onChange={(value) => updateChild(index, 'same_address', value)}
              label="Same address as client"
            />
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Parent</p>
              <div className="flex flex-wrap gap-2">
                {(['both', clientFirstName, ...(isMarried && spouseFirstName ? [spouseFirstName] : [])]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => updateChild(index, 'parent', option)}
                    aria-pressed={(child.parent ?? 'both') === option}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                      (child.parent ?? 'both') === option
                        ? 'border-accent bg-accent text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400',
                    )}
                  >
                    {option === 'both' ? 'Both' : option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
      <AddButton onClick={addChild} label="Add child" />
    </div>
  )
}
