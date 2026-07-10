import { existsSync } from 'node:fs'
import path from 'node:path'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import {
  deriveEstateGeneratorPackages,
  estateGeneratorBlockingError,
  estateGeneratorCoverageWarnings,
  toEstateGeneratorData,
  unsupportedEstateGeneratorDocumentLabels,
  type EstateGeneratorPackage,
} from '@/lib/estateGenerator/toGeneratorData'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { dataForNodeEstatePackage, youngAdultEstatePlanData } from '@/lib/estateGenerator/node/packageData'
import { conditionalMissingFieldsForPackage } from '@/lib/estateGenerator/node/packageValidation'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import type { NodeEstateData, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { missingRequiredFields } from '@/lib/estateGenerator/node/validation'
import { assetTransferPreflightDocuments } from '@/lib/realEstateTransfer/draftIntegration'

export interface EstateDraftPreflightDocument {
  packageName: string
  title: string
  filename: string
}

export interface EstateDraftPreflight {
  matterId: string
  designSheetId: string | null
  engine: 'node'
  canGenerate: boolean
  packageNames: EstateGeneratorPackage[]
  nodePackageNames: EstateGeneratorPackage[]
  fallbackPackageNames: EstateGeneratorPackage[]
  unsupportedDocumentLabels: string[]
  documentsToGenerate: EstateDraftPreflightDocument[]
  missing: string[]
  warnings: string[]
  error?: string
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function fallbackPackageConfigMissing(root: string, packageName: EstateGeneratorPackage): boolean {
  return !existsSync(path.join(root, 'packages', `${packageName}.json`))
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item != null && typeof item === 'object' && !Array.isArray(item)
      ))
    : []
}

function youngAdultEstatePlanChildren(data: NodeEstateData): Array<Record<string, unknown>> {
  return recordArray(data.children).filter(child => child.young_adult_estate_plan === true)
}

export function buildEstateDraftPreflight(
  payload: DraftPayload,
  root = resolveNodeEstateGeneratorRoot(),
): EstateDraftPreflight {
  const packageNames = deriveEstateGeneratorPackages(payload)
  const data = toEstateGeneratorData(payload) as unknown as NodeEstateData
  const state = normalizeJurisdictionStateCode(payload.client.state)
  const unsupportedDocumentLabels = unsupportedEstateGeneratorDocumentLabels(payload)
  const nodePackageNames = packageNames.filter(isNodeEstatePackageSupported)
  const fallbackPackageNames = packageNames.filter(packageName => !isNodeEstatePackageSupported(packageName))
  const missingFallbackPackageConfigs = fallbackPackageNames.filter(packageName =>
    fallbackPackageConfigMissing(root, packageName)
  )
  const documentsToGenerate: EstateDraftPreflightDocument[] = []
  const missing: string[] = []
  const missingTemplateFiles: string[] = []
  const warnings = [...estateGeneratorCoverageWarnings(payload)]
  const blockingError = estateGeneratorBlockingError(payload)

  for (const packageName of nodePackageNames) {
    const config = loadNodeEstatePackage(packageName as NodeEstatePackageName, root)
    const packageDataItems = packageName === 'young-adult-estate-plan'
      ? youngAdultEstatePlanChildren(data).map(child => youngAdultEstatePlanData(data, child))
      : [dataForNodeEstatePackage(data, packageName as NodeEstatePackageName)]
    if (packageName === 'young-adult-estate-plan' && packageDataItems.length === 0) {
      warnings.push('Young Adult Estate Plan selected, but no child with a DOB from age 17.5 through 25 was found.')
    }
    for (const packageData of packageDataItems) {
      const context = buildNodeEstateContext({ data: packageData, state, root })
      missing.push(...missingRequiredFields(context, config.required_fields))
      missing.push(...conditionalMissingFieldsForPackage(packageName, context))
    }
    missingTemplateFiles.push(
      ...config.documents
        .map(document => document.template)
        .filter(template => !existsSync(path.join(root, template))),
    )
    const repeatCount = packageName === 'young-adult-estate-plan'
      ? Math.max(packageDataItems.length, 1)
      : 1
    for (let index = 0; index < repeatCount; index += 1) {
      documentsToGenerate.push(...config.documents.map(document => ({
        packageName,
        title: document.title,
        filename: document.output,
      })))
    }
  }

  if (fallbackPackageNames.length > 0) {
    warnings.push(`Selected package(s) require the temporary Python fallback: ${fallbackPackageNames.join(', ')}.`)
  }

  documentsToGenerate.push(...assetTransferPreflightDocuments(payload.documents))

  const uniqueMissing = uniqueStrings(missing)
  let error: string | undefined

  // Missing generator fields are intentionally NOT a blocking error: the draft
  // still generates with visible `[[ MISSING: field ]]` markers where each empty
  // value would go. They are surfaced via the `missing` array (shown in the
  // drafting UI). Only the structural problems below actually block generation.
  if (packageNames.length === 0 && documentsToGenerate.length === 0) {
    error = 'No supported estate generator packages are selected.'
  } else if (blockingError) {
    error = blockingError
  } else if (missingFallbackPackageConfigs.length > 0) {
    const packages = missingFallbackPackageConfigs.join(', ')
    error = `Selected package(s) are not available to the estate generator: ${packages}`
  } else if (missingTemplateFiles.length > 0) {
    error = `Generator template file(s) are missing: ${uniqueStrings(missingTemplateFiles).join(', ')}`
  }

  return {
    matterId: payload.matter.id,
    designSheetId: payload.design_sheet_id,
    engine: 'node',
    canGenerate: !error,
    packageNames,
    nodePackageNames,
    fallbackPackageNames,
    unsupportedDocumentLabels,
    documentsToGenerate,
    missing: uniqueMissing,
    warnings: uniqueStrings(warnings),
    error,
  }
}
