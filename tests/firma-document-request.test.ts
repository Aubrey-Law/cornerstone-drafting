import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@firma-dev/sdk', () => ({ FirmaClient: class {} }))
import { createFirmaEsignProvider } from '@/lib/esign/firma'

describe('Firma document requests', () => {
  it('sends PDF bytes with ordered temporary recipients and anchor mappings', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'request-1',
      recipients: [
        { id: 'firma-1', temporary_id: 'primary', signing_link: 'https://sign/1' },
        { id: 'firma-2', temporary_id: 'spouse', signing_link: null },
      ],
    }), { status: 200 }))
    const provider = createFirmaEsignProvider({ apiKey: 'key', singleTemplateId: 'legacy', jointTemplateId: null, fetcher })
    const pdf = Buffer.from('%PDF-1.7 rendered')

    const result = await provider.createDocumentRequest({
      name: 'Agreement', document: pdf,
      recipients: [
        { key: 'primary', name: 'Ada Lovelace', email: 'ada@example.com', order: 1 },
        { key: 'spouse', name: 'Grace Hopper', email: 'grace@example.com', order: 2 },
      ],
      anchors: [
        { marker: '[[CLIENT_1_SIGNATURE]]', type: 'signature', recipientKey: 'primary', required: true },
        { marker: '[[CLIENT_2_DATE]]', type: 'date', recipientKey: 'spouse', required: true, dateSigningDefault: true },
      ],
      expirationHours: 72, customMessage: 'Please sign.',
    })

    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.document).toBe(pdf.toString('base64'))
    expect(body).not.toHaveProperty('template_id')
    expect(body.recipients.map((r: { id: string; order: number }) => [r.id, r.order])).toEqual([['primary', 1], ['spouse', 2]])
    expect(body.anchor_tags.map((a: { recipient_id: string }) => a.recipient_id)).toEqual(['primary', 'spouse'])
    expect(result).toEqual({ requestId: 'request-1', recipients: [
      { key: 'primary', externalId: 'firma-1', signingLink: 'https://sign/1' },
      { key: 'spouse', externalId: 'firma-2', signingLink: null },
    ] })
  })

  it('fails closed when Firma omits stable recipient correlation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'request-1', recipients: [{ id: 'firma-1' }] }), { status: 200 }))
    const provider = createFirmaEsignProvider({ apiKey: 'key', singleTemplateId: 'legacy', jointTemplateId: null, fetcher })
    await expect(provider.createDocumentRequest({
      name: 'Agreement', document: Buffer.from('%PDF'), recipients: [{ key: 'primary', name: 'Ada', email: 'a@example.com', order: 1 }],
      anchors: [{ marker: '[[CLIENT_1_SIGNATURE]]', type: 'signature', recipientKey: 'primary', required: true }], expirationHours: 72, customMessage: 'Sign',
    })).rejects.toThrow(/correlate recipient primary/i)
  })
})
