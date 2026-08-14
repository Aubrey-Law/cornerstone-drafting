import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { XMLValidator } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'

/**
 * Every XML part of every template has to be well-formed, and every namespace
 * prefix it uses has to be declared.
 *
 * The five College Preparation Plan templates shipped with
 * `<w:footerReference r:id="rId7"/>` in the body and only `xmlns:w` on the root
 * element. Nothing in the pipeline complained: docxtemplater's XML handling is
 * lenient, so the render tests passed and produced documents that could not be
 * opened — "Namespace prefix r for id on footerReference is not defined" from
 * the browser's strict parser, and a repair prompt from Word.
 *
 * Neither `fast-xml-parser`'s validator nor `@xmldom/xmldom` reports an unbound
 * prefix, so the binding check below is written out by hand. That is the whole
 * reason this file exists: the defect is invisible to every tool the repo
 * already had, right up until someone tries to open the document.
 */

const TEMPLATES_DIR = path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates')

/** Prefixes bound by the XML spec itself, never declared in the document. */
const BUILT_IN_PREFIXES = new Set(['xml', 'xmlns'])

function templateFiles(): string[] {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter(name => name.endsWith('.docx'))
    .sort()
}

/**
 * Prefixes used in element and attribute names: `<w:body>`, `</w:body>` and
 * ` r:id="…"`. Deliberately crude — it reads the raw text rather than a parse
 * tree, because a parse tree is exactly what a document like this cannot
 * produce.
 */
function usedPrefixes(xml: string): Set<string> {
  const used = new Set<string>()
  for (const [, prefix] of xml.matchAll(/<\/?([a-zA-Z][\w.-]*):[a-zA-Z]/g)) used.add(prefix)
  for (const [, prefix] of xml.matchAll(/\s([a-zA-Z][\w.-]*):[a-zA-Z][\w.-]*\s*=\s*["']/g)) {
    used.add(prefix)
  }
  for (const builtIn of BUILT_IN_PREFIXES) used.delete(builtIn)
  return used
}

/**
 * Every prefix declared anywhere in the part, ignoring element scope. A prefix
 * declared on one element and used outside it would slip through, which no Word
 * document does in practice; a prefix declared nowhere — the defect this exists
 * for — cannot.
 */
function declaredPrefixes(xml: string): Set<string> {
  return new Set(Array.from(xml.matchAll(/xmlns:([a-zA-Z][\w.-]*)\s*=/g), match => match[1]))
}

describe('document templates are openable XML', () => {
  const templates = templateFiles()

  it('finds the templates to check', () => {
    expect(templates.length).toBeGreaterThan(30)
  })

  for (const template of templates) {
    describe(template, () => {
      const zip = new PizZip(fs.readFileSync(path.join(TEMPLATES_DIR, template)))
      const parts = Object.keys(zip.files).filter(name => name.endsWith('.xml'))

      it('is well-formed in every part', () => {
        expect(parts.length).toBeGreaterThan(0)
        for (const part of parts) {
          const result = XMLValidator.validate(zip.files[part].asText())
          expect(result === true ? null : `${part}: ${result.err.msg}`).toBeNull()
        }
      })

      it('declares every namespace prefix it uses', () => {
        for (const part of parts) {
          const xml = zip.files[part].asText()
          const undeclared = [...usedPrefixes(xml)].filter(
            prefix => !declaredPrefixes(xml).has(prefix),
          )
          expect(undeclared.length === 0 ? null : `${part}: ${undeclared.join(', ')}`).toBeNull()
        }
      })
    })
  }
})

describe('rendered college documents are openable too', () => {
  // The templates are the source of this defect, but the rendered file is what
  // the attorney actually opens — and docxtemplater will happily substitute
  // into malformed XML and hand back something equally malformed.
  const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')
  const example = JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-college-prep.json'), 'utf8'),
  ) as Record<string, unknown>

  const PACKAGES = [
    'college-financial-poa',
    'college-education-poa',
    'college-health-care-documents',
    'college-advance-directive',
  ] as const

  for (const packageName of PACKAGES) {
    it(`renders ${packageName} as XML that parses`, async () => {
      const { generateNodeEstatePackage } = await import('@/lib/estateGenerator/node/generate')
      const result = await generateNodeEstatePackage({
        data: example as never,
        packageName,
        state: 'MA',
        root,
        allowDraft: true,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.files.length).toBeGreaterThan(0)
      for (const file of result.files) {
        const xml = new PizZip(file.buffer).files['word/document.xml'].asText()
        const validity = XMLValidator.validate(xml)
        expect(validity === true ? null : `${file.name}: ${(validity as { err: { msg: string } }).err.msg}`)
          .toBeNull()

        const undeclared = [...usedPrefixes(xml)].filter(
          prefix => !declaredPrefixes(xml).has(prefix),
        )
        expect(undeclared.length === 0 ? null : `${file.name}: ${undeclared.join(', ')}`).toBeNull()
      }
    })
  }
})

describe('the check itself', () => {
  // A guard nobody can see failing is a guard nobody can trust. This is the
  // shape of the document that shipped.
  const broken =
    '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body>' +
    '<w:footerReference w:type="default" r:id="rId7"/></w:body></w:document>'

  it('catches an undeclared prefix', () => {
    expect([...usedPrefixes(broken)].filter(p => !declaredPrefixes(broken).has(p))).toEqual(['r'])
  })

  it('passes the same document once the prefix is declared', () => {
    const fixed = broken.replace('<w:document', '<w:document xmlns:r="urn:r"')
    expect([...usedPrefixes(fixed)].filter(p => !declaredPrefixes(fixed).has(p))).toEqual([])
  })

  it('does not mistake xml: or a colon in text for a prefix', () => {
    // `xml:` needs no declaration, and "Dated:" is prose, not a namespace.
    const text = '<w:p xmlns:w="urn:w"><w:t xml:space="preserve">Dated: the 1st day</w:t></w:p>'
    expect([...usedPrefixes(text)].filter(p => !declaredPrefixes(text).has(p))).toEqual([])
  })
})
