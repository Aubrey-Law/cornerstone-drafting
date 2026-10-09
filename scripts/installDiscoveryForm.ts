/** Install explicitly after local/production migrations. Default is read-only. */
import { config } from 'dotenv'
import { z } from 'zod'
import { DISCOVERY_DEFINITION, DISCOVERY_TEMPLATE_KEY } from '../lib/discovery/definition'
import { parseBundledIntakeFormInstallArgs } from './installBundledIntakeForms'
import { hashIntakeFormDefinition } from '../lib/intake/forms/hash'
config({path:'.env.local',quiet:true})
async function main(){
 const options=parseBundledIntakeFormInstallArgs(process.argv.slice(2))
 const service=await import('../lib/intake/forms/adminService')
 const existing=await service.getIntakeFormTemplateByKey(DISCOVERY_TEMPLATE_KEY)
 if(existing){
  const versions=await service.listIntakeFormVersions(existing.id)
  if(existing.purpose!=='discovery_call'||existing.archived_at)throw new Error('Existing template is unavailable; review it in the builder.')
  if(versions.some(v=>v.status==='published')){console.log('Discovery template already published; preserving administrator changes.');return}
  const draft=versions.find(v=>v.status==='draft'&&v.definition_hash===hashIntakeFormDefinition(DISCOVERY_DEFINITION))
  if(!draft)throw new Error('Existing template differs; review it in the builder.')
  if(options.apply)await service.publishIntakeFormDraft({actorId:z.string().uuid().parse(options.actorId),versionId:draft.id,expectedLockVersion:draft.lock_version,expectedDefinitionHash:draft.definition_hash})
  console.log(options.apply?'Published discovery template.':'Would publish the seeded discovery template.');return
 }
 if(!options.apply){console.log('Would create and publish the internal discovery template.');return}
 const actorId=z.string().uuid().parse(options.actorId)
 const result=await service.createIntakeFormTemplate({actorId,key:DISCOVERY_TEMPLATE_KEY,name:DISCOVERY_DEFINITION.title,definition:DISCOVERY_DEFINITION})
 await service.publishIntakeFormDraft({actorId,versionId:result.draft.id,expectedLockVersion:result.draft.lock_version,expectedDefinitionHash:result.draft.definition_hash})
 console.log('Published internal discovery template.')
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Installation failed');process.exitCode=1})
