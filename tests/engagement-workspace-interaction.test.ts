// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EngagementWorkspace from '@/components/engagement/EngagementWorkspace'

const replace = vi.fn()
let step = 'details'
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => ({ get: () => step }) }))

const snapshot={practiceArea:'EP',clientMode:'couple',agreementDate:'2026-07-12',primary:{name:'Primary',email:'p@example.com'},spouse:{name:'Spouse',email:'s@example.com'},legalPlan:null,fee:{amount:5000,paymentTerms:'Due now'},scopeKey:'standard',optionalClauseKeys:[],emailMessage:'',expirationHours:72}
const agreement={id:'a1',status:'draft',matter_id:'m1',active_revision:{id:'r1',render_sha256:'hash1',input_snapshot:snapshot},recipients:[]}

describe('EngagementWorkspace interactions',()=>{
  beforeEach(()=>{step='details';replace.mockClear();vi.stubGlobal('fetch',vi.fn())})
  afterEach(()=>{cleanup();vi.unstubAllGlobals()})

  it('edits structured identity and sends it in the preview request',async()=>{
    const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement}))
    const name=screen.getByLabelText('Primary name'); await user.clear(name); await user.type(name,'Edited Primary')
    cleanup(); step='review'; (fetch as any).mockResolvedValue({ok:true,json:async()=>({revision:{id:'r2'},sha256:'hash2',docxBase64:'ZA==',pdfBase64:'cA=='})}); render(React.createElement(EngagementWorkspace,{agreement:{...agreement,active_revision:{...agreement.active_revision,input_snapshot:{...snapshot,primary:{...snapshot.primary,name:'Edited Primary'}}}}}))
    await user.click(screen.getByRole('button',{name:'Generate preview'}))
    expect(JSON.parse((fetch as any).mock.calls[0][1].body).primary.name).toBe('Edited Primary')
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    await user.click(await screen.findByRole('button',{name:'Download editable DOCX'})); expect(click).toHaveBeenCalled()
    expect(screen.getByRole('button',{name:'Download signing PDF'})).toBeTruthy()
  })

  it('invalidates approval after an edit and gates send on explicit confirmation',async()=>{
    step='send'; const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement}))
    const send=screen.getByRole('button',{name:'Send for signature'}) as HTMLButtonElement
    expect(send.disabled).toBe(true); await user.click(screen.getByLabelText(/confirm this exact revision/i)); expect(send.disabled).toBe(true)
  })

  it('invalidates a granted approval after a signing-relevant edit',async()=>{
    step='review'; const user=userEvent.setup(); const fetchMock=fetch as any
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({revision:{id:'r2'},sha256:'hash2',docxBase64:'ZA==',pdfBase64:'cA=='})}).mockResolvedValueOnce({ok:true,json:async()=>({approvalToken:'approved'})})
    const view=render(React.createElement(EngagementWorkspace,{agreement})); await user.click(screen.getByRole('button',{name:'Generate preview'})); await user.click(await screen.findByRole('button',{name:'Approve revision'}))
    step='details'; view.rerender(React.createElement(EngagementWorkspace,{agreement})); const name=screen.getByLabelText('Primary name'); await user.type(name,' changed')
    step='send'; view.rerender(React.createElement(EngagementWorkspace,{agreement})); await user.click(screen.getByLabelText(/confirm this exact revision/i)); expect((screen.getByRole('button',{name:'Send for signature'}) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables signing-relevant edits after sending and preserves URL navigation',async()=>{
    const user=userEvent.setup(); render(React.createElement(EngagementWorkspace,{agreement:{...agreement,status:'sent'}}))
    expect((screen.getByLabelText('Primary name') as HTMLInputElement).disabled).toBe(true)
    await user.click(screen.getByRole('button',{name:'terms'})); expect(replace).toHaveBeenCalledWith('?step=terms')
  })
})
