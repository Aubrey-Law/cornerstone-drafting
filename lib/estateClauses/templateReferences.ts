import path from 'node:path'
import PizZip from 'pizzip'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { resolveDocumentTemplateForBundledPath } from '@/lib/documentTemplates/resolver'
import { loadNodeEstatePackage, resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstatePackageDocument, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { repairSplitNunjucksInXml } from '@/lib/estateGenerator/node/templateRenderer'
import { deriveEstateGeneratorPackages } from '@/lib/estateGenerator/toGeneratorData'
import type { EstateDocumentType } from '@/lib/estateClauses/types'

const LITERAL_CALL_RE = /include_clause\s*\(\s*(["'])([a-z0-9]+(?:[._-][a-z0-9]+)+)\1(?:\s*,[^)]*)?\s*\)/gi
const ANY_CALL_RE = /include_clause\s*\(/i

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** Extract only auditable, literal include_clause("stable.key") calls from a DOCX. */
export function referencedClauseKeys(template: Buffer): string[] {
  const zip = new PizZip(template)
  const keys = new Set<string>()

  for (const fileName of Object.keys(zip.files).sort()) {
    const file = zip.files[fileName]
    if (file.dir || !fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue

    const visibleText = decodeXmlText(
      repairSplitNunjucksInXml(file.asText()).replace(/<[^>]+>/g, ''),
    )
    const unmatched = visibleText.replace(LITERAL_CALL_RE, (_call, _quote, key: string) => {
      keys.add(key)
      return ''
    })
    if (ANY_CALL_RE.test(unmatched)) {
      throw new Error(`${fileName} contains include_clause(...) without a literal stable clause key.`)
    }
  }

  return [...keys].sort()
}

export function estateDocumentTypeForTemplate(document: NodeEstatePackageDocument): EstateDocumentType {
  const value = `${document.id} ${document.title} ${document.template}`.toLowerCase()
  if (value.includes('hipaa')) return 'hipaa_authorization'
  if (value.includes('power-of-attorney') || value.includes('power of attorney')) return 'durable_power_of_attorney'
  if (value.includes('health-care') || value.includes('health care') || value.includes('living-will') || value.includes('living will') || value.includes('advance-directive')) {
    return 'health_care_directive'
  }
  if (value.includes('will')) return 'will'
  if (value.includes('trust')) return 'trust'
  return 'ancillary'
}

export function compatibleEstateDocumentTypesForTemplate(document: NodeEstatePackageDocument): EstateDocumentType[] {
  const primary = estateDocumentTypeForTemplate(document)
  return primary === 'ancillary' ? [primary] : [primary, 'ancillary']
}

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
