import type { PmpsPlanStructure } from '@/lib/pmps/types'

export const MA_ESTATE_EXCLUSION = 2_000_000
export const MA_ESTATE_CREDIT = 99_600
export const MA_ADJUSTMENT = 60_000
export const FEDERAL_BASIC_EXCLUSION_2026 = 15_000_000
export const ANNUAL_GIFT_EXCLUSION_2026 = 19_000

const BRACKETS = [
  [0, 40_000, 0, 0], [40_000, 90_000, 0, 0.008], [90_000, 140_000, 400, 0.016],
  [140_000, 240_000, 1_200, 0.024], [240_000, 440_000, 3_600, 0.032],
  [440_000, 640_000, 10_000, 0.04], [640_000, 840_000, 18_000, 0.048],
  [840_000, 1_040_000, 27_600, 0.056], [1_040_000, 1_540_000, 38_800, 0.064],
  [1_540_000, 2_040_000, 70_800, 0.072], [2_040_000, 2_540_000, 106_800, 0.08],
  [2_540_000, 3_040_000, 146_800, 0.088], [3_040_000, 3_540_000, 190_800, 0.096],
  [3_540_000, 4_040_000, 238_800, 0.104], [4_040_000, 5_040_000, 290_800, 0.112],
  [5_040_000, 6_040_000, 402_800, 0.12], [6_040_000, 7_040_000, 522_800, 0.128],
  [7_040_000, 8_040_000, 650_800, 0.136], [8_040_000, 9_040_000, 786_800, 0.144],
  [9_040_000, 10_040_000, 930_800, 0.152], [10_040_000, Number.POSITIVE_INFINITY, 1_082_800, 0.16],
] as const

export interface PmpsTaxScenario {
  taxableEstate: number
  adjustedTaxableEstate: number
  bracketFloor: number
  baseTax: number
  excess: number
  bracketRate: number
  grossTax: number
  credit: number
  netTax: number
}

export function computeMaEstateTax(taxableEstate: number): PmpsTaxScenario {
  const estate = Math.max(0, Math.round(taxableEstate))
  const adjusted = Math.max(0, estate - MA_ADJUSTMENT)
  if (estate <= MA_ESTATE_EXCLUSION) {
    return { taxableEstate: estate, adjustedTaxableEstate: adjusted, bracketFloor: 0, baseTax: 0, excess: 0, bracketRate: 0, grossTax: 0, credit: 0, netTax: 0 }
  }
  const bracket = BRACKETS.find(([, ceiling]) => adjusted <= ceiling) ?? BRACKETS.at(-1)!
  const [floor, , baseTax, rate] = bracket
  const excess = Math.max(0, adjusted - floor)
  const grossTax = Math.round(baseTax + excess * rate)
  return { taxableEstate: estate, adjustedTaxableEstate: adjusted, bracketFloor: floor, baseTax, excess, bracketRate: rate, grossTax, credit: MA_ESTATE_CREDIT, netTax: Math.max(0, grossTax - MA_ESTATE_CREDIT) }
}

export function computePmpsTax(grossEstate: number, structure: PmpsPlanStructure) {
  const withoutPlanning = computeMaEstateTax(grossEstate)
  const preservesBoth = structure === 'joint_disclaimer' || structure === 'separate_clayton'
  const withPlanning = preservesBoth ? computeMaEstateTax(Math.max(0, grossEstate - 4_000_000)) : null
  return { withoutPlanning, withPlanning, savings: withPlanning ? Math.max(0, withoutPlanning.netTax - withPlanning.netTax) : 0 }
}
