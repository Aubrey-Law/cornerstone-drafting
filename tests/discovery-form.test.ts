import { describe,it,expect } from 'vitest'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { DISCOVERY_DEFINITION } from '@/lib/discovery/definition'
import { answersSchema } from '@/lib/discovery/contracts'
import { proposedFacts,initialAnswers,type FactSnapshot } from '@/lib/discovery/facts'
import { readFormField,getFormField,DISCOVERY_FIELD_IDS } from '@/lib/discovery/catalog'
const clone=()=>structuredClone(DISCOVERY_DEFINITION)
describe('staff discovery form',()=>{
 it('compiles to a staff-only interview and exposes no questions to clients',()=>{
  const staff=compileIntakeForm(DISCOVERY_DEFINITION,'staff'),client=compileIntakeForm(DISCOVERY_DEFINITION,'client')
  expect(staff.success&&staff.form.sections).toHaveLength(5)
  expect(client.success&&client.form.sections).toEqual([])
 })
 it('cannot move internal questions into a shared section or client form',()=>{
  const shared=clone();shared.sections[0].audience='client_and_staff'
  expect(compileIntakeForm(shared,'client').success).toBe(false)
  const client=clone();delete client.purpose
  expect(compileIntakeForm(client,'staff').success).toBe(false)
 })
 it('rejects organizer fields and blocks in discovery forms',()=>{
  const form=clone();form.sections[0].items.push({kind:'field',id:'bad',fieldId:'client_email'})
  expect(compileIntakeForm(form,'staff').success).toBe(false)
  form.sections[0].items.pop();form.sections[0].items.push({kind:'block',id:'bad',blockId:'review_submit'})
  expect(compileIntakeForm(form,'staff').success).toBe(false)
 })
 it('cannot remove or condition required completion questions',()=>{
  const form=clone();form.sections[0].items.shift()
  expect(compileIntakeForm(form,'staff').success).toBe(false)
  const noReason=clone();noReason.sections[4].items=noReason.sections[4].items.filter(item=>item.kind!=='field'||item.fieldId!=='discovery_action_reason')
  expect(compileIntakeForm(noReason,'staff').success).toBe(false)
  const conditional=clone();conditional.sections[4].condition={op:'is_set',fieldId:'discovery_prompt'}
  expect(compileIntakeForm(conditional,'staff').success).toBe(false)
 })
 it('filters builder catalog by purpose',()=>{
  expect(getIntakeFormBuilderCatalog('discovery_call').fields.map(f=>f.id)).toEqual(DISCOVERY_FIELD_IDS)
  expect(getIntakeFormBuilderCatalog('discovery_call').blocks).toEqual([])
  expect(getIntakeFormBuilderCatalog().fields.some(f=>f.id.startsWith('discovery_'))).toBe(false)
 })
 it('evaluates required answers and conditional insurance without changing attribution',()=>{
  const compiled=compileIntakeForm(DISCOVERY_DEFINITION,'staff');if(!compiled.success)throw Error('compile')
  const empty=evaluateCompiledIntakeForm(compiled.form,{})
  expect(empty.submissionErrors).toHaveLength(3)
  const data={discovery_call_at:'2026-10-09T10:00',discovery_outcome:'proceed',discovery_next_action:'send_organizer',discovery_insurance:'metlife'}
  expect(evaluateCompiledIntakeForm(compiled.form,data).submissionErrors).toEqual([])
  const changes:Record<string,unknown>={source:'referral'}
  getFormField('discovery_insurance').write('metlife',(field,value)=>{changes[field]=value})
  expect(changes).toEqual({source:'referral',discovery_insurance:'metlife'})
 })
 it('round trips arrays, unknown, blank, and explicit clears using only discovery keys',()=>{
  const values={discovery_minor_children:'unknown',discovery_prompt:'',discovery_household:null,discovery_assets:['real_estate']}
  for(const [id,value] of Object.entries(values)){
   const output:Record<string,unknown>={};getFormField(id).write(value,(key,v)=>{output[key]=v})
   expect(readFormField(id,JSON.parse(JSON.stringify(output)))).toEqual(value)
  }
 })
 it.each(['abc','-20','NaN','Infinity','1.2.3'])('rejects malformed amount %s',value=>expect(answersSchema.safeParse({discovery_estimate:value}).success).toBe(false))
 it('accepts a formatted amount without losing the supplied value',()=>expect(answersSchema.parse({discovery_estimate:'$1,250.50'}).discovery_estimate).toBe('$1,250.50'))
 it('rejects unrelated answer keys',()=>expect(answersSchema.safeParse({internal_notes:'wrong store'}).success).toBe(false))
})
describe('reviewed factual handoff',()=>{
 const current:FactSnapshot={firstName:'Pat',lastName:'Smith',email:'pat@example.com',phone:null,address:{addressLine1:'1 Main',addressLine2:null,city:'Boston',state:'MA',zip:'02110',county:'Suffolk'},spouse:null,maritalStatus:null,hasMinorChildren:null}
 it('does not propose untouched fields or screening data',()=>expect(proposedFacts({discovery_internal_notes:'Private',discovery_estimate:'1000000'},current)).toEqual([]))
 it('keeps explicit clearing distinct from an absent answer',()=>{
  expect(proposedFacts({discovery_phone:''},{...current,phone:'555'})).toEqual([{field:'phone',current:'555',proposed:null}])
  expect(proposedFacts({},current)).toEqual([])
 })
 it('preserves other address facts and proposes a whole reviewed address',()=>{
  const result=proposedFacts({discovery_city:'Cambridge'},current)
  expect(result[0].proposed).toEqual({...current.address as object,city:'Cambridge'})
 })
 it('prefills existing facts without inventing no answers',()=>{
  const initial=initialAnswers(current)
  expect(initial.discovery_first_name).toBe('Pat')
  expect(initial).not.toHaveProperty('discovery_minor_children')
  expect(initial).not.toHaveProperty('discovery_spouse_first_name')
 })
})
