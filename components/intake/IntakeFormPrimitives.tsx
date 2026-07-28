'use client'

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Info, Plus } from 'lucide-react'

import {
  AddressAutocomplete,
  type ParsedAddress as AutocompleteAddress,
} from '@/components/address-autocomplete'
import { formatPhoneInput } from '@/lib/phone'
import { MA_COUNTY_OPTIONS } from '@/lib/sharedFields'
import { cn } from '@/lib/utils'

export function FormField({
  label,
  children,
  className,
  optional,
}: {
  label: string
  children: ReactNode
  className?: string
  optional?: boolean
}) {
  const controlId = useId()
  const child = isValidElement(children) && children.type !== 'div'
    ? cloneElement(children as ReactElement<{ id?: string }>, {
        id: (children.props as { id?: string }).id ?? controlId,
      })
    : children

  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={controlId} className="block text-sm font-medium text-gray-700">
        {label}
        {optional && <span className="ml-1 font-normal text-gray-400">(optional)</span>}
      </label>
      {child}
    </div>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  id,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  required?: boolean
  id?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:text-sm"
    />
  )
}

export function PhoneInput({
  value,
  onChange,
  placeholder = '(555) 123-4567',
  id,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
}) {
  return (
    <input
      id={id}
      type="tel"
      value={value ?? ''}
      onChange={(event) => onChange(formatPhoneInput(event.target.value))}
      placeholder={placeholder}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:text-sm"
    />
  )
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  id?: string
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:text-sm"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-accent' : 'bg-gray-200',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

export function Row2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}

export function SectionDivider({ title }: { title?: string }) {
  return (
    <div className="relative py-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-200" />
      </div>
      {title && (
        <div className="relative flex justify-start">
          <span className="bg-white pr-3 text-sm font-medium text-gray-500">{title}</span>
        </div>
      )}
    </div>
  )
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
      <div className="text-sm text-blue-800">{children}</div>
    </div>
  )
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-800"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  )
}

export interface IntakeParsedAddress {
  street: string
  city: string
  state: string
  zip: string
  county: string
}

export function AddressSearch({
  onSelect,
}: {
  onSelect: (address: IntakeParsedAddress) => void
}) {
  const [query, setQuery] = useState('')

  return (
    <AddressAutocomplete
      value={query}
      onChange={setQuery}
      onPlaceSelected={(address: AutocompleteAddress) => {
        onSelect({
          street: address.address_line1,
          city: address.city,
          state: address.state,
          zip: address.zip,
          county: address.county,
        })
      }}
      placeholder="Start typing an address to search…"
    />
  )
}

export function ContactAddressFields({
  street,
  city,
  state,
  zip,
  county,
  onStreetChange,
  onCityChange,
  onStateChange,
  onZipChange,
  onCountyChange,
  onAddressSelect,
}: {
  street: string
  city: string
  state: string
  zip: string
  county: string
  onStreetChange: (value: string) => void
  onCityChange: (value: string) => void
  onStateChange: (value: string) => void
  onZipChange: (value: string) => void
  onCountyChange: (value: string) => void
  onAddressSelect: (address: IntakeParsedAddress) => void
}) {
  return (
    <div className="space-y-3">
      <FormField label="Search Address">
        <AddressSearch onSelect={onAddressSelect} />
      </FormField>
      <FormField label="Street Address">
        <TextInput value={street} onChange={onStreetChange} />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label="City" className="sm:col-span-2">
          <TextInput value={city} onChange={onCityChange} />
        </FormField>
        <FormField label="State">
          <TextInput value={state} onChange={onStateChange} />
        </FormField>
        <FormField label="ZIP">
          <TextInput value={zip} onChange={onZipChange} />
        </FormField>
      </div>
      {county !== undefined && (
        <FormField label="County">
          <SelectInput
            value={county}
            onChange={onCountyChange}
            placeholder="Select county"
            options={MA_COUNTY_OPTIONS}
          />
        </FormField>
      )}
    </div>
  )
}
