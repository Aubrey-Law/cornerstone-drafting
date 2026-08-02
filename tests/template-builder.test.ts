import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { applyDocxReplacements, extractDocxParagraphText } from '@/lib/templateBuilder/docxEdit'
import { extractTemplateVariables } from '@/lib/estateGenerator/templateVariables'
import { readBundledSystemSkill } from '@/lib/works/systemSkills'

const realTemplate = fs.readFileSync(
  path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates/certificate-of-trust.docx'),
)

/** Minimal zip with one document part — enough for the word/*.xml processors. */
function syntheticDocx(documentXml: string): Buffer {
  const zip = new PizZip()
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentXml}</w:body></w:document>`)
  return Buffer.from(zip.generate({ type: 'uint8array' }))
}

describe('applyDocxReplacements', () => {
  it('replaces contiguous text directly and reports counts', () => {
    const result = applyDocxReplacements(realTemplate, [
      { find: '{{ client.full_name | name }}', replace: 'JOHN Q. SAMPLE' },
    ])
    expect(result.results[0].method).toBe('direct')
    expect(result.results[0].count).toBeGreaterThan(0)
    expect(extractDocxParagraphText(result.buffer)).toContain('JOHN Q. SAMPLE')
    // Round-trip restores the merge field.
    const back = applyDocxReplacements(result.buffer, [
      { find: 'JOHN Q. SAMPLE', replace: '{{ client.full_name | name }}' },
    ])
    expect(extractTemplateVariables(back.buffer).variables).toContain('client.full_name')
  })

  it('falls back to paragraph joining when Word split the text across runs', () => {
    const docx = syntheticDocx(
      '<w:p><w:r><w:t>Client: [CLI</w:t></w:r><w:r><w:t>ENT NA</w:t></w:r><w:r><w:t>ME] appeared.</w:t></w:r></w:p>',
    )
    const result = applyDocxReplacements(docx, [
      { find: '[CLIENT NAME]', replace: '{{ client.full_name | name }}' },
    ])
    expect(result.results[0].method).toBe('paragraph')
    expect(result.results[0].count).toBe(1)
    expect(extractDocxParagraphText(result.buffer)).toBe('Client: {{ client.full_name | name }} appeared.')
  })

  it('reports not_found instead of silently dropping a replacement', () => {
    const result = applyDocxReplacements(realTemplate, [
      { find: 'TEXT THAT DOES NOT EXIST ANYWHERE', replace: 'x' },
    ])
    expect(result.results[0].method).toBe('not_found')
    expect(result.notFound).toBe(1)
  })

  it('escapes XML special characters in find and replace text', () => {
    const docx = syntheticDocx('<w:p><w:r><w:t>Smith &amp; Jones LLP</w:t></w:r></w:p>')
    const result = applyDocxReplacements(docx, [
      { find: 'Smith & Jones LLP', replace: '{{ extras.firm_name }}' },
    ])
    expect(result.results[0].count).toBe(1)
    expect(extractDocxParagraphText(result.buffer)).toBe('{{ extras.firm_name }}')
  })
})

describe('extractDocxParagraphText', () => {
  it('returns readable paragraph text from a real template', () => {
    const text = extractDocxParagraphText(realTemplate)
    expect(text.length).toBeGreaterThan(200)
    expect(text).toContain('{{')
  })
})

describe('template-builder skill and wiring', () => {
  it('bundles a valid system skill (frontmatter type and slug check)', () => {
    const skill = readBundledSystemSkill('assistant', 'template-builder')
    expect(skill.parsed.metadata.name).toBe('Template Builder')
    expect(skill.parsed.metadata.execution_mode).toBe('chat')
  })

  it('registers the tools and system note in the assistant messages route', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/assistant/chats/[chatId]/messages/route.ts'),
      'utf8',
    )
    expect(routeSource).toContain('templateBuilderToolExecutors(auth.userId)')
    expect(routeSource).toContain('templateBuilderSystemPromptNote()')
  })

  it('keeps register/stage behind explicit attorney confirmation in tool + skill instructions', () => {
    const toolsSource = fs.readFileSync(path.join(process.cwd(), 'lib/templateBuilder/assistantTools.ts'), 'utf8')
    const skillSource = fs.readFileSync(
      path.join(process.cwd(), 'tools/workflows/system/assistant/template-builder/SKILL.md'),
      'utf8',
    )
    expect(toolsSource).toContain('Only call after the attorney explicitly confirms')
    expect(skillSource).toContain('Never register or stage without the attorney explicitly saying to')
    // Publishing a master stays manual — the tool only stages.
    expect(toolsSource).toContain('publishing cannot be done by this tool')
    expect(toolsSource).not.toContain('publish_document_template_version')
  })

  it('upload routes are admin-guarded', () => {
    for (const file of ['app/api/admin/template-builder/uploads/route.ts', 'app/api/admin/template-builder/uploads/[id]/route.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source).toContain("import { requireAdmin } from '@/lib/apiAuth'")
    }
  })
})
