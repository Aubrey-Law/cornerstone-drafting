import fs from 'node:fs/promises'
import path from 'node:path'
import PizZip from 'pizzip'

const templatePath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/pourover-will.docx',
)
const deterministicZipEntryDate = new Date(2000, 0, 1, 0, 0, 0)

const openingParagraphRe = /<w:p\b[^>]*w14:paraId="27A67CC2"[\s\S]*?<\/w:p>/
const openingParagraph = [
  '<w:p w14:paraId="27A67CC2" w14:textId="3C05E17C" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00065F70" w:rsidP="0057493F">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/><w:ind w:firstLine="720"/></w:pPr>',
  '<w:r><w:t>I, {{ client.full_name | name }}{% if client.aka %}, also known as {{ client.aka | name }}{% endif %}, a resident of {{ client.city }}, {{ client.county }} County, Massachusetts, revoke any prior Wills and codicils made by me and declare this to be my Last Will and Testament.</w:t></w:r>',
  '</w:p>',
].join('')
const tangiblePropertyBlockRe = /(?:<w:p\b[^>]*w14:paraId="27A67CCE"[\s\S]*?<\/w:p>|<w:p\b[^>]*w14:paraId="C0DEC010"[\s\S]*?<\/w:p>)(?:<w:p\b[^>]*w14:paraId="C0DEC011"[\s\S]*?<\/w:p>)?(?:<w:p\b[^>]*w14:paraId="C0DEC012"[\s\S]*?<\/w:p>)?/
const tangiblePropertyParagraphs = [
  '<w:p w14:paraId="C0DEC010" w14:textId="00000010" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{{ include_clause("will.tangible_personal_property") }}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC011" w14:textId="00000011" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if has_specific_gifts %}{{ include_clause("will.specific_gifts") }}{% endif %}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC012" w14:textId="00000012" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}</w:t></w:r>',
  '</w:p>',
].join('')
const bondCommonBlockRe = /<w:p\b[^>]*w14:paraId="27A67CFB"[\s\S]*?<\/w:p>(?:<w:p\b[^>]*w14:paraId="C0DEC00[1-4]"[\s\S]*?<\/w:p>)*/
const bondCommonClauseParagraphs = [
  '<w:p w14:paraId="27A67CFB" w14:textId="41D1FD52" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{{ include_clause("will.bond_supervision") }}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC001" w14:textId="00000001" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if will.no_contest_clause == "include" %}{{ include_clause("will.no_contest") }}{% endif %}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC002" w14:textId="00000002" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if will.include_disclaimer_article %}{{ include_clause("will.disclaimer") }}{% endif %}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC003" w14:textId="00000003" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if has_simultaneous_death %}{{ include_clause("will.simultaneous_death") }}{% endif %}</w:t></w:r>',
  '</w:p>',
  '<w:p w14:paraId="C0DEC004" w14:textId="00000004" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{{ include_clause("will.utma") }}</w:t></w:r>',
  '</w:p>',
].join('')
const selfProvingBlockRe = /(?:<w:p\b[^>]*w14:paraId="45AA4490"[\s\S]*?<w:p\b[^>]*w14:paraId="27A67D41"[\s\S]*?<\/w:p>|<w:p\b[^>]*w14:paraId="45AA4490"[\s\S]*?<\/w:p>)/
const selfProvingClauseParagraph = [
  '<w:p w14:paraId="45AA4490" w14:textId="00000003" w:rsidR="00CD6D99" w:rsidRPr="004E520E" w:rsidRDefault="00BE2494">',
  '<w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr>',
  '<w:r><w:t>{% if will.include_self_proving_affidavit %}{{ include_clause("execution.self_proving_affidavit", state.code) }}{% endif %}</w:t></w:r>',
  '</w:p>',
].join('')

function normalizeDocx(buffer: Buffer) {
  const inputZip = new PizZip(buffer)
  const outputZip = new PizZip()

  for (const name of Object.keys(inputZip.files).sort()) {
    const file = inputZip.files[name]

    if (file.dir) {
      outputZip.file(name, '', { dir: true, date: deterministicZipEntryDate })
      continue
    }

    let content: string | Buffer = file.asNodeBuffer()
    if (name === 'word/document.xml') {
      let xml = file.asText()
      if (!openingParagraphRe.test(xml)) {
        throw new Error('Could not find the pour-over opening paragraph')
      }
      xml = xml.replace(openingParagraphRe, openingParagraph)
      if (!tangiblePropertyBlockRe.test(xml)) {
        throw new Error('Could not find the pour-over tangible personal property paragraph')
      }
      xml = xml.replace(tangiblePropertyBlockRe, tangiblePropertyParagraphs)
      if (!bondCommonBlockRe.test(xml)) {
        throw new Error('Could not find the pour-over bond and supervision paragraph')
      }
      xml = xml.replace(bondCommonBlockRe, bondCommonClauseParagraphs)
      if (!selfProvingBlockRe.test(xml)) {
        throw new Error('Could not find the pour-over self-proving affidavit block')
      }
      content = xml.replace(selfProvingBlockRe, selfProvingClauseParagraph)
    }

    outputZip.file(name, content, { date: deterministicZipEntryDate, binary: Buffer.isBuffer(content) })
  }

  return outputZip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}

async function main() {
  await fs.writeFile(templatePath, normalizeDocx(await fs.readFile(templatePath)))
  console.log(`Updated ${templatePath}`)
}

void main()
