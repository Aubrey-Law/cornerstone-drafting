/**
 * One-off script: creates starter deed / trustee's certificate / real estate trust
 * templates with docxtemplater placeholders. Replace with firm templates when ready.
 */
import fs from 'node:fs'
import path from 'node:path'
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'

const templatesDir = path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates')

function p(text: string, opts?: { bold?: boolean; center?: boolean }) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Times New Roman', size: 24, bold: opts?.bold })],
    spacing: { after: 120 },
    alignment: opts?.center ? AlignmentType.CENTER : undefined,
  })
}

async function writeTemplate(filename: string, doc: Document) {
  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(path.join(templatesDir, filename), buffer)
  console.log('Wrote', filename)
}

async function main() {
  fs.mkdirSync(templatesDir, { recursive: true })

  await writeTemplate('deed.docx', new Document({
    sections: [{
      children: [
        p('QUITCLAIM DEED', { bold: true, center: true }),
        p('COMMONWEALTH OF MASSACHUSETTS'),
        p('{registry_district} REGISTRY OF DEEDS'),
        p(''),
        p('For consideration of {consideration}, {grantor}, Grantor, hereby quitclaims unto {grantee}, Grantee, the following described real property:'),
        p(''),
        p('Property address: {property_address}, {property_city}, {property_state}'),
        p('County: {property_county}'),
        p('Parcel ID: {parcel_id}'),
        p(''),
        p('LEGAL DESCRIPTION:', { bold: true }),
        p('{legal_description}'),
        p(''),
        p('Prior deed recorded in Book {prior_deed_book}, Page {prior_deed_page}.'),
        p(''),
        p('Trust: {trust_name}, dated {trust_date}.'),
        p(''),
        p('Dated: {execution_date}'),
      ],
    }],
  }))

  await writeTemplate('trustees-certificate.docx', new Document({
    sections: [{
      children: [
        p("TRUSTEE'S CERTIFICATE", { bold: true, center: true }),
        p('Pursuant to M.G.L. c. 184, § 35'),
        p(''),
        p('The undersigned, {trustees}, as Trustee(s) of {trust_name}, dated {trust_date}, hereby certifies:'),
        p(''),
        p('1. The trust is in existence and has not been revoked or amended in any manner that would cause the representations in this certificate to be incorrect.'),
        p('2. The trust is a revocable trust and {settlor} is the settlor and may revoke the trust at any time.'),
        p('3. The Trustee(s) have full power and authority to hold, manage, and convey real property held in the trust.'),
        p(''),
        p('The following real property is held in the trust:'),
        p('{property_address}, {property_city}, {property_state}'),
        p('County: {property_county}'),
        p('Parcel ID: {parcel_id}'),
        p(''),
        p('{legal_description}'),
        p(''),
        p('Recorded reference: Book {prior_deed_book}, Page {prior_deed_page}, {registry_district} Registry of Deeds.'),
        p(''),
        p('Executed on {execution_date} in {certificate_execution_county} County, Massachusetts.'),
      ],
    }],
  }))

  await writeTemplate('real-estate-trust.docx', new Document({
    sections: [{
      children: [
        p('REAL ESTATE TRUST SCHEDULE', { bold: true, center: true }),
        p(''),
        p('Trust: {trust_name}'),
        p('Dated: {trust_date}'),
        p('Settlor: {settlor}'),
        p('Trustee(s): {trustees}'),
        p(''),
        p('The following real property is held in or transferred to the trust:'),
        p(''),
        p('Address: {property_address}, {property_city}, {property_state}'),
        p('County: {property_county}'),
        p('Parcel / Map-Lot: {parcel_id}'),
        p(''),
        p('Legal description:'),
        p('{legal_description}'),
        p(''),
        p('Grantor on deed: {grantor}'),
        p('Grantee on deed: {grantee}'),
        p('Consideration: {consideration}'),
        p(''),
        p('Prior recording: Book {prior_deed_book}, Page {prior_deed_page}, {registry_district} Registry of Deeds.'),
        p(''),
        p('Schedule date: {execution_date}'),
      ],
    }],
  }))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
