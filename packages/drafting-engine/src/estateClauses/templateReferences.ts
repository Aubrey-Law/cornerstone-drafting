import PizZip from 'pizzip'
import type { NodeEstatePackageDocument } from '../estateGenerator/node/types'
import { repairSplitNunjucksInXml } from '../estateGenerator/node/templateRenderer'
import type { EstateDocumentType } from './types'

const LITERAL_CALL_RE = /include_clause\s*\(\s*(["'])([a-z0-9]+(?:[._-][a-z0-9]+)+)\1(?:\s*,[^)]*)?\s*\)/gi
const ANY_CALL_RE = /include_clause\s*\(/i
const WORD_PARAGRAPH_RE = /<w:p\b[\s\S]*?<\/w:p>/g

const DOCUMENT_TYPES_BY_ID: Readonly<Record<string, readonly EstateDocumentType[]>> = {
  'will': ['will', 'ancillary'],
  'simple-will': ['will', 'ancillary'],
  'will-cp': ['will', 'ancillary'],
  'pourover-will': ['will', 'ancillary'],
  'spouse-pourover-will': ['will', 'ancillary'],
  'testamentary-trust-will': ['will', 'ancillary'],
  'spouse-testamentary-trust-will': ['will', 'ancillary'],
  'revocable-trust': ['trust', 'ancillary'],
  'indv-disclaimer-trust': ['trust', 'ancillary'],
  'joint-trust': ['trust', 'ancillary'],
  'joint-trust-simplified': ['trust', 'ancillary'],
  'trust-individual-single': ['trust', 'ancillary'],
  'durable-poa': ['durable_power_of_attorney', 'ancillary'],
  'durable-power-of-attorney': ['durable_power_of_attorney', 'ancillary'],
  'spouse-durable-power-of-attorney': ['durable_power_of_attorney', 'ancillary'],
  'health-directive': ['health_care_directive', 'ancillary'],
  'health-care-proxy': ['health_care_directive', 'ancillary'],
  'living-will': ['health_care_directive', 'ancillary'],
  'spouse-health-care-proxy': ['health_care_directive', 'ancillary'],
  'spouse-living-will': ['health_care_directive', 'ancillary'],
  'hipaa': ['hipaa_authorization', 'ancillary'],
  'spouse-hipaa': ['hipaa_authorization', 'ancillary'],
  'young-adult-estate-plan': ['ancillary', 'durable_power_of_attorney', 'health_care_directive', 'hipaa_authorization'],
  'college-financial-poa': ['durable_power_of_attorney', 'ancillary'],
  'college-education-poa': ['durable_power_of_attorney', 'ancillary'],
  'college-health-care-proxy': ['health_care_directive', 'ancillary'],
  'college-advance-directive': ['health_care_directive', 'ancillary'],
  'college-hipaa-authorization': ['hipaa_authorization', 'ancillary'],
  'ancillary': ['ancillary'],
  'assignment-of-personal-property': ['ancillary'],
  'certificate-of-trust': ['ancillary'],
  'estate-plan-design-summary': ['ancillary'],
  'estate-plan-design-worksheet': ['ancillary'],
  'estate-plan-interview-worksheet': ['ancillary'],
  'estate-plan-summary': ['ancillary'],
  // Education records, not health information — the release shares no clause
  // language with the HIPAA authorization.
  'ferpa-release': ['ancillary'],
  'funding-instructions': ['ancillary'],
  'homestead-trustee': ['ancillary'],
  'parental-guardian-appointment': ['ancillary'],
  'personal-property-memorandum': ['ancillary'],
  'temporary-delegation-parental-powers': ['ancillary'],
  'trust-funding-plan': ['ancillary'],
}

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

    for (const paragraph of file.asText().match(WORD_PARAGRAPH_RE) ?? []) {
      const visibleText = decodeXmlText(
        repairSplitNunjucksInXml(paragraph).replace(/<[^>]+>/g, ''),
      )
      const unmatched = visibleText.replace(LITERAL_CALL_RE, (_call, _quote, key: string) => {
        keys.add(key)
        return ''
      })
      if (ANY_CALL_RE.test(unmatched)) {
        throw new Error(`${fileName} contains include_clause(...) without a literal stable clause key.`)
      }
    }
  }

  return [...keys].sort()
}

export function estateDocumentTypeForTemplate(document: NodeEstatePackageDocument): EstateDocumentType {
  const types = DOCUMENT_TYPES_BY_ID[document.id]
  if (!types) throw new Error(`Document ${document.id} has no estate clause compatibility classification.`)
  return types[0]
}

export function compatibleEstateDocumentTypesForTemplate(document: NodeEstatePackageDocument): EstateDocumentType[] {
  const types = DOCUMENT_TYPES_BY_ID[document.id]
  if (!types) throw new Error(`Document ${document.id} has no estate clause compatibility classification.`)
  return [...types]
}
