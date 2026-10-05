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
    // "Settlor 1/2" is the drafting software's vocabulary, not the firm's;
    // on a matter page an unnamed spouse is just "Spouse".
    client: clientName?.trim() ? clientName.trim() : 'Client',
    spouse: spouseName?.trim() ? spouseName.trim() : 'Spouse',
    joint: 'Joint',
  }
}

export function ownershipLabel(
  ownership: Ownership,
  labels: OwnershipLabels,
): string {
  return labels[ownership] ?? ownership
}
