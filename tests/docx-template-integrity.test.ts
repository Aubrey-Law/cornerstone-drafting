import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { XMLValidator } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'

// Word refuses to open ("found unreadable content") a docx whose package
// structure is invalid, even when every XML part is well-formed. These checks
// cover the invariants that have actually broken: a body-level <w:sectPr>
// that is not the last child of <w:body>, and header/footer references left
// pointing at relationship IDs from a different source document. They run
// against every checked-in template and against freshly generated output so a
// broken template can't ship silently.

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')
const templatesDir = path.join(root, 'templates')

const REL_REF_RE = /\br:(?:id|embed|link|pict|dm|lo|qs|cs)="([^"]+)"/g
const HEADER_FOOTER_REF_RE = /<w:(header|footer)Reference\b[^>]*\br:id="([^"]+)"/g

// Resolve a relationship target (relative to the source part's directory)
// to a package part name, e.g. word + ../customXml/item1.xml -> customXml/item1.xml.
function resolveTarget(sourceDir: string, target: string): string {
  const joined = sourceDir ? `${sourceDir}/${target}` : target
  const segments: string[] = []
  for (const segment of joined.split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '.' && segment !== '') segments.push(segment)
  }
  return segments.join('/')
}

function parseRelationships(relsXml: string): Map<string, { type: string; target: string; external: boolean }> {
  const rels = new Map<string, { type: string; target: string; external: boolean }>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0]
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? ''
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1] ?? ''
    const external = /\bTargetMode="External"/.test(tag)
    if (id) rels.set(id, { type, target, external })
  }
  return rels
}

// Children of <w:body> in document order, by tag name. A cheap tokenizer is
// enough: track depth by matching w:* open/close tags and record depth-1 tags.
function bodyChildTags(documentXml: string): string[] {
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml)
  if (!bodyMatch) return []
  const body = bodyMatch[1]
  const children: string[] = []
  let depth = 0
  for (const match of body.matchAll(/<(\/?)([\w:]+)\b[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    if (closing) {
      depth -= 1
    } else {
      if (depth === 0) children.push(name)
      if (!selfClosing) depth += 1
    }
  }
  return children
}

export function docxPackageIssues(buffer: Buffer | Uint8Array): string[] {
  const issues: string[] = []
  const zip = new PizZip(buffer)
  const parts = new Set(Object.keys(zip.files).filter(name => !zip.files[name].dir))

  const xmlParts = [...parts].filter(name => name.endsWith('.xml') || name.endsWith('.rels'))
  for (const name of xmlParts) {
    const valid = XMLValidator.validate(zip.files[name].asText())
    if (valid !== true) issues.push(`${name}: not well-formed XML (${valid.err.msg})`)
  }
  if (issues.length > 0) return issues

  const contentTypes = zip.files['[Content_Types].xml']?.asText() ?? ''
  const defaultExtensions = new Set(
    [...contentTypes.matchAll(/<Default\b[^>]*\bExtension="([^"]+)"/g)].map(match => match[1].toLowerCase()),
  )
  const overrideParts = new Set(
    [...contentTypes.matchAll(/<Override\b[^>]*\bPartName="([^"]+)"/g)].map(match => match[1]),
  )
  for (const name of parts) {
    if (name === '[Content_Types].xml') continue
    const extension = name.split('.').pop()?.toLowerCase() ?? ''
    if (!defaultExtensions.has(extension) && !overrideParts.has(`/${name}`)) {
      issues.push(`${name}: no content type declared`)
    }
  }

  for (const name of [...parts].filter(part => part.endsWith('.xml'))) {
    const xml = zip.files[name].asText()
    const sourceDir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
    const relsName = `${sourceDir ? `${sourceDir}/` : ''}_rels/${name.slice(sourceDir ? sourceDir.length + 1 : 0)}.rels`
    const rels = parts.has(relsName) ? parseRelationships(zip.files[relsName].asText()) : new Map()

    for (const match of xml.matchAll(REL_REF_RE)) {
      const rel = rels.get(match[1])
      if (!rel) {
        issues.push(`${name}: references relationship ${match[1]} which is not declared in ${relsName}`)
      } else if (!rel.external && !parts.has(resolveTarget(sourceDir, rel.target))) {
        issues.push(`${name}: relationship ${match[1]} targets missing part ${rel.target}`)
      }
    }
    for (const match of xml.matchAll(HEADER_FOOTER_REF_RE)) {
      const rel = rels.get(match[2])
      if (rel && !rel.type.endsWith(`/${match[1]}`)) {
        issues.push(`${name}: w:${match[1]}Reference ${match[2]} points at a ${rel.type.split('/').pop()} relationship`)
      }
    }

    if (name === 'word/document.xml') {
      const children = bodyChildTags(xml)
      const sectPrIndex = children.indexOf('w:sectPr')
      if (sectPrIndex !== -1 && sectPrIndex !== children.length - 1) {
        issues.push(`${name}: body-level w:sectPr must be the last child of w:body (found at index ${sectPrIndex} of ${children.length})`)
      }
    }
  }

  return issues
}

describe('docx template package integrity', () => {
  const templates = fs.readdirSync(templatesDir).filter(name => name.endsWith('.docx'))

  it('finds the template directory', () => {
    expect(templates.length).toBeGreaterThan(0)
  })

  it.each(templates)('%s is a valid docx package', templateName => {
    const buffer = fs.readFileSync(path.join(templatesDir, templateName))
    expect(docxPackageIssues(buffer)).toEqual([])
  })
})

describe('generated incapacity documents package integrity', () => {
  it('produces valid packages with resolved footers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    )
    const result = await generateNodeEstatePackage({
      data, packageName: 'incapacity-documents', state: 'MA', root, allowDraft: true,
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.files.length).toBe(4)

    for (const file of result.files) {
      expect(docxPackageIssues(file.buffer), file.name).toEqual([])
    }

    // Every document's footers name the client; the [CLIENT] / [CLIENT FULL
    // NAME] markers must be substituted, not left behind.
    for (const file of result.files) {
      const zip = new PizZip(file.buffer)
      for (const name of Object.keys(zip.files)) {
        if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue
        expect(zip.files[name].asText(), `${file.name} ${name}`).not.toContain('[CLIENT')
      }
    }
    const proxy = result.files.find(file => file.name.includes('health-care-proxy'))
    expect(proxy).toBeDefined()
    const proxyFooter = new PizZip(proxy!.buffer).files['word/footer1.xml']
    expect(proxyFooter).toBeDefined()
    expect(proxyFooter!.asText()).toContain('HEALTH CARE PROXY OF ')
  })
})
