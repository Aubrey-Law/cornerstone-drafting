import fs from 'node:fs/promises'

const apiKey = process.env.FIRMA_API_KEY
const docxPath = process.env.FIRMA_POC_DOCX
const recipientEmail = process.env.FIRMA_POC_RECIPIENT_EMAIL
const workspace = process.env.FIRMA_POC_WORKSPACE

if (!apiKey || !docxPath || !recipientEmail || !workspace) {
  throw new Error('Missing POC environment: FIRMA_API_KEY, FIRMA_POC_DOCX, FIRMA_POC_RECIPIENT_EMAIL, and FIRMA_POC_WORKSPACE are required')
}
if (workspace.toLowerCase() === 'production' || workspace.toLowerCase() === 'prod') {
  throw new Error('Refusing production Firma execution')
}
if (!recipientEmail.endsWith('@example.com') && process.env.FIRMA_POC_ALLOW_REAL !== 'true') {
  throw new Error('Refusing a real recipient without FIRMA_POC_ALLOW_REAL=true')
}
if (process.env.FIRMA_POC_SEND === 'true') {
  throw new Error('FIRMA_POC_SEND is not enabled until the Firma send endpoint is verified in a test workspace')
}

const document = (await fs.readFile(docxPath)).toString('base64')
const response = await fetch(
  'https://api.firma.dev/functions/v1/signing-request-api/signing-requests',
  {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cornerstone engagement POC',
      document,
      recipients: [{ id: 'temp_1', first_name: 'Test', last_name: 'Client', email: recipientEmail, designation: 'Signer', order: 1 }],
      anchor_tags: [
        { anchor_string: '[[CLIENT_1_SIGNATURE]]', type: 'signature', recipient_id: 'temp_1', width: 25, height: 5, remove_anchor_text: true },
        { anchor_string: '[[CLIENT_1_DATE]]', type: 'date', recipient_id: 'temp_1', width: 18, height: 4, remove_anchor_text: true },
      ],
    }),
  },
)
const body = await response.json()
if (!response.ok) throw new Error(JSON.stringify(body))
console.log(JSON.stringify({ id: body.id, recipients: body.recipients, status: body.status }, null, 2))
