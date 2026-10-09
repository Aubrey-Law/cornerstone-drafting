// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {DiscoveryWorkspace} from '@/components/discovery/DiscoveryWorkspace'
import {DISCOVERY_DEFINITION} from '@/lib/discovery/definition'
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}))
vi.mock('@/components/discovery/DiscoveryNextAction',()=>({DiscoveryNextAction:()=> <div>Prepared next action</div>}))
const leadId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',callId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const fixture=()=>({call:{id:callId,lead_id:leadId,form_version_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',status:'draft',answers:{},revision:0,summary:null,created_by:leadId,updated_by:leadId,created_at:'2026-10-09T10:00:00Z',updated_at:'2026-10-09T10:00:00Z',completed_at:null,activity_id:null},definition:DISCOVERY_DEFINITION,amendments:[],facts:{firstName:'Pat',lastName:'Test',email:'pat@example.test'},proposals:[]})
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn());window.history.replaceState({},'',`/admin/crm/opportunities/${leadId}/discovery/${callId}`)})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('discovery workspace',()=>{
 it('autosaves structured answers and preserves additional typing during a pending save',async()=>{
  let release:(value:Response)=>void=()=>{}
  const fetch=vi.mocked(global.fetch)
  fetch.mockResolvedValueOnce(Response.json(fixture()))
  fetch.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}))
  render(<DiscoveryWorkspace leadId={leadId} callId={callId}/>)
  const input=await screen.findByLabelText('First name')
  fireEvent.change(input,{target:{value:'Pat'}})
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2),{timeout:2000})
  fireEvent.change(input,{target:{value:'Patrick'}})
  expect(input).toHaveValue('Patrick')
  release(Response.json({call:{...fixture().call,revision:1,answers:{discovery_first_name:'Pat'}}}))
  fetch.mockResolvedValueOnce(Response.json({call:{...fixture().call,revision:2,answers:{discovery_first_name:'Patrick'}}}))
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3),{timeout:2500})
  expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toMatchObject({revision:1,answers:{discovery_first_name:'Patrick'}})
  expect(fetch.mock.calls.every(([url])=>String(url).includes('discovery-calls'))).toBe(true)
 })
 it('keeps local answers on a conflict and offers explicit recovery',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(fixture())).mockResolvedValueOnce(Response.json({error:'Call changed; review current values.'},{status:409}))
  render(<DiscoveryWorkspace leadId={leadId} callId={callId}/>)
  const input=await screen.findByLabelText('First name')
  fireEvent.change(input,{target:{value:'Local edit'}})
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}))
  await screen.findByText('Call changed; review current values.')
  expect(input).toHaveValue('Local edit')
  expect(screen.getByRole('button',{name:'Export unsaved answers'})).toBeEnabled()
  fireEvent.click(screen.getByRole('button',{name:'Reload current values'}))
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Keep editing'}))
  expect(input).toHaveValue('Local edit')
 })
 it('leaves all proposed factual changes unchecked after completion',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({...fixture(),call:{...fixture().call,status:'completed',answers:{discovery_first_name:'New'},completed_at:'2026-10-09T11:00:00Z',activity_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},proposals:[{field:'firstName',current:'Pat',proposed:'New'}]}))
  render(<DiscoveryWorkspace leadId={leadId} callId={callId}/>)
  expect(await screen.findByRole('checkbox',{name:'Apply First name'})).not.toBeChecked()
  expect(screen.getByRole('button',{name:'Apply selected facts'})).toBeDisabled()
  expect(screen.getByLabelText('First name')).toBeDisabled()
  expect(fetch).toHaveBeenCalledTimes(1)
 })
})
