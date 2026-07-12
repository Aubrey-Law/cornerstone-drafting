export interface ConversionLead { id: string; matterId: string | null; status: string | null }
export interface LeadConversionDependencies {
  loadLead(id: string): Promise<ConversionLead>
  createMatter(lead: ConversionLead): Promise<string>
  linkMatter(leadId: string, matterId: string): Promise<void>
}

export async function convertLeadOnce(leadId: string, dependencies: LeadConversionDependencies) {
  const lead = await dependencies.loadLead(leadId)
  if (lead.matterId) return { matterId: lead.matterId, created: false }
  if (lead.status === 'lost') throw new Error('Lost leads cannot be converted without reopening them')
  const matterId = await dependencies.createMatter(lead)
  await dependencies.linkMatter(lead.id, matterId)
  return { matterId, created: true }
}
