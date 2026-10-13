/** Display copy for a ledger charge. A quoted amount replaces a TBD plan name. */
export function ledgerChargeLabel(label: string, amountBilled: number): string {
  if (amountBilled > 0 && /^flat fee\s*[-–—]\s*(tbd|to be determined)\s*$/i.test(label.trim())) {
    return 'Flat fee'
  }
  return label
}

/** How long an unpaid charge has been ready to bill or collect. */
export function readyForLabel(ageDays: number): string {
  if (ageDays <= 0) return 'Ready today.'
  if (ageDays === 1) return 'Ready for 1 day.'
  return `Ready for ${ageDays} days.`
}
