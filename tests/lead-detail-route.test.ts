import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const source=()=>fs.readFileSync(path.join(process.cwd(),'app/api/admin/leads/[id]/route.ts'),'utf8')
describe('lead details PATCH route',()=>{
  it('authenticates, rejects unknown and converted leads',()=>{const s=source();expect(s).toContain('requireAdmin(req)');expect(s).toContain('Lead not found');expect(s).toContain('already converted')})
  it('validates and atomically creates, updates, or deletes spouse through the RPC',()=>{const s=source();expect(s).toContain('validateLeadDetails');expect(s).toContain("rpc('update_lead_details'");expect(s).toContain('p_spouse')})
  it('converts Hired idempotently and retains Lost as a lead',()=>{const s=source();expect(s).toContain("details.status === 'hired'");expect(s).toContain('createMatterFromIntake');expect(s).toContain("details.status === 'lost'")})
  it('returns the stable lead details response contract',()=>{const s=source();expect(s).toContain('{ lead:');expect(s).toContain('spouse:');expect(s).toContain('matterId')})
})
