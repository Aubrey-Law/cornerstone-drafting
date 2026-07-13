import path from 'node:path'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { deriveEstateGeneratorPackages } from '@/lib/estateGenerator/toGeneratorData'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { selectedRealEstateTransferDocTypes } from '@/lib/realEstateTransfer/draftIntegration'
import { DEED_TEMPLATE_VARIANTS, DOCUMENT_TYPES } from '@/lib/realEstateTransfer/fields'
import { resolveDocumentTemplateForBundledPath } from './resolver'

export async function publishedTemplatePreflightError(payload: DraftPayload): Promise<string | null> {
  const root = resolveNodeEstateGeneratorRoot()
  const paths = new Set<string>()
  for (const packageName of deriveEstateGeneratorPackages(payload)) {
    try {
      const config = loadNodeEstatePackage(packageName as NodeEstatePackageName, root)
      for (const document of config.documents) {
        paths.add(path.relative(process.cwd(), path.join(root, document.template)).replaceAll('\\', '/'))
      }
    } catch {
      // The ordinary drafting preflight reports missing/unsupported packages.
    }
  }
  for (const docType of selectedRealEstateTransferDocTypes(payload.documents)) {
    if (docType === 'deed') {
      for (const variant of Object.values(DEED_TEMPLATE_VARIANTS)) {
        paths.add(`tools/aubreylaw-docgeneration/templates/${variant.templateFile}`)
      }
    } else {
      paths.add(`tools/aubreylaw-docgeneration/templates/${DOCUMENT_TYPES[docType].templateFile}`)
    }
  }
  try {
    await Promise.all([...paths].map(templatePath => resolveDocumentTemplateForBundledPath(templatePath)))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
