import type { Ownership } from '@/lib/estateTax'

export interface OwnershipLabels {
  client: string
  spouse: string
  joint: string
}

export function buildOwnershipLabels(
  clientName?: string | null,
  spouseName?: string | null,
): OwnershipLabels {
  return {
    client: clientName?.trim() ? clientName.trim() : 'Settlor 1',
    spouse: spouseName?.trim() ? spouseName.trim() : 'Settlor 2',
    joint: 'Joint',
  }
}

export function ownershipLabel(
  ownership: Ownership,
  labels: OwnershipLabels,
): string {
  return labels[ownership] ?? ownership
}
