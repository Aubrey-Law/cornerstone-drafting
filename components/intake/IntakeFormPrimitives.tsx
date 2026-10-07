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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
      <Label htmlFor={controlId} className="text-foreground">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
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
    <Input
      id={id}
      type={type}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required={required}
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
  // Input already applies formatPhoneInput for type="tel" before calling onChange.
  return (
    <Input
      id={id}
      type="tel"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
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
  // Deliberately a native <select> (not the Radix Select) so mobile clients get
  // the platform picker; styled with the same tokens as the Input primitive.
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/60 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
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
  const controlId = useId()
  return (
    <div className="flex items-center gap-3">
      <Switch id={controlId} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={controlId} className="font-normal text-foreground">{label}</Label>
    </div>
  )
}

export function Row2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}

export function SectionDivider({ title }: { title?: string }) {
  return (
    <div className="relative py-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border" />
      </div>
      {title && (
        <div className="relative flex justify-start">
          <span className="bg-card pr-3 text-sm font-medium text-muted-foreground">{title}</span>
        </div>
      )}
    </div>
  )
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-info/20 bg-info/10 p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
      <div className="text-sm text-foreground">{children}</div>
    </div>
  )
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} className="border-dashed text-muted-foreground hover:text-foreground">
      <Plus className="h-4 w-4" />
      {label}
    </Button>
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
