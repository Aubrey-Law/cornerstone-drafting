import path from 'node:path'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { resolveDocumentTemplateForBundledPath } from '@/lib/documentTemplates/resolver'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { deriveEstateGeneratorPackages } from '@/lib/estateGenerator/toGeneratorData'
import type { EstateDocumentType } from '@/lib/estateClauses/types'

// The template-scanning half of this module moved to @aubrey-law/drafting-engine
// during Phase 1 of the Workbench overhaul: it reads bytes and classifies
// documents, and needs neither the database nor a matter. Re-exported here so
// existing call sites keep resolving.
import {
  referencedClauseKeys,
  estateDocumentTypeForTemplate,
  compatibleEstateDocumentTypesForTemplate,
} from '@aubrey-law/drafting-engine/estateClauses/templateReferences'

export { referencedClauseKeys, estateDocumentTypeForTemplate, compatibleEstateDocumentTypesForTemplate }

// What stays: this function takes a DraftPayload and reads published template
// versions from the database, so it is matter-shaped and app-shaped both.

export interface SelectedEstateTemplateReference {
  packageName: NodeEstatePackageName
  documentTypes: EstateDocumentType[]
  clauseKeys: string[]
}

/** Resolves the current published-or-bundled bytes for templates selected by this matter. */
export async function selectedEstateTemplateReferences(payload: DraftPayload): Promise<SelectedEstateTemplateReference[]> {
  const root = resolveNodeEstateGeneratorRoot()
  const selected: SelectedEstateTemplateReference[] = []

  for (const packageName of deriveEstateGeneratorPackages(payload)) {
    const config = loadNodeEstatePackage(packageName as NodeEstatePackageName, root)
    for (const document of config.documents) {
      const bundledPath = path.relative(process.cwd(), path.join(root, document.template)).replaceAll('\\', '/')
      const resolved = await resolveDocumentTemplateForBundledPath(bundledPath)
      selected.push({
        packageName: packageName as NodeEstatePackageName,
        documentTypes: compatibleEstateDocumentTypesForTemplate(document),
        clauseKeys: referencedClauseKeys(resolved.buffer),
      })
    }
  }

  return selected
}
