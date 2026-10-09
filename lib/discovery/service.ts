import 'server-only'
import { z } from 'zod'
import type { Json } from '@aubrey-law/db-types'
import { getTemplateRowByKey, listVersionRows, getVersionRow, getTemplateRow } from '@/lib/intake/forms/repository'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import { validateLeadFieldPatch } from '@/lib/leads/details'
import { discoveryDb } from './database'
import { DISCOVERY_TEMPLATE_KEY } from './definition'
import { getFormField, isDiscoveryField, discoveryFieldError } from './catalog'
import { storedAnswersSchema, callSchema, amendmentRowSchema, type DiscoveryCall } from './contracts'
import { FACT_FIELDS, initialAnswers, proposedFacts, type FactSnapshot } from './facts'

export class DiscoveryError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
function dbError(error: { code?: string; message: string }): never {
  if (error.code === '40001') throw new DiscoveryError('This record changed. Your edits are preserved; reload and review the current values.',409)
  if (error.code === 'P0002') throw new DiscoveryError('Discovery call or lead not found.',404)
  if (error.code === '22023') throw new DiscoveryError('Check the discovery answers and try again.',422)
  throw new DiscoveryError('Discovery calls are temporarily unavailable.',503)
}
export async function availableTemplate() {
  const template = await getTemplateRowByKey(DISCOVERY_TEMPLATE_KEY)
  if (!template || template.archived_at || template.purpose !== 'discovery_call') return null
  const version = (await listVersionRows(template.id)).filter(v => v.status === 'published').sort((a,b) => b.version-a.version)[0]
  if (!version || version.definition.purpose !== 'discovery_call') return null
  const compiled = compileIntakeForm(version.definition,'staff')
  return compiled.success ? version : null
}
export async function listCalls(leadId: string) {
  const { data, error } = await discoveryDb().from('discovery_calls').select('*').eq('lead_id',leadId).order('created_at',{ ascending:false })
  if (error) dbError(error)
  return z.array(callSchema).parse(data)
}
export async function getCall(leadId: string, callId: string) {
  const { data, error } = await discoveryDb().from('discovery_calls').select('*').eq('lead_id',leadId).eq('id',callId).maybeSingle()
  if (error) dbError(error)
  if (!data) throw new DiscoveryError('Discovery call not found.',404)
  return callSchema.parse(data)
}
export async function currentFacts(leadId: string): Promise<FactSnapshot> {
  const { data, error } = await discoveryDb().rpc('discovery_fact_snapshot',{ p_lead_id:leadId })
  if (error) dbError(error)
  if (!data) throw new DiscoveryError('Lead not found.',404)
  return z.object(Object.fromEntries(FACT_FIELDS.map(field => [field,z.unknown()]))).parse(data) as FactSnapshot
}
export async function callDetail(leadId: string, callId: string) {
  const call = await getCall(leadId,callId)
  const version = await getVersionRow(call.form_version_id)
  const template = version ? await getTemplateRow(version.template_id) : null
  if (!version || !template || template.purpose !== 'discovery_call' || version.definition.purpose !== 'discovery_call' || !['published','retired'].includes(version.status)) throw new DiscoveryError('Pinned discovery form is unavailable.',503)
  const compiled = compileIntakeForm(version.definition,'staff')
  if (!compiled.success) throw new DiscoveryError('Pinned discovery form is unavailable.',503)
  const { data, error } = await discoveryDb().from('discovery_call_amendments').select('*').eq('call_id',callId).order('created_at')
  if (error) dbError(error)
  const amendments = z.array(amendmentRowSchema).parse(data)
  const actorIds = [...new Set([call.created_by,call.updated_by,...amendments.map(a=>a.actor_id)])]
  const [facts,actors] = await Promise.all([currentFacts(leadId), discoveryDb().from('users').select('id,display_name,email').in('id',actorIds)])
  const actorNames = Object.fromEntries((actors.data ?? []).map(actor=>[actor.id,actor.display_name?.trim() || actor.email?.trim() || 'Staff member']))
  return { actorNames, call, definition:version.definition, amendments, facts, proposals:call.status === 'completed' ? proposedFacts(call.answers,facts) : [] }
}
export async function startCall(leadId: string, actorId: string) {
  const existing = (await listCalls(leadId)).find(call => call.status === 'draft')
  if (existing) return existing
  const version = await availableTemplate()
  if (!version) throw new DiscoveryError('Publish the internal discovery template before starting calls.',503)
  const { data, error } = await discoveryDb().rpc('discovery_call_write',{ p_lead_id:leadId,p_actor_id:actorId,p_operation:'start',p_version_id:version.id,p_answers:initialAnswers(await currentFacts(leadId)) as Json })
  if (error) dbError(error)
  return callSchema.parse(data)
}
export async function saveCall(leadId: string, callId: string, actorId: string, revision: number, raw: unknown, complete: boolean): Promise<DiscoveryCall> {
  const detail = await callDetail(leadId,callId)
  if (complete && detail.call.status === 'completed') return detail.call
  const answers = storedAnswersSchema.parse(raw)
  for (const [id,value] of Object.entries(answers)) {
    if (!isDiscoveryField(id)) throw new DiscoveryError('Unknown discovery question.',422)
    if (JSON.stringify(value) === JSON.stringify(detail.call.answers[id])) continue
    const message=discoveryFieldError(id,value)
    if(message)throw new DiscoveryError(`${getFormField(id).label}: ${message}`,422)
  }
  const compiled = compileIntakeForm(detail.definition,'staff')
  if (!compiled.success) throw new DiscoveryError('Pinned discovery form is unavailable.',503)
  if (complete) {
    const evaluation = evaluateCompiledIntakeForm(compiled.form,answers)
    const errors = evaluation.issues.filter(issue => issue.severity === 'error')
    if (answers.discovery_next_action === 'no_further_action' && !String(answers.discovery_action_reason ?? '').trim()) throw new DiscoveryError('Give a reason for no further action.',422)
    if (errors.length) throw new DiscoveryError(errors.map(e => e.message).join(' '),422)
  }
  const summary = compiled.form.sections.flatMap(section => section.items.flatMap(item => {
    if (item.kind !== 'field') return []
    const value = answers[item.fieldId]
    return value === undefined || value === null || value === '' ? [] : [`${item.label}: ${Array.isArray(value) ? value.map(v => getFormField(item.fieldId).options?.find(o => o.value === v)?.label ?? v).join('; ') : getFormField(item.fieldId).options?.find(o => o.value === value)?.label ?? value}`]
  })).join('\n')
  const { data,error } = await discoveryDb().rpc('discovery_call_write',{ p_lead_id:leadId,p_call_id:callId,p_actor_id:actorId,p_operation:complete?'complete':'save',p_revision:revision,p_answers:answers as Json,p_summary:summary })
  if (error) dbError(error)
  return callSchema.parse(data)
}
export async function amendCall(leadId: string,callId: string,actorId: string,body: string) {
  const { data,error } = await discoveryDb().rpc('discovery_call_write',{ p_lead_id:leadId,p_call_id:callId,p_actor_id:actorId,p_operation:'amend',p_amendment:body })
  if (error) dbError(error)
  return z.object({ amendmentId:z.string().uuid() }).strict().parse(data)
}
export const applyFactsSchema = z.object({ changes:z.array(z.object({ field:z.enum(FACT_FIELDS), expected:z.unknown() }).strict()).min(1).max(8) }).strict()
export async function applyFacts(leadId:string,callId:string,actorId:string,input:z.infer<typeof applyFactsSchema>) {
  const call = await getCall(leadId,callId)
  if (call.status !== 'completed') throw new DiscoveryError('Complete the call before applying facts.',422)
  if (new Set(input.changes.map(c => c.field)).size !== input.changes.length) throw new DiscoveryError('Select each field once.',422)
  // Derive proposals from the values the user actually reviewed, not newer server facts.
  const expected = Object.fromEntries(input.changes.map(change => [change.field,change.expected])) as FactSnapshot
  const proposals = proposedFacts(call.answers,expected)
  const changes = input.changes.map(change => {
    const proposal = proposals.find(p => p.field === change.field)
    if (!proposal) throw new DiscoveryError('No proposed change for this field.',422)
    const patch = validateLeadFieldPatch({ field:change.field,value:proposal.proposed })
    return { field:patch.field, expected:change.expected,value:patch.value }
  })
  const { error } = await discoveryDb().rpc('apply_discovery_facts',{ p_lead_id:leadId,p_call_id:callId,p_actor_id:actorId,p_changes:changes as Json })
  if (error) dbError(error)
  return callDetail(leadId,callId)
}
