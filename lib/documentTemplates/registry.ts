import fs from 'node:fs'
import path from 'node:path'
import { DEED_TEMPLATE_VARIANTS, DOCUMENT_TYPES } from '@/lib/realEstateTransfer/fields'
import type { DocumentTemplateDefinition } from './types'

const GENERATOR_ROOT = 'tools/aubreylaw-docgeneration'

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.docx$/i, '')
    .split('-')
    .map(word => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ')
}

function estateDefinitions(cwd: string): DocumentTemplateDefinition[] {
  const packagesDir = path.join(cwd, GENERATOR_ROOT, 'packages')
  const byPath = new Map<string, DocumentTemplateDefinition>()
  if (!fs.existsSync(packagesDir)) return []

  for (const filename of fs.readdirSync(packagesDir).filter(name => name.endsWith('.json')).sort()) {
    const packageName = filename.replace(/\.json$/, '')
    const config = JSON.parse(fs.readFileSync(path.join(packagesDir, filename), 'utf8')) as {
      documents?: Array<{ title?: string; template?: string }>
    }
    for (const document of config.documents ?? []) {
      if (!document.template?.endsWith('.docx')) continue
      const bundledPath = path.posix.join(GENERATOR_ROOT, document.template)
      const existing = byPath.get(bundledPath)
      if (existing) {
        if (!existing.packageNames.includes(packageName)) existing.packageNames.push(packageName)
        continue
      }
      const basename = path.posix.basename(document.template)
      byPath.set(bundledPath, {
        id: `estate-${basename.replace(/\.docx$/i, '')}`,
        label: document.title?.trim() || titleFromFilename(basename),
        category: 'estate',
        renderer: 'estate_nunjucks',
        bundledPath,
        packageNames: [packageName],
      })
    }
  }
  return [...byPath.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function realEstateDefinitions(): DocumentTemplateDefinition[] {
  const deedDefinitions = Object.values(DEED_TEMPLATE_VARIANTS).map(meta => ({
    id: meta.id,
    label: meta.label,
    category: 'real_estate' as const,
    renderer: 'real_estate_docxtemplater' as const,
    bundledPath: `${GENERATOR_ROOT}/templates/${meta.templateFile}`,
    packageNames: ['real-estate-transfer'],
  }))
  const otherDefinitions = Object.entries(DOCUMENT_TYPES)
    .filter(([docType]) => docType !== 'deed')
    .map(([docType, meta]) => ({
      id: `real-estate-${docType.replaceAll('_', '-')}`,
      label: meta.label,
      category: 'real_estate' as const,
      renderer: 'real_estate_docxtemplater' as const,
      bundledPath: `${GENERATOR_ROOT}/templates/${meta.templateFile}`,
      packageNames: ['real-estate-transfer'],
    }))
  return [...deedDefinitions, ...otherDefinitions]
}

export function getDocumentTemplateRegistry(cwd = process.cwd()): DocumentTemplateDefinition[] {
  return [
    ...estateDefinitions(cwd),
    ...realEstateDefinitions(),
    {
      id: 'engagement-ep-trust-couple',
      label: 'Engagement Agreement — Estate Plan Trust Couple',
      category: 'engagement',
      renderer: 'engagement_docxtemplater',
      bundledPath: 'assets/engagement-agreements/ep-trust-couple-v1.docx',
      packageNames: ['engagement-agreement'],
    },
  ]
}

export function getDocumentTemplateDefinition(id: string): DocumentTemplateDefinition | null {
  return getDocumentTemplateRegistry().find(template => template.id === id) ?? null
}

export function documentTemplateDefinitionForPath(bundledPath: string): DocumentTemplateDefinition | null {
  const normalized = bundledPath.replaceAll('\\', '/')
  return getDocumentTemplateRegistry().find(template => template.bundledPath === normalized) ?? null
}
