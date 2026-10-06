// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EngagementWorkspace from '@/components/engagement/EngagementWorkspace'
import type { EngagementInput } from '@/lib/engagement/types'

const replace = vi.fn()
const refresh = vi.fn()
let step = 'design'
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }), useSearchParams: () => new URLSearchParams({ step }) }))
vi.mock('@/lib/documents', () => ({ getDocumentUrl: vi.fn(async () => 'https://r2.example/engagement.docx') }))

const snapshot: EngagementInput={practiceArea:'EP',clientMode:'couple',agreementDate:'2026-07-12',primary:{name:'Primary',email:'p@example.com'},spouse:{name:'Spouse',email:'s@example.com'},decedentName:null,legalPlan:null,fee:{amount:5000,paymentTerms:'Due now'},scopeKey:'standard',optionalClauseKeys:[],emailMessage:'',expirationHours:72}
const agreement: React.ComponentProps<typeof EngagementWorkspace>['agreement']={id:'a1',status:'draft',matter_id:'m1',active_revision:{id:'r1',render_sha256:'hash1',input_snapshot:snapshot},recipients:[]}

describe('EngagementWorkspace interactions',()=>{
  beforeEach(()=>{
    step='design';replace.mockClear();refresh.mockClear();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({clauses:[]})}))
    vi.stubGlobal('URL', { createObjectURL: vi.fn(()=>'blob:preview'), revokeObjectURL: vi.fn() })
  })
  afterEach(()=>{cleanup();vi.unstubAllGlobals()})

  it('edits structured identity and sends it in the preview request',async()=>{
    const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement}))
    const name=screen.getByLabelText('Primary name'); await user.clear(name); await user.type(name,'Edited Primary')
    cleanup(); step='generate'; vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({revision:{id:'r2'},sha256:'hash2',docxBase64:'ZA==',pdfBase64:'cA=='})} as Response); render(React.createElement(EngagementWorkspace,{agreement:{...agreement,active_revision:{...agreement.active_revision,input_snapshot:{...snapshot,primary:{...snapshot.primary,name:'Edited Primary'}}}}}))
    await user.click(screen.getByRole('button',{name:'Generate agreement'}))
    const previewCall=vi.mocked(fetch).mock.calls.find(([,init])=>typeof init?.body==='string')
    const previewBody=previewCall?.[1]?.body
    expect(typeof previewBody).toBe('string')
    expect(JSON.parse(previewBody as string).primary.name).toBe('Edited Primary')
    expect(replace).toHaveBeenCalledWith('?step=review')
    step='review'; cleanup(); render(React.createElement(EngagementWorkspace,{agreement:{...agreement,active_revision:{...agreement.active_revision,render_sha256:'hash2',render_snapshot:{docxBase64:'ZA==',pdfBase64:'cA=='}}}}))
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    await user.click(await screen.findByRole('button',{name:'Download DOCX'})); expect(click).toHaveBeenCalled()
    expect(screen.getByRole('button',{name:'Download signing PDF'})).toBeTruthy()
    expect(screen.getByTitle('Engagement agreement PDF preview').getAttribute('src')).toBe('blob:preview')
  })

  it('invalidates approval after an edit and gates send on explicit confirmation',async()=>{
    step='review'; const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement}))
    const send=screen.getByRole('button',{name:'Send for signature'}) as HTMLButtonElement
    expect(send.disabled).toBe(true); await user.click(screen.getByLabelText(/confirm this exact revision/i)); expect(send.disabled).toBe(true)
  })

  it('invalidates a granted approval after a signing-relevant edit',async()=>{
    step='generate'; const user=userEvent.setup(); const fetchMock=vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({revision:{id:'r2'},sha256:'hash2',docxBase64:'ZA==',pdfBase64:'cA=='})} as Response).mockResolvedValueOnce({ok:true,json:async()=>({approvalToken:'approved'})} as Response)
    const view=render(React.createElement(EngagementWorkspace,{agreement})); await user.click(screen.getByRole('button',{name:'Generate agreement'}))
    step='review'; view.rerender(React.createElement(EngagementWorkspace,{agreement})); await user.click(await screen.findByRole('button',{name:'Approve revision'}))
    step='design'; view.rerender(React.createElement(EngagementWorkspace,{agreement})); const name=screen.getByLabelText('Primary name'); await user.type(name,' changed')
    step='review'; view.rerender(React.createElement(EngagementWorkspace,{agreement})); await user.click(screen.getByLabelText(/confirm this exact revision/i)); expect((screen.getByRole('button',{name:'Send for signature'}) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the editable Word document and rebuilds the signing PDF from its edits',async()=>{
    step='review'; const user=userEvent.setup(); const fetchMock=vi.mocked(fetch)
    const rendered={...agreement,document_id:'doc1',active_revision:{...agreement.active_revision,render_snapshot:{docxBase64:'ZA==',pdfBase64:'cA==',documentVersionId:'v1'}}}
    // The current version is the one the signing PDF was built from: nothing pending.
    const view=render(React.createElement(EngagementWorkspace,{agreement:rendered,editableDocument:{documentId:'doc1',name:'Engagement Agreement.docx',currentVersionId:'v1'}}))
    expect(screen.getByRole('button',{name:'Review in app'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'Download for Word'})).toBeTruthy()
    expect(screen.queryByRole('button',{name:'Download DOCX'})).toBeNull()
    expect(screen.queryByRole('button',{name:'Use edited document'})).toBeNull()
    // Edited in Word since: the workspace offers to build the next revision from it.
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({revision:{id:'r3'},sha256:'hash3',docxBase64:'ZQ==',pdfBase64:'cQ==',documentVersionId:'v2'})} as Response)
    view.rerender(React.createElement(EngagementWorkspace,{agreement:rendered,editableDocument:{documentId:'doc1',name:'Engagement Agreement.docx',currentVersionId:'v2'}}))
    await user.click(screen.getByRole('button',{name:'Use edited document'}))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/engagement-agreements/a1/from-document',{method:'POST'})
    expect(await screen.findByText(/rebuilt from the edited Word document/)).toBeTruthy()
    expect(screen.getByText(/Revision r3/)).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it('asks before regenerating from the form over unapplied Word edits',async()=>{
    step='generate'; const user=userEvent.setup(); const fetchMock=vi.mocked(fetch)
    const rendered={...agreement,document_id:'doc1',active_revision:{...agreement.active_revision,render_snapshot:{docxBase64:'ZA==',pdfBase64:'cA==',documentVersionId:'v1'}}}
    render(React.createElement(EngagementWorkspace,{agreement:rendered,editableDocument:{documentId:'doc1',name:'Engagement Agreement.docx',currentVersionId:'v2'}}))
    fetchMock.mockClear()
    await user.click(screen.getByRole('button',{name:/Generate agreement|Regenerate/}))
    expect(await screen.findByText('Replace the Word edits?')).toBeTruthy()
    await user.click(screen.getByRole('button',{name:'Cancel'}))
    expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/preview'))).toBe(false)
  })

  it('records an agreement sent outside the app on the matter',async()=>{
    step='review'; const user=userEvent.setup(); const fetchMock=vi.mocked(fetch)
    render(React.createElement(EngagementWorkspace,{agreement,recordedEngagement:{sentAt:null,signed:false}}))
    fetchMock.mockClear(); fetchMock.mockResolvedValue({ok:true,json:async()=>({row:{}})} as Response)
    await user.click(screen.getByLabelText('Already sent to the client outside the app'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/matter-details',expect.objectContaining({method:'PATCH'}))
    const body=JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({matterId:'m1',field:'engagement_status',value:'sent'})
    expect(await screen.findByText('Recorded as sent outside the app.')).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it('hides the outside-the-app control once the engagement is signed or the app has sent it',()=>{
    step='review'
    const view=render(React.createElement(EngagementWorkspace,{agreement,recordedEngagement:{sentAt:'2026-10-01T00:00:00Z',signed:true}}))
    expect(screen.queryByLabelText('Already sent to the client outside the app')).toBeNull()
    view.rerender(React.createElement(EngagementWorkspace,{agreement:{...agreement,status:'sent'},recordedEngagement:{sentAt:null,signed:false}}))
    expect(screen.queryByLabelText('Already sent to the client outside the app')).toBeNull()
  })

  it('disables signing-relevant edits after sending and preserves URL navigation',async()=>{
    const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement:{...agreement,status:'sent'}}))
    expect((screen.getByLabelText('Primary name') as HTMLInputElement).disabled).toBe(true)
    await user.click(screen.getByRole('button',{name:'Continue to Generate'})); expect(replace).toHaveBeenCalledWith('?step=generate')
  })
})
