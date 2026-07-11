import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadTrustProvisions } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadDpoaProvisions } from '@/lib/draftPayload/defaults'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { hoistParagraphConditionals, repairSplitNunjucksInXml, renderNodeEstateDocxTemplate } from '@/lib/estateGenerator/node/templateRenderer'
import { loadNodeEstatePackage, loadNodeEstateStateRules } from '@/lib/estateGenerator/node/config'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { generateEstatePlanDocumentsNode, generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import { getPath, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')
const deterministicCoreDocxTimestamp = '2000-01-01T00:00:00.000Z'

function xmlFromDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer)
  return Object.keys(zip.files)
    .filter(name => name.startsWith('word/') && name.endsWith('.xml'))
    .map(name => zip.files[name].asText())
    .join('\n')
}

type DraftPayloadOverrides = Partial<Omit<
  DraftPayload,
  'matter' | 'client' | 'fiduciaries' | 'documents' | 'will_provisions' | 'execution' | 'trust' | 'spouse'
>> & {
  matter?: Partial<DraftPayload['matter']>
  client?: Partial<DraftPayload['client']>
  spouse?: Partial<NonNullable<DraftPayload['spouse']>> | null
  fiduciaries?: Partial<DraftPayload['fiduciaries']>
  documents?: Partial<DraftPayload['documents']>
  will_provisions?: Partial<DraftPayload['will_provisions']>
  hcp_provisions?: Partial<DraftPayload['hcp_provisions']>
  hipaa_provisions?: Partial<DraftPayload['hipaa_provisions']>
  execution?: Partial<DraftPayload['execution']>
  trust?: Partial<NonNullable<DraftPayload['trust']>> | null
}

function draftPayload(overrides: DraftPayloadOverrides = {}): DraftPayload {
  const base: DraftPayload = {
    matter: {
      id: 'matter-node-1',
      matter_number: 'EP-NODE-1',
      type: 'individual',
      trust_type: 'revocable_living',
      practice_area: 'Estate Planning',
      minor_children: false,
    },
    client: {
      first_name: 'Jane',
      last_name: 'Example',
      full_name: 'Jane Example',
      aka: null,
      preferred_pronoun: null,
      dob: '1970-01-01',
      address: '123 Main Street',
      city: 'Boston',
      county: 'Suffolk',
      state: 'MA',
      zip: '02108',
      email: 'jane@example.com',
      phone: '555-0100',
      excluded_guardian: null,
    },
    spouse: null,
    children: [],
    trust: {
      name: 'Jane Example Revocable Trust',
      spouse_name: null,
      display_name: 'Jane Example Revocable Trust',
      spouse_display_name: null,
      date: '2026-05-21',
      distribution_ages: [25, 30, 35],
      ma_estate_taxable: false,
      ma_estate_tax_savings: null,
      separate_trusts: false,
      has_ilit: false,
      ilit_trustee: null,
    },
    trust_provisions: defaultDraftPayloadTrustProvisions(),
    fiduciaries: {
      pr_primary: 'Emily Executor',
      pr_co_primary: null,
      pr_successor: 'Samuel Successor',
      pr_co_successor: null,
      pr_second_successor: null,
      dpoa_primary: null,
      dpoa_co_agent: null,
      dpoa_successor: null,
      hcp_primary: null,
      hcp_primary_address: null,
      hcp_primary_relationship: null,
      hcp_successor: null,
      hcp_successor_address: null,
      hcp_successor_relationship: null,
      trustee_initial: 'Jane Example',
      trustee_co: null,
      trustee_successor: 'Samuel Successor',
      trustee_co_successor: null,
      trustee_second_successor: null,
      trustee_co_second_successor: null,
      guardian_primary: null,
      guardian_successor: null,
      guardian_second_successor: null,
      temp_guardian_primary: null,
      temp_guardian_co: null,
      temp_guardian_successor: null,
      temp_guardian_second_successor: null,
      spouse_pr_primary: null,
      spouse_pr_successor: null,
      spouse_dpoa_primary: null,
      spouse_dpoa_successor: null,
      spouse_hcp_primary: null,
      spouse_hcp_primary_address: null,
      spouse_hcp_primary_relationship: null,
      spouse_hcp_successor: null,
      spouse_hcp_successor_address: null,
      spouse_hcp_successor_relationship: null,
      spouse_trustee_successor: 'Riley Second Successor',
    },
    documents: {
      include_trust: true,
      include_pour_over_will: false,
      include_simple_will: false,
      include_testamentary_trust_will: false,
      include_dpoa: false,
      include_hcp: false,
      include_hipaa: false,
      include_ahd: false,
      include_ppm: false,
      include_parental_appointment: false,
      include_temp_delegation: false,
      spouse_docs: false,
      trust_planning_type: 'standard',
    },
    will_provisions: {
      pr_structure: null,
      trustee_structure: null,
      cotrustee_decision_standard: 'majority',
      bond: 'no_bond',
      supervision: 'unsupervised',
      simultaneous_death: null,
      utma_age: 21,
      no_contest_clause: 'omit',
      include_disclaimer_article: true,
      include_self_proving_affidavit: true,
      tangible_property_distribution: 'equal_shares',
      tangible_property_named_individual: null,
      pour_over_alternate_disposition: null,
      pour_over_alternate_named: null,
      outright_residuary: null,
      outright_residuary_named: null,
      outright_residuary_alternate: null,
      beneficiary_structure: null,
      single_beneficiary_name: 'Avery Remote',
      single_beneficiary_remainder: 'Casey Contingent',
      age_distribution_schedule: 'staged',
      trust_protector: false,
      trust_protector_name: null,
      pet_care_option: 'omit',
      pet_care_details: {},
      specific_bequests: [],
    },
    dpoa_provisions: {
      coagent_manner: 'independently',
      self_dealing_reviewer: null,
      self_dealing_reviewer_alt: null,
      include_section_l: false,
    },
    hcp_provisions: {
      anatomical_gift: null,
      anatomical_specified: null,
    },
    hipaa_provisions: {
      psychotherapy_notes: null,
    },
    execution: {
      signing_month: 'May',
      signing_year: '2026',
      signing_county: 'Suffolk',
      notary_commission_expiration: '2030-01-01',
    },
    design_sheet_id: 'sheet-node-1',
    special_provisions: null,
    ancillary_docs: [],
    notes: null,
  }

  return {
    ...base,
    ...overrides,
    matter: { ...base.matter, ...overrides.matter },
    client: { ...base.client, ...overrides.client },
    spouse: overrides.spouse === undefined
      ? base.spouse
      : overrides.spouse === null
        ? null
        : {
            first_name: '',
            last_name: '',
            full_name: '',
            aka: null,
            preferred_pronoun: null,
            dob: null,
            ...overrides.spouse,
          },
    fiduciaries: { ...base.fiduciaries, ...overrides.fiduciaries },
    documents: { ...base.documents, ...overrides.documents },
    will_provisions: { ...base.will_provisions, ...overrides.will_provisions },
    hcp_provisions: { ...base.hcp_provisions, ...overrides.hcp_provisions },
    hipaa_provisions: { ...base.hipaa_provisions, ...overrides.hipaa_provisions },
    execution: { ...base.execution, ...overrides.execution },
    trust: overrides.trust === null ? null : { ...base.trust!, ...overrides.trust },
  }
}

function remainingAllWillsProvisions(): Partial<DraftPayload['will_provisions']> {
  return {
    simultaneous_death: 'testator_survives',
    utma_age: 18,
    tangible_property_distribution: 'named_then_children',
    tangible_property_named_individual: 'Avery Tangible Recipient',
    pet_care_option: 'direct_bequest',
    pet_care_details: {
      cash_amount: 5000,
      primary_caretaker: 'Parker Pet Caretaker',
      successor_caretaker: 'Sawyer Pet Backup',
    },
    specific_bequests: [
      {
        id: 'cash-gift',
        kind: 'cash',
        amount: 10000,
        beneficiary_name: 'Blake Beneficiary',
      },
      {
        id: 'item-gift',
        kind: 'item',
        item_description: 'my grandfather clock',
        beneficiary_name: 'Quinn Recipient',
      },
      {
        id: 'charity-gift',
        kind: 'charitable',
        amount: 2500,
        charity_name: 'Boston Animal Rescue',
      },
    ],
  }
}

function expectRemainingAllWillsProvisions(xml: string) {
  expect(xml).toContain('I give my tangible personal property to AVERY TANGIBLE RECIPIENT')
  expect(xml).toContain('the sum of $10,000 to BLAKE BENEFICIARY')
  expect(xml).toContain('my grandfather clock to QUINN RECIPIENT')
  expect(xml).toContain('the sum of $2,500 to BOSTON ANIMAL RESCUE')
  expect(xml).toContain('companion animals I own at my death to PARKER PET CARETAKER')
  expect(xml).toContain('SAWYER PET BACKUP')
  expect(xml).toContain('I shall be deemed to have survived my spouse')
  expect(xml).toContain('Massachusetts Uniform Transfers to Minors Act')
  expect(xml).toContain('age 18')
  expect(xml).not.toContain('{{')
  expect(xml).not.toContain('{%')
}

describe('node estate generator config', () => {
  it('loads the existing pour-over package config', () => {
    const config = loadNodeEstatePackage('pourover-will', root)

    expect(config.name).toBe('pourover-will')
    expect(config.required_fields).toContain('client.full_name')
    expect(config.required_fields).toContain('trust.name')
    expect(config.documents).toEqual([
      {
        id: 'pourover-will',
        title: 'Pour-Over Will',
        template: 'templates/pourover-will.docx',
        output: '01-pourover-will.docx',
      },
    ])
  })

  it('loads the personal property memorandum package config', () => {
    const config = loadNodeEstatePackage('personal-property-memorandum', root)

    expect(config.name).toBe('personal-property-memorandum')
    expect(config.required_fields).toEqual(['client.full_name'])
    expect(config.documents).toEqual([
      {
        id: 'personal-property-memorandum',
        title: 'Personal Property Memorandum',
        template: 'templates/personal-property-memorandum.docx',
        output: '01-personal-property-memorandum.docx',
      },
    ])
  })

  it('loads the estate plan summary package config', () => {
    const config = loadNodeEstatePackage('estate-plan-summary', root)

    expect(config.name).toBe('estate-plan-summary')
    expect(config.required_fields).toEqual(['client.full_name'])
    expect(config.documents).toEqual([
      {
        id: 'estate-plan-summary',
        title: 'Estate Plan Summary',
        template: 'templates/estate-plan-summary.docx',
        output: '00-estate-plan-summary.docx',
      },
    ])
  })

  it('renders the estate plan summary for married draft payload data', async () => {
    const payload = draftPayload({
      matter: { type: 'married_joint' },
      spouse: { first_name: 'John', last_name: 'Example', full_name: 'John Example' },
      documents: {
        include_trust: true,
        include_pour_over_will: true,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        spouse_docs: true,
      },
    })
    const result = await generateNodeEstatePackage({
      data: toEstateGeneratorData(payload) as Record<string, unknown>,
      packageName: 'estate-plan-summary',
      state: 'MA',
      root,
      allowDraft: true,
    })

    if (!result.ok) throw new Error(result.error)
    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('JOHN EXAMPLE')
  })

  it('renders the estate plan summary template from the married example JSON', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-estate-plan-summary.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'estate-plan-summary',
      state: 'MA',
      root,
      allowDraft: true,
    })

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('Estate Plan Summary')
    expect(xml).toContain('JORDAN COUPLETON')
    expect(xml).toContain('RILEY COUPLETON')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('loads the parental guardian appointment package config', () => {
    const config = loadNodeEstatePackage('parental-guardian-appointment', root)

    expect(config.name).toBe('parental-guardian-appointment')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.street_address',
      'children[].full_name',
      'guardians.primary.full_name',
    ])
    expect(config.documents).toEqual([
      {
        id: 'parental-guardian-appointment',
        title: 'Parental Appointment of Guardian',
        template: 'templates/parental-guardian-appointment.docx',
        output: '01-parental-appointment-of-guardian.docx',
      },
    ])
  })

  it('loads the young adult estate plan package config', () => {
    const config = loadNodeEstatePackage('young-adult-estate-plan', root)

    expect(config.name).toBe('young-adult-estate-plan')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.city',
      'client.county',
      'client.state',
      'young_adult.parent1.full_name',
      'fiduciaries.agent.primary.full_name',
      'healthcare.agent.primary.full_name',
    ])
    expect(config.documents).toEqual([
      {
        id: 'young-adult-estate-plan',
        title: 'Young Adult Estate Plan',
        template: 'templates/young-adult-estate-plan.docx',
        output: '09-young-adult-estate-plan.docx',
      },
    ])
  })

  it('loads the spouse pour-over package config', () => {
    const config = loadNodeEstatePackage('spouse-pourover-will', root)

    expect(config.name).toBe('spouse-pourover-will')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.city',
      'client.county',
      'client.state',
      'trust.name',
      'trust.date',
      'fiduciaries.executor.primary.full_name',
    ])
    expect(config.documents).toEqual([
      {
        id: 'spouse-pourover-will',
        title: 'Pour-Over Will',
        template: 'templates/pourover-will.docx',
        output: '02-spouse-pourover-will.docx',
      },
    ])
  })

  it('loads the spouse incapacity documents package config', () => {
    const config = loadNodeEstatePackage('spouse-incapacity-documents', root)

    expect(config.name).toBe('spouse-incapacity-documents')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.city',
      'client.state',
      'fiduciaries.agent.primary.full_name',
      'healthcare.agent.primary.full_name',
    ])
    expect(config.documents).toEqual([
      {
        id: 'spouse-durable-power-of-attorney',
        title: 'Durable Power of Attorney',
        template: 'templates/durable-power-of-attorney.docx',
        output: '05-spouse-durable-power-of-attorney.docx',
      },
      {
        id: 'spouse-health-care-proxy',
        title: 'Health Care Proxy',
        template: 'templates/health-care-proxy.docx',
        output: '06-spouse-health-care-proxy.docx',
      },
      {
        id: 'spouse-living-will',
        title: 'Living Will / Advance Directive',
        template: 'templates/living-will.docx',
        output: '07-spouse-living-will.docx',
      },
      {
        id: 'spouse-hipaa',
        title: 'HIPAA Authorization',
        template: 'templates/hipaa-authorization.docx',
        output: '08-spouse-hipaa-authorization.docx',
      },
    ])
  })

  it('loads the simple will package config', () => {
    const config = loadNodeEstatePackage('simple-will', root)

    expect(config.name).toBe('simple-will')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.county',
      'client.state',
      'fiduciaries.executor.primary.full_name',
    ])
    expect(config.documents).toEqual([
      {
        id: 'simple-will',
        title: 'Last Will and Testament',
        template: 'templates/will.docx',
        output: '01-last-will-and-testament.docx',
      },
    ])
  })

  it('loads the testamentary trust will package config', () => {
    const config = loadNodeEstatePackage('testamentary-trust-will', root)

    expect(config.name).toBe('testamentary-trust-will')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.county',
      'client.state',
      'fiduciaries.executor.primary.full_name',
      'fiduciaries.testamentary_trustee.primary.full_name',
      'testamentary_trust.beneficiary_structure',
    ])
    expect(config.documents).toEqual([
      {
        id: 'testamentary-trust-will',
        title: 'Last Will and Testament with Testamentary Trust',
        template: 'templates/testamentary-trust-will.docx',
        output: '01-testamentary-trust-will.docx',
      },
    ])
  })

  it('loads the spouse testamentary trust will package config', () => {
    const config = loadNodeEstatePackage('spouse-testamentary-trust-will', root)

    expect(config.name).toBe('spouse-testamentary-trust-will')
    expect(config.required_fields).toEqual([
      'client.full_name',
      'client.county',
      'client.state',
      'fiduciaries.executor.primary.full_name',
      'fiduciaries.testamentary_trustee.primary.full_name',
      'testamentary_trust.beneficiary_structure',
    ])
    expect(config.documents).toEqual([
      {
        id: 'spouse-testamentary-trust-will',
        title: 'Last Will and Testament with Testamentary Trust',
        template: 'templates/testamentary-trust-will.docx',
        output: '02-spouse-testamentary-trust-will.docx',
      },
    ])
  })

  it('loads Massachusetts state rules from the existing generator assets', () => {
    const rules = loadNodeEstateStateRules('MA', root)

    expect(rules.requires_self_proving_affidavit).toBe(true)
  })
})

describe('node estate generator validation', () => {
  it('reads dotted paths through objects and arrays', () => {
    const data = {
      client: { full_name: 'Jane Example' },
      children: [{ full_name: 'Alex Example' }, { full_name: 'Blake Example' }],
    }

    expect(getPath(data, 'client.full_name')).toBe('Jane Example')
    expect(getPath(data, 'children[].full_name')).toEqual(['Alex Example', 'Blake Example'])
    expect(getPath(data, 'client.state')).toBeNull()
  })

  it('reports missing required fields', () => {
    const missing = missingRequiredFields(
      { client: { full_name: 'Jane Example' }, trust: { name: '' } },
      ['client.full_name', 'client.state', 'trust.name'],
    )

    expect(missing).toEqual(['client.state', 'trust.name'])
  })
})

describe('node estate generator context', () => {
  it('computes conditions and display values needed by the pour-over template', () => {
    const context = buildNodeEstateContext({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        spouse: { full_name: 'John Example' },
        children: [{ full_name: 'Alex Example', minor: true }],
        planning: { uses_revocable_trust: true },
        trust: { name: 'The Jane Example Revocable Trust', date: 'June 5, 2026' },
        guardians: { excluded: [{ full_name: 'Excluded Person', reason: 'conflict' }] },
        fiduciaries: { executor: { primary: { full_name: 'Pat Executor' } } },
        execution: { signing_scheduled: false },
      },
      state: 'MA',
      root,
    })

    expect(context.has_spouse).toBe(true)
    expect(context.has_children).toBe(true)
    expect(context.has_minor_children).toBe(true)
    expect(context.requires_guardian_clause).toBe(true)
    expect(context.uses_revocable_trust).toBe(true)
    expect(context.has_excluded_guardians).toBe(true)
    expect(context.state.requires_self_proving_affidavit).toBe(true)
    expect(context.execution.display_doc_date).toBe('________________, 20__')
    expect(context.execution.display_ordinal_doc_date).toBe('_____ day of _________________, 20___')
    expect(context.execution.display_signing_county).toBe('__________________________')
    // Empty commission renders nothing (label kept, blank fill line dropped).
    expect(context.execution.display_notary_commission).toBe('')
  })

  it('keeps blank execution display values for missing scheduled signing details', () => {
    const context = buildNodeEstateContext({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        planning: { uses_revocable_trust: true },
        children: [],
        execution: {
          signing_scheduled: true,
          signing_county: 'Suffolk',
        },
      },
      state: 'MA',
      root,
    })

    expect(context.execution.display_doc_date).toBe('________________, 20__')
    expect(context.execution.display_ordinal_doc_date).toBe('_____ day of _________________, 20___')
    expect(context.execution.display_signing_county).toBe('Suffolk')
    // Commission missing even though signing is scheduled -> empty (no fill line).
    expect(context.execution.display_notary_commission).toBe('')
  })
})

describe('node estate generator text rendering', () => {
  it('renders variables, the name filter, conditionals, and loops', () => {
    const rendered = renderNodeEstateText(
      'I am {{ client.full_name | name }}.{% if has_children %} Children: {% for child in children %}{{ child.full_name | name }}{% if not loop.last %}; {% endif %}{% endfor %}.{% endif %}',
      {
        client: { full_name: 'Jane Example' },
        has_children: true,
        children: [{ full_name: 'Alex Example' }, { full_name: 'Blake Example' }],
      },
    )

    expect(rendered).toBe('I am JANE EXAMPLE. Children: ALEX EXAMPLE; BLAKE EXAMPLE.')
  })

  it('renders a [[ MISSING: field ]] marker for an empty bare placeholder instead of throwing', () => {
    const zip = new PizZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>City: {{ client.city }}</w:t></w:r></w:p></w:body></w:document>',
    )
    const templatePath = path.join(os.tmpdir(), `empty-city-${process.pid}.docx`)
    fs.writeFileSync(templatePath, Buffer.from(zip.generate({ type: 'uint8array' })))

    const context = buildNodeEstateContext({
      data: { client: { full_name: 'Jane Example', state: 'MA' }, children: [], execution: {} },
      state: 'MA',
      root,
    })
    const clauses = createNodeClauseStore({ root, state: 'MA', allowDraft: true })

    try {
      const rendered = renderNodeEstateDocxTemplate({ templatePath, context, clauses })
      expect(rendered.missingFields).toContain('client.city')
      expect(xmlFromDocx(rendered.buffer)).toContain('[[ MISSING: client.city ]]')
    } finally {
      fs.rmSync(templatePath, { force: true })
    }
  })

  describe('repairSplitNunjucksInXml', () => {
    it('joins merge tags Word split across runs with OOXML in between', () => {
      const xml = '<w:p><w:r><w:t>{% if </w:t></w:r><w:r><w:t>client.aka</w:t></w:r><w:r><w:t> %}shown{% endif %}</w:t></w:r></w:p>'
      expect(repairSplitNunjucksInXml(xml)).toBe(
        '<w:p><w:r><w:t>{% if client.aka %}shown{% endif %}</w:t></w:r></w:p>',
      )
    })
  })

  describe('hoistParagraphConditionals', () => {
    it('moves a fully-conditional paragraph\'s if/endif outside the <w:p>', () => {
      const xml = '<w:body><w:p><w:r><w:t>{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}</w:t></w:r></w:p></w:body>'
      expect(hoistParagraphConditionals(xml)).toBe(
        '<w:body>{% if has_pet_care %}<w:p><w:r><w:t>{{ include_clause("will.pet_care") }}</w:t></w:r></w:p>{% endif %}</w:body>',
      )
    })

    it('leaves a paragraph with text outside the conditional untouched', () => {
      const xml = '<w:body><w:p><w:r><w:t>I nominate {% if co %} and X{% endif %}, executor.</w:t></w:r></w:p></w:body>'
      expect(hoistParagraphConditionals(xml)).toBe(xml)
    })

    it('leaves two sibling conditional blocks in one paragraph untouched', () => {
      const xml = '<w:body><w:p><w:r><w:t>{% if a %}A{% endif %}{% if b %}B{% endif %}</w:t></w:r></w:p></w:body>'
      expect(hoistParagraphConditionals(xml)).toBe(xml)
    })
  })

  it('drops the whole paragraph (no blank line) when a conditional section is omitted', () => {
    const zip = new PizZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body>'
        + '<w:p><w:r><w:t>Intro paragraph.</w:t></w:r></w:p>'
        + '<w:p><w:pPr><w:pStyle w:val="TextHeading2"/></w:pPr><w:r><w:t>{% if has_pet_care %}Pet care section.{% endif %}</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t>Closing paragraph.</w:t></w:r></w:p>'
        + '</w:body></w:document>',
    )
    const templatePath = path.join(os.tmpdir(), `omitted-conditional-${process.pid}.docx`)
    fs.writeFileSync(templatePath, Buffer.from(zip.generate({ type: 'uint8array' })))

    // No pet care -> has_pet_care is falsy -> the conditional paragraph is dropped.
    const context = buildNodeEstateContext({
      data: { client: { full_name: 'Jane Example', state: 'MA' }, children: [], execution: {} },
      state: 'MA',
      root,
    })
    const clauses = createNodeClauseStore({ root, state: 'MA', allowDraft: true })

    try {
      const xml = xmlFromDocx(renderNodeEstateDocxTemplate({ templatePath, context, clauses }).buffer)
      expect(xml).not.toContain('Pet care section.')
      // The conditional paragraph (and its blank line) is gone entirely: only the
      // two real paragraphs remain, with no empty paragraph left behind.
      expect((xml.match(/<w:p\b/g) ?? []).length).toBe(2)
      expect(xml).not.toContain('TextHeading2')
    } finally {
      fs.rmSync(templatePath, { force: true })
    }
  })

  it('renders an empty notary commission as nothing (no MISSING marker, label kept)', () => {
    const zip = new PizZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>My Commission Expires: {{ execution.display_notary_commission }}</w:t></w:r></w:p></w:body></w:document>',
    )
    const templatePath = path.join(os.tmpdir(), `empty-commission-${process.pid}.docx`)
    fs.writeFileSync(templatePath, Buffer.from(zip.generate({ type: 'uint8array' })))

    const context = buildNodeEstateContext({
      // No execution.notary_commission provided -> display value is empty.
      data: { client: { full_name: 'Jane Example', state: 'MA' }, children: [], execution: {} },
      state: 'MA',
      root,
    })
    const clauses = createNodeClauseStore({ root, state: 'MA', allowDraft: true })

    try {
      const rendered = renderNodeEstateDocxTemplate({ templatePath, context, clauses })
      const xml = xmlFromDocx(rendered.buffer)
      expect(rendered.missingFields).not.toContain('execution.display_notary_commission')
      expect(xml).not.toContain('[[ MISSING')
      expect(xml).not.toContain('_________________________')
      expect(xml).toContain('My Commission Expires:')
    } finally {
      fs.rmSync(templatePath, { force: true })
    }
  })

  it('generates tag-balanced (openable) DPOA output for every co-agent arrangement', async () => {
    // The DPOA template nests paragraphs inside a run (invalid OOXML, but Word
    // tolerates it). The conditional-paragraph strip used to unwrap those wrong
    // and unbalance the tags, producing a .docx that would not open. The safety
    // net must keep every arrangement tag-balanced.
    const base = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    ) as { fiduciaries: { agent: Record<string, unknown> } }
    const balanced = (xml: string, name: string) => {
      const total = (xml.match(new RegExp(`<w:${name}\\b`, 'g')) ?? []).length
      const selfClosing = (xml.match(new RegExp(`<w:${name}\\b[^>]*/>`, 'g')) ?? []).length
      const closes = xml.split(`</w:${name}>`).length - 1
      return total - selfClosing - closes === 0
    }

    for (const action of ['separate', 'jointly', 'majority'] as const) {
      const data = JSON.parse(JSON.stringify(base))
      data.fiduciaries.agent.co_agents_action = action
      const result = await generateNodeEstatePackage({
        data, packageName: 'incapacity-documents', state: 'MA', root, allowDraft: true,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const dpoa = result.files.find(f => f.name.includes('durable-power'))!
      const xml = new PizZip(dpoa.buffer).files['word/document.xml'].asText()
      expect(balanced(xml, 'p'), `<w:p> balance (${action})`).toBe(true)
      expect(balanced(xml, 'r'), `<w:r> balance (${action})`).toBe(true)
      expect(balanced(xml, 't'), `<w:t> balance (${action})`).toBe(true)
    }
  })

  it('leaves no blank paragraph when a standalone conditional section is omitted', () => {
    const body =
      '<w:p><w:r><w:t>Before</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{% if show_section %}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Inside the optional section.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{% endif %}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p>'
    const zip = new PizZip()
    zip.file('word/document.xml', `<w:document><w:body>${body}</w:body></w:document>`)
    const templatePath = path.join(os.tmpdir(), `cond-${process.pid}.docx`)
    fs.writeFileSync(templatePath, Buffer.from(zip.generate({ type: 'uint8array' })))
    const clauses = createNodeClauseStore({ root, state: 'MA', allowDraft: true })

    const render = (show_section: boolean) => {
      const context = buildNodeEstateContext({
        data: { client: { full_name: 'Jane Example', state: 'MA' }, show_section, children: [], execution: {} },
        state: 'MA', root,
      })
      const xml = xmlFromDocx(renderNodeEstateDocxTemplate({ templatePath, context, clauses }).buffer)
      const paragraphs = xml.match(/<w:p\b[\s*>][\s\S]*?<\/w:p>/g) ?? xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
      const empty = paragraphs.filter(p => !/<w:t[^>]*>[\s\S]*?<\/w:t>/.test(p)).length
      return { xml, empty }
    }

    try {
      const omitted = render(false)
      expect(omitted.xml).not.toContain('Inside the optional section.')
      expect(omitted.xml).not.toContain('{%')
      expect(omitted.empty).toBe(0) // no blank paragraph left where the {% if %} was

      const kept = render(true)
      expect(kept.xml).toContain('Inside the optional section.')
      expect(kept.empty).toBe(0)
    } finally {
      fs.rmSync(templatePath, { force: true })
    }
  })

  it('normalizes every applied font to Garamond', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data, packageName: 'incapacity-documents', state: 'MA', root, allowDraft: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    const rendered = /^word\/(document\.xml|styles\.xml|(header|footer)\d*\.xml)$/
    for (const file of result.files) {
      const zip = new PizZip(file.buffer)
      for (const name of Object.keys(zip.files)) {
        if (!rendered.test(name)) continue
        // Inspect applied fonts only (<w:rFonts .../>), not style display names
        // or the font-declaration table, which legitimately list other fonts.
        const appliedFonts = zip.files[name].asText().match(/<w:rFonts\b[^>]*\/>/g) ?? []
        for (const tag of appliedFonts) {
          expect(tag, `${file.name}/${name}`).not.toContain('Times New Roman')
          expect(tag, `${file.name}/${name}`).not.toContain('Aptos')
        }
      }
    }
  })

  it('loads and renders approved clauses with state overrides', () => {
    const context = buildNodeEstateContext({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        planning: { uses_revocable_trust: true },
        children: [],
        execution: {},
      },
      state: 'MA',
      root,
    })
    const clauses = createNodeClauseStore({ root, state: 'MA', allowDraft: true })

    expect(clauses.include('execution.self_proving_affidavit', context)).toContain('COMMONWEALTH OF MASSACHUSETTS')
    expect(clauses.report.included_clauses[0]).toMatchObject({
      id: 'execution.self_proving_affidavit',
      jurisdiction: 'MA',
      review_status: 'approved',
    })
  })
})

describe('node estate generator package generation', () => {
  it('keeps the personal property memorandum source template reproducible', () => {
    const buffer = fs.readFileSync(path.join(root, 'templates/personal-property-memorandum.docx'))
    const zip = new PizZip(buffer)
    const coreXml = zip.file('docProps/core.xml')?.asText()

    expect(coreXml).toContain(
      `<dcterms:created xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:created>`,
    )
    expect(coreXml).toContain(
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:modified>`,
    )

    const entryDates = Object.values(zip.files).map(file => file.date)

    expect(new Set(entryDates.map(date => date.getTime())).size).toBe(1)
    for (const date of entryDates) {
      expect(date.getFullYear()).toBe(2000)
      expect(date.getMonth()).toBe(0)
      expect(date.getDate()).toBe(1)
      expect(date.getHours()).toBe(0)
      expect(date.getMinutes()).toBe(0)
      expect(date.getSeconds()).toBe(0)
    }
  })

  it('generates the existing pour-over will package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-pourover.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'pourover-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('pourover-will')
    expect(result.files.map(file => file.name)).toEqual(['01-pourover-will.docx'])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.files[0].buffer.length).toBeGreaterThan(1000)

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('JANE EXAMPLE REVOCABLE TRUST')
    expect(xml).toContain('EMILY EXECUTOR')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT]')
  })

  it('generates the existing individual single trust package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-trust-individual-single.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'trust-individual-single',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('trust-individual-single')
    expect(result.files.map(file => file.name)).toEqual(['01-individual-single-revocable-trust.docx'])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.files[0].buffer.length).toBeGreaterThan(1000)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('JANE EXAMPLE REVOCABLE TRUST')
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('THOMAS TRUSTEE')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[TRUST NAME]')
  })

  it('tags each generated file with the client as owner and its friendly title', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data, packageName: 'incapacity-documents', state: 'MA', root, allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files.every(file => file.owner === 'Jane Example')).toBe(true)
    expect(result.files.map(file => file.title)).toEqual([
      'Durable Power of Attorney',
      'Health Care Proxy',
      'Living Will / Advance Directive',
      'HIPAA Authorization',
    ])
  })

  it('tags spouse-package files with the spouse as owner', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data, packageName: 'spouse-incapacity-documents', state: 'MA', root, allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files.every(file => file.owner === 'John Example')).toBe(true)
  })

  it('tags joint-trust files with both spouses as owner', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-joint-trust.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data, packageName: 'joint-trust', state: 'MA', root, allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files.every(file => file.owner === 'Alex Example & Jordan Example')).toBe(true)
  })

  it('renders client pronouns from intake in the trust execution block', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      client: {
        preferred_pronoun: 'she/her',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['trust-individual-single', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('who acknowledged that she signed it voluntarily')
    expect(xml).not.toContain('who acknowledged that they signed it voluntarily')
  })

  it('generates the personal property memorandum package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'personal-property-memorandum',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('personal-property-memorandum')
    expect(result.files.map(file => file.name)).toEqual(['01-personal-property-memorandum.docx'])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.files[0].buffer.length).toBeGreaterThan(1000)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('MEMORANDUM FOR DISPOSITION OF PERSONAL EFFECTS')
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('PERSONAL PROPERTY SCHEDULE TO BE COMPLETED BY CLIENT')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT')
  })

  it('generates the simple will package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-pourover.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'simple-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('simple-will')
    expect(result.files.map(file => file.name)).toEqual(['01-last-will-and-testament.docx'])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.files[0].buffer.length).toBeGreaterThan(1000)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('EMILY EXECUTOR')
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT]')
  })

  it('generates the testamentary trust will package without unresolved markers', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [],
        planning: { uses_revocable_trust: false, has_minor_children: false },
        trust: {},
        testamentary_trust: {
          beneficiary_structure: 'descendants_per_stirpes',
          age_distribution_schedule: 'staggered_25_30_35',
          single_beneficiary: { full_name: '' },
          remainder_beneficiary: { full_name: '' },
          trust_protector_requested: true,
          trust_protector: { full_name: 'Parker Protector' },
        },
        fiduciaries: {
          executor: {
            primary: { full_name: 'Emily Executor' },
          },
          testamentary_trustee: {
            primary: { full_name: 'Taylor Testamentary Trustee' },
            co_primary: { full_name: '' },
            successor: { full_name: 'Morgan Backup Trustee' },
          },
        },
        guardians: {
          primary: { full_name: '' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'testamentary-trust-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('testamentary-trust-will')
    expect(result.files.map(file => file.name)).toEqual(['01-testamentary-trust-will.docx'])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.files[0].buffer.length).toBeGreaterThan(1000)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('EMILY EXECUTOR')
    expect(xml).toContain('TAYLOR TESTAMENTARY TRUSTEE')
    expect(xml).toContain('MORGAN BACKUP TRUSTEE')
    expect(xml).toContain('PARKER PROTECTOR')
    expect(xml).toContain('separate shares')
    expect(xml).toContain(
      'one-third of a beneficiary&#39;s share at age twenty-five, one-half of the remaining share at age thirty, and the balance at age thirty-five',
    )
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT]')
  })

  it('renders the single-beneficiary testamentary trust branch', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [],
        planning: { uses_revocable_trust: false, has_minor_children: false },
        trust: {},
        testamentary_trust: {
          beneficiary_structure: 'single_beneficiary',
          age_distribution_schedule: '',
          single_beneficiary: { full_name: 'Avery Beneficiary' },
          remainder_beneficiary: { full_name: 'Casey Remainder' },
          trust_protector_requested: false,
          trust_protector: { full_name: '' },
        },
        fiduciaries: {
          executor: {
            primary: { full_name: 'Emily Executor' },
          },
          testamentary_trustee: {
            primary: { full_name: 'Taylor Testamentary Trustee' },
            co_primary: { full_name: '' },
            successor: { full_name: '' },
          },
        },
        guardians: {
          primary: { full_name: '' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'testamentary-trust-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('AVERY BENEFICIARY')
    expect(xml).toContain('CASEY REMAINDER')
    expect(xml).toContain('health, education, maintenance, and support')
    expect(xml).not.toContain('PARKER PROTECTOR')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('does not render unnamed child records in direct simple will generation', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [{ minor: true }],
        planning: { uses_revocable_trust: false },
        trust: {},
        fiduciaries: {
          executor: {
            primary: { full_name: 'Emily Executor' },
          },
        },
        guardians: {
          primary: { full_name: 'Grace Guardian' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'simple-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).not.toContain('My children are: .')
  })

  it('still generates a simple will for minor-child plans but reports missing guardian data', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [],
        planning: { uses_revocable_trust: false, has_minor_children: true },
        trust: {},
        fiduciaries: {
          executor: {
            primary: { full_name: 'Emily Executor' },
          },
        },
        guardians: {
          primary: { full_name: '' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'simple-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.missing).toContain('guardians.primary.full_name')
  })

  it('still generates a pour-over will but reports a missing named alternate beneficiary', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', city: 'Boston', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [],
        planning: { uses_revocable_trust: true },
        trust: { name: 'Jane Example Revocable Trust', date: 'May 21, 2026' },
        pour_over: {
          alternate_disposition: 'named',
          alternate_named: { full_name: '' },
          alternate_disposition_text: '',
        },
        fiduciaries: {
          executor: {
            primary: { full_name: 'Emily Executor' },
          },
        },
        guardians: {
          primary: { full_name: '' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'pourover-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.missing).toContain('pour_over.alternate_named.full_name')
  })

  it('renders the second successor guardian in the pour-over will', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', city: 'Boston', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [{ full_name: 'Alex Example', minor: true }],
        planning: { uses_revocable_trust: true, has_minor_children: true },
        trust: { name: 'Jane Example Revocable Trust', date: 'May 21, 2026' },
        fiduciaries: {
          executor: { primary: { full_name: 'Emily Executor' } },
        },
        guardians: {
          primary: { full_name: 'Grace Guardian' },
          successor: { full_name: 'Backup Guardian' },
          second_successor: { full_name: 'Final Guardian' },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'pourover-will',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).toContain('BACKUP GUARDIAN')
    expect(xml).toContain('FINAL GUARDIAN')
    expect(xml).not.toContain('[[ MISSING: guardians.second_successor')
  })

  it('renders all three trustee succession levels and their co-trustees in the individual trust', async () => {
    const result = await generateNodeEstatePackage({
      data: {
        client: { full_name: 'Jane Example', city: 'Boston', state: 'MA', county: 'Suffolk' },
        spouse: { exists: false },
        children: [],
        planning: { uses_revocable_trust: true },
        trust: { name: 'Jane Example Revocable Trust', date: 'May 21, 2026' },
        fiduciaries: {
          trustee: {
            primary: { full_name: 'Tracy Trustee' },
            co_primary: { full_name: 'Casey Co-Trustee' },
            successor: { full_name: 'Sam Successor' },
            co_successor: { full_name: 'Sandy Co-Successor' },
            second_successor: { full_name: 'Theo Third' },
            co_second_successor: { full_name: 'Tara Co-Third' },
            co_trustees_action: 'majority',
          },
        },
        specific_gifts: [],
        charitable_gifts: [],
        execution: {},
      },
      packageName: 'trust-individual-single',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    for (const name of ['TRACY TRUSTEE', 'CASEY CO-TRUSTEE', 'SAM SUCCESSOR', 'SANDY CO-SUCCESSOR', 'THEO THIRD', 'TARA CO-THIRD']) {
      expect(xml).toContain(name)
    }
    expect(xml).not.toContain('[[ MISSING: fiduciaries.trustee')
  })

  it('supports individual trust generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload())

    if (!result.ok) throw new Error(result.error)
    expect(result.ok).toBe(true)

    expect(result.packageNames).toEqual(['trust-individual-single', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-individual-single-revocable-trust.docx',
      '00-estate-plan-summary.docx',
    ])
  })

  it('adds an individual estate plan summary to app-level draft generation', async () => {
    const result = await generateNodeEstatePackage({
      data: toEstateGeneratorData(draftPayload()) as Record<string, unknown>,
      packageName: 'estate-plan-summary',
      state: 'MA',
      root,
      allowDraft: true,
    })

    if (!result.ok) throw new Error(result.error)

    const summaryXml = xmlFromDocx(result.files[0].buffer)
    expect(result.files[0].name).toBe('00-estate-plan-summary.docx')
    expect(summaryXml).toContain('Estate Plan Summary')
    expect(summaryXml).toContain('JANE EXAMPLE')
    expect(summaryXml).toContain('Your Revocable Living Trust')
    expect(summaryXml).toContain('Initial Trustee: JANE EXAMPLE')
    expect(summaryXml).toContain('SAMUEL SUCCESSOR')
    expect(summaryXml).not.toContain('{{')
    expect(summaryXml).not.toContain('{%')
  })

  it('adds couple language to the estate plan summary for married joint plans', async () => {
    const payload = draftPayload({
      matter: {
        type: 'married_joint',
      },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      documents: {
        include_trust: true,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: true,
      },
      fiduciaries: {
        dpoa_primary: 'Paula Agent',
        hcp_primary: 'Henry Healthcare',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_dpoa_primary: 'Sloane Spouse Agent',
        spouse_hcp_primary: 'Harper Spouse Proxy',
      },
    })
    const result = await generateNodeEstatePackage({
      data: toEstateGeneratorData(payload) as Record<string, unknown>,
      packageName: 'estate-plan-summary',
      state: 'MA',
      root,
      allowDraft: true,
    })

    if (!result.ok) throw new Error(result.error)

    const summaryXml = xmlFromDocx(result.files[0].buffer)
    expect(summaryXml).toContain('JANE EXAMPLE &amp; JOHN EXAMPLE')
    expect(summaryXml).toContain('Your Revocable Living Trust')
    expect(summaryXml).toContain('Each of your Wills serves as a safety net')
    expect(summaryXml).toContain('JOHN EXAMPLE')
    expect(summaryXml).not.toContain('{{')
    expect(summaryXml).not.toContain('{%')
  })

  it('renders scheduled execution fields separately from the agreement date in individual trusts', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      client: {
        county: 'Middlesex',
      },
      trust: {
        name: 'Jane Example Revocable Trust',
        date: '2026-06-15',
      },
      execution: {
        signing_month: 'May',
        signing_year: '2026',
        signing_county: 'Suffolk',
        notary_commission_expiration: '2030-01-01',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('Trust Agreement") dated June 15, 2026')
    expect(xml).toContain('Dated: May 1, 2026')
    expect(xml).toContain('COUNTY OF SUFFOLK')
    expect(xml).toContain('On May 1, 2026')
    expect(xml).toContain('January 1, 2030')
    expect(xml).not.toContain('COUNTY OF MIDDLESEX')
    expect(xml).not.toContain('Dated: June 15, 2026')
    expect(xml).not.toContain('On June 15, 2026')
  })

  it('supports a simple will-only plan through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-last-will-and-testament.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(result.warnings).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Simple will.',
    )
  })

  it('renders named outright residuary choices in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        outright_residuary: 'named',
        outright_residuary_named: 'Avery Outright Beneficiary',
        outright_residuary_alternate: 'Casey Alternate Beneficiary',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['simple-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('AVERY OUTRIGHT BENEFICIARY')
    expect(xml).toContain('CASEY ALTERNATE BENEFICIARY')
    expect(xml).toContain('If neither AVERY OUTRIGHT BENEFICIARY nor CASEY ALTERNATE BENEFICIARY survives me')
    expect(xml).not.toContain('to my spouse, if my spouse survives me')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders co-PR and bond choices in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        pr_co_primary: 'Cameron Co-Executor',
        pr_successor: 'Samuel Successor',
        pr_second_successor: 'Riley Second Successor',
      },
      will_provisions: {
        pr_structure: 'co_pr',
        bond: 'required',
        supervision: 'supervised',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('EMILY EXECUTOR and CAMERON CO-EXECUTOR, jointly')
    expect(xml).toContain('First: SAMUEL SUCCESSOR')
    expect(xml).toContain('Second: RILEY SECOND SUCCESSOR')
    expect(xml).toContain('bond with surety')
    expect(xml).toContain('supervised administration')
    expect(xml).not.toContain('No bond shall be required')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders co-PR and bond choices in app-level pour-over wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        pr_co_primary: 'Cameron Co-Executor',
        pr_successor: 'Samuel Successor',
      },
      will_provisions: {
        pr_structure: 'co_pr',
        bond: 'required',
        supervision: 'supervised',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['pourover-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('EMILY EXECUTOR')
    expect(xml).toContain('CAMERON CO-EXECUTOR')
    expect(xml).toContain('SAMUEL SUCCESSOR')
    expect(xml).toContain('bond with surety')
    expect(xml).toContain('supervised administration')
    expect(xml).not.toContain('No bond shall be required')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders common optional provisions in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        no_contest_clause: 'include',
        include_disclaimer_article: true,
        include_self_proving_affidavit: true,
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('beneficiary who contests this Will')
    expect(xml).toContain('Any beneficiary may disclaim')
    expect(xml).toContain('COMMONWEALTH OF MASSACHUSETTS')
    expect(xml).toContain('self-proving affidavit')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders scheduled signing date and signing county in app-level simple will execution blocks', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      client: {
        county: 'Middlesex',
      },
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        include_self_proving_affidavit: true,
      },
      execution: {
        signing_month: 'May',
        signing_year: '2026',
        signing_county: 'Suffolk',
        notary_commission_expiration: '2030-01-01',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('Signed by JANE EXAMPLE on the 1st day of May, 2026 in SUFFOLK County, MA')
    expect(xml).toContain('COUNTY OF SUFFOLK')
    expect(xml).toContain('January 1, 2030')
    expect(xml).not.toContain('COUNTY OF MIDDLESEX')
    expect(xml).not.toContain('in Middlesex County')
  })

  it('omits disabled common optional provisions in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        no_contest_clause: 'omit',
        include_disclaimer_article: false,
        include_self_proving_affidavit: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).not.toContain('beneficiary who contests this Will')
    expect(xml).not.toContain('Any beneficiary may disclaim')
    expect(xml).not.toContain('COMMONWEALTH OF MASSACHUSETTS')
    expect(xml).not.toContain('self-proving affidavit')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders common optional provisions in app-level pour-over wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        no_contest_clause: 'include',
        include_disclaimer_article: true,
        include_self_proving_affidavit: true,
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['pourover-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('beneficiary who contests this Will')
    expect(xml).toContain('Any beneficiary may disclaim')
    expect(xml).toContain('COMMONWEALTH OF MASSACHUSETTS')
    expect(xml).toContain('self-proving affidavit')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders common optional provisions in app-level testamentary trust wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        no_contest_clause: 'include',
        include_disclaimer_article: true,
        include_self_proving_affidavit: true,
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('beneficiary who contests this Will')
    expect(xml).toContain('Any beneficiary may disclaim')
    expect(xml).toContain('COMMONWEALTH OF MASSACHUSETTS')
    expect(xml).toContain('self-proving affidavit')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders scheduled signing date and signing county in app-level testamentary trust will execution blocks', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      client: {
        county: 'Middlesex',
      },
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        include_self_proving_affidavit: true,
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
      },
      execution: {
        signing_month: 'May',
        signing_year: '2026',
        signing_county: 'Suffolk',
        notary_commission_expiration: '2030-01-01',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('Signed by JANE EXAMPLE on the 1st day of May, 2026 in SUFFOLK County, MA')
    expect(xml).toContain('COUNTY OF SUFFOLK')
    expect(xml).toContain('January 1, 2030')
    expect(xml).not.toContain('COUNTY OF MIDDLESEX')
    expect(xml).not.toContain('in Middlesex County')
  })

  it('renders client AKA and excluded guardian details in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      matter: {
        minor_children: true,
      },
      client: {
        aka: 'Janie Example',
        excluded_guardian: 'Jordan Unsafe Guardian',
      },
      children: [{
        full_name: 'Morgan Minor',
        dob: '2020-01-01',
        relationship: 'biological',
        minor: true,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('also known as JANIE EXAMPLE')
    expect(xml).toContain('MORGAN MINOR')
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).toContain('specifically exclude as guardian')
    expect(xml).toContain('JORDAN UNSAFE GUARDIAN')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders client AKA and excluded guardian details in app-level pour-over wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        minor_children: true,
      },
      client: {
        aka: 'Janie Example',
        excluded_guardian: 'Jordan Unsafe Guardian',
      },
      children: [{
        full_name: 'Morgan Minor',
        dob: '2020-01-01',
        relationship: 'biological',
        minor: true,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['pourover-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('also known as JANIE EXAMPLE')
    expect(xml).toContain('MORGAN MINOR')
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).toContain('specifically exclude as guardian')
    expect(xml).toContain('JORDAN UNSAFE GUARDIAN')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders client AKA and excluded guardian details in app-level testamentary trust wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      matter: {
        minor_children: true,
      },
      client: {
        aka: 'Janie Example',
        excluded_guardian: 'Jordan Unsafe Guardian',
      },
      children: [{
        full_name: 'Morgan Minor',
        dob: '2020-01-01',
        relationship: 'biological',
        minor: true,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        guardian_primary: 'Grace Guardian',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('also known as JANIE EXAMPLE')
    expect(xml).toContain('MORGAN MINOR')
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).toContain('specifically exclude as guardian')
    expect(xml).toContain('JORDAN UNSAFE GUARDIAN')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders remaining all-wills provisions in app-level simple wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      children: [{
        full_name: 'Morgan Child',
        dob: '2015-01-01',
        relationship: 'biological',
        minor: false,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: remainingAllWillsProvisions(),
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expectRemainingAllWillsProvisions(xmlFromDocx(result.files[0].buffer))
  })

  it('renders remaining all-wills provisions in app-level pour-over wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      children: [{
        full_name: 'Morgan Child',
        dob: '2015-01-01',
        relationship: 'biological',
        minor: false,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: remainingAllWillsProvisions(),
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['pourover-will', 'estate-plan-summary'])
    expectRemainingAllWillsProvisions(xmlFromDocx(result.files[0].buffer))
  })

  it('renders remaining all-wills provisions in app-level testamentary trust wills', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      children: [{
        full_name: 'Morgan Child',
        dob: '2015-01-01',
        relationship: 'biological',
        minor: false,
      }],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        ...remainingAllWillsProvisions(),
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expectRemainingAllWillsProvisions(xmlFromDocx(result.files[0].buffer))
  })

  it('supports a testamentary trust will-only plan through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: true,
        trust_protector_name: 'Parker Protector',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-testamentary-trust-will.docx',
      '00-estate-plan-summary.docx',
    ])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('EMILY EXECUTOR')
    expect(xml).toContain('TAYLOR TESTAMENTARY TRUSTEE')
    expect(xml).toContain('PARKER PROTECTOR')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('renders testamentary co-trustee decision choices from the draft payload', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_co: 'Cameron Cotrustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        trustee_structure: 'co_trustees',
        cotrustee_decision_standard: 'unanimous',
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('TAYLOR TESTAMENTARY TRUSTEE')
    expect(xml).toContain('CAMERON COTRUSTEE')
    expect(xml).toContain('act unanimously')
    expect(xml).not.toContain('act by majority decision')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('supports spouse companion testamentary trust wills through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        type: 'married_joint',
      },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: true,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_pr_successor: 'Sawyer Spouse Successor',
        spouse_trustee_successor: 'Skyler Spouse Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual([
      'testamentary-trust-will',
      'spouse-testamentary-trust-will',
      'estate-plan-summary',
    ])
    expect(result.files.map(file => file.name)).toEqual([
      '01-testamentary-trust-will.docx',
      '02-spouse-testamentary-trust-will.docx',
      '00-estate-plan-summary.docx',
    ])

    const clientXml = xmlFromDocx(result.files[0].buffer)
    const spouseXml = xmlFromDocx(result.files[1].buffer)

    expect(clientXml).toContain('JANE EXAMPLE')
    expect(clientXml).toContain('EMILY EXECUTOR')
    expect(clientXml).toContain('TAYLOR TESTAMENTARY TRUSTEE')
    expect(spouseXml).toContain('JOHN EXAMPLE')
    expect(spouseXml).toContain('SPENCER SPOUSE EXECUTOR')
    expect(spouseXml).toContain('SKYLER SPOUSE TRUSTEE')
    expect(spouseXml).not.toContain('{{')
    expect(spouseXml).not.toContain('{%')
  })

  it('generates app-level minor-child simple wills without unnamed child declarations', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        minor_children: true,
      },
      trust: null,
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
      },
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['simple-will', 'estate-plan-summary'])

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).not.toContain('My children are: .')
  })

  it('supports an individual trust plus pour-over plan through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: true,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['trust-individual-single', 'pourover-will', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-individual-single-revocable-trust.docx',
      '01-pourover-will.docx',
      '00-estate-plan-summary.docx',
    ])
  })

  it('renders pour-over alternate beneficiary and scheduled execution fields from the draft payload', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      will_provisions: {
        pour_over_alternate_disposition: 'named',
        pour_over_alternate_named: 'Brooke Backup Beneficiary',
      },
      execution: {
        signing_month: 'May',
        signing_year: '2026',
        signing_county: 'Suffolk',
        notary_commission_expiration: '2030-01-01',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['pourover-will', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-pourover-will.docx',
      '00-estate-plan-summary.docx',
    ])

    const xml = xmlFromDocx(result.files[0].buffer)

    expect(xml).toContain('BROOKE BACKUP BENEFICIARY')
    expect(xml).toContain('the 1st day of May, 2026')
    expect(xml).toContain('COUNTY OF SUFFOLK')
    expect(xml).toContain('January 1, 2030')
    expect(xml).not.toContain('to my spouse if my spouse survives me')
    expect(xml).not.toContain('this _____ day of _____________')
  })

  it('supports a full individual trust package with PPM through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: true,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: true,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        dpoa_primary: 'Paula Agent',
        hcp_primary: 'Henry Healthcare',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual([
      'trust-individual-single',
      'pourover-will',
      'incapacity-documents',
      'personal-property-memorandum',
      'estate-plan-summary',
    ])
    expect(result.files.map(file => file.name)).toEqual([
      '01-individual-single-revocable-trust.docx',
      '01-pourover-will.docx',
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
      '01-personal-property-memorandum.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(result.warnings).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Personal property memorandum.',
    )
  })

  it('supports spouse companion pour-over and incapacity documents through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        type: 'married_joint',
      },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        dob: '1972-02-02',
      },
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: true,
      },
      fiduciaries: {
        pr_primary: 'Emily Executor',
        dpoa_primary: 'Paula Agent',
        hcp_primary: 'Henry Healthcare',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_dpoa_primary: 'Sloane Spouse Agent',
        spouse_hcp_primary: 'Harper Spouse Proxy',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual([
      'pourover-will',
      'spouse-pourover-will',
      'incapacity-documents',
      'spouse-incapacity-documents',
      'estate-plan-summary',
    ])
    expect(result.files.map(file => file.name)).toEqual([
      '01-pourover-will.docx',
      '02-spouse-pourover-will.docx',
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
      '05-spouse-durable-power-of-attorney.docx',
      '06-spouse-health-care-proxy.docx',
      '07-spouse-living-will.docx',
      '08-spouse-hipaa-authorization.docx',
      '00-estate-plan-summary.docx',
    ])

    const spousePouroverXml = xmlFromDocx(result.files[1].buffer)
    const spouseIncapacityXml = result.files.slice(6).map(file => xmlFromDocx(file.buffer)).join('\n')

    expect(spousePouroverXml).toContain('JOHN EXAMPLE')
    expect(spousePouroverXml).toContain('SPENCER SPOUSE EXECUTOR')
    expect(spouseIncapacityXml).toContain('JOHN EXAMPLE')
    expect(spouseIncapacityXml).toContain('SLOANE SPOUSE AGENT')
    expect(spouseIncapacityXml).toContain('HARPER SPOUSE PROXY')
    expect(spouseIncapacityXml).not.toContain('{{')
    expect(spouseIncapacityXml).not.toContain('{%')
    expect(result.warnings).not.toContain(
      'Spouse companion pour-over wills and incapacity documents are not generated separately yet; review the output before relying on it as a complete married-couple package.',
    )
  })

  it('supports parental guardian appointment generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        minor_children: true,
      },
      children: [
        {
          full_name: 'Alex Example',
          dob: '2012-01-01',
          relationship: 'biological',
          minor: true,
        },
        {
          full_name: 'Blake Example',
          dob: '2014-02-02',
          relationship: 'adopted',
          minor: true,
        },
      ],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: true,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
        guardian_successor: 'Backup Guardian',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['parental-guardian-appointment', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-parental-appointment-of-guardian.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(result.missing).toEqual([])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('PARENTAL APPOINTMENT OF GUARDIAN')
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('ALEX EXAMPLE')
    expect(xml).toContain('BLAKE EXAMPLE')
    expect(xml).toContain('GRACE GUARDIAN')
    expect(xml).toContain('BACKUP GUARDIAN')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT')
    expect(xml).not.toContain('[CHILD')
    expect(result.warnings).toEqual([])
  })

  it('supports young adult estate plan generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        dob: '1972-02-02',
      },
      children: [
        {
          full_name: 'Alex Example',
          dob: '2008-06-08',
          relationship: 'biological',
          minor: false,
        },
      ],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        include_young_adult_estate_plan: true,
        spouse_docs: false,
      },
      trust: null,
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['young-adult-estate-plan', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '09-young-adult-estate-plan.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(result.files[0].owner).toBe('Alex Example')
    expect(result.missing).toEqual([])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('LAST WILL AND TESTAMENT OF ALEX EXAMPLE')
    expect(xml).toContain('JANE EXAMPLE and JOHN EXAMPLE')
    expect(xml).toContain('GENERAL DURABLE POWER OF ATTORNEY OF ALEX EXAMPLE')
    expect(xml).toContain('HEALTH CARE PROXY FOR ALEX EXAMPLE')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[[ MISSING:')
  })

  it('generates the existing incapacity documents package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-incapacity.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'incapacity-documents',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('incapacity-documents')
    expect(result.files.map(file => file.name)).toEqual([
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
    ])
    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])

    const xml = result.files.map(file => xmlFromDocx(file.buffer)).join('\n')
    expect(xml).toContain('JANE EXAMPLE')
    expect(xml).toContain('PAULA AGENT')
    expect(xml).toContain('HENRY HEALTHCARE')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[CLIENT]')
  })

  it('renders DPOA co-agent, self-dealing reviewer, and Section L choices from the draft payload', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
      },
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        dpoa_primary: 'Paula Agent',
        dpoa_co_agent: 'Carl Coagent',
        hcp_primary: 'Henry Healthcare',
      },
      dpoa_provisions: {
        coagent_manner: 'majority',
        self_dealing_reviewer: 'Riley Reviewer',
        self_dealing_reviewer_alt: 'Avery Alternate Reviewer',
        include_section_l: true,
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['incapacity-documents', 'estate-plan-summary'])
    expect(result.files[0].name).toBe('01-durable-power-of-attorney.docx')

    const dpoaXml = xmlFromDocx(result.files[0].buffer)

    expect(dpoaXml).toContain('PAULA AGENT')
    expect(dpoaXml).toContain('CARL COAGENT')
    expect(dpoaXml).toContain('majority decision')
    expect(dpoaXml).toContain('RILEY REVIEWER')
    expect(dpoaXml).toContain('AVERY ALTERNATE REVIEWER')
    expect(dpoaXml).toContain('CARE IN PROXIMITY OF SPOUSE AND FOR BENEFIT OF SPOUSE')
    expect(dpoaXml).not.toContain('each Attorney-in-Fact may act separately and independently')
    expect(dpoaXml).not.toContain('{{')
    expect(dpoaXml).not.toContain('{%')
  })

  it('renders HCP anatomical gift and HIPAA psychotherapy choices from the draft payload', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        dpoa_primary: 'Paula Agent',
        hcp_primary: 'Henry Healthcare',
      },
      hcp_provisions: {
        anatomical_gift: 'specified',
        anatomical_specified: 'Corneas for transplant and research',
      },
      hipaa_provisions: {
        psychotherapy_notes: 'authorize',
      },
    }))

    if (!result.ok) throw new Error(result.error)

    expect(result.packageNames).toEqual(['incapacity-documents', 'estate-plan-summary'])

    const hcpXml = xmlFromDocx(result.files[1].buffer)
    const hipaaXml = xmlFromDocx(result.files[3].buffer)

    expect(hcpXml).toContain('Corneas for transplant and research')
    expect(hcpXml).toContain('for the purposes stated')
    expect(hcpXml).not.toContain('My gift is for any purpose')
    expect(hcpXml).not.toContain('{{')
    expect(hcpXml).not.toContain('{%')

    expect(hipaaXml).toContain('mental illness, psychotherapy notes, chemical or alcohol dependency')
    expect(hipaaXml).not.toContain('except psychotherapy notes')
    expect(hipaaXml).not.toContain('{{')
    expect(hipaaXml).not.toContain('{%')
  })

  it('generates the existing joint trust package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-joint-trust.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'joint-trust',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('joint-trust')
    expect(result.files.map(file => file.name)).toEqual(['01-joint-revocable-trust.docx'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('EXAMPLE FAMILY TRUST')
    expect(xml).toContain('ALEX EXAMPLE')
    expect(xml).toContain('JORDAN EXAMPLE')
    expect(xml).toContain('CASEY TRUSTEE')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
    expect(xml).not.toContain('[Double-Click')
  })

  it('generates the existing simplified joint trust package without unresolved markers', async () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(root, 'examples/client-ma-joint-trust-simplified.json'), 'utf8'),
    ) as Record<string, unknown>

    const result = await generateNodeEstatePackage({
      data,
      packageName: 'joint-trust-simplified',
      state: 'MA',
      root,
      allowDraft: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)

    expect(result.packageName).toBe('joint-trust-simplified')
    expect(result.files.map(file => file.name)).toEqual(['01-simplified-joint-revocable-trust.docx'])

    const xml = xmlFromDocx(result.files[0].buffer)
    expect(xml).toContain('EXAMPLE FAMILY TRUST')
    expect(xml).toContain('ALEX EXAMPLE')
    expect(xml).toContain('JORDAN EXAMPLE')
    expect(xml).toContain('QUINN SUCCESSOR')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('{%')
  })

  it('supports incapacity-only generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        include_parental_appointment: false,
        include_temp_delegation: false,
        spouse_docs: false,
      },
      fiduciaries: {
        dpoa_primary: 'Paula Agent',
        dpoa_co_agent: 'Carl Coagent',
        dpoa_successor: null,
        hcp_primary: 'Henry Healthcare',
        hcp_primary_address: '456 Care Street, Boston, MA',
        hcp_successor: 'Alice Alternate',
        hcp_successor_address: '789 Backup Avenue, Cambridge, MA',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['incapacity-documents', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
      '00-estate-plan-summary.docx',
    ])
  })

  it('supports married joint trust generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        type: 'married_joint',
      },
      spouse: {
        first_name: 'Jordan',
        last_name: 'Example',
        full_name: 'Jordan Example',
        dob: '1972-02-02',
      },
      fiduciaries: {
        trustee_initial: 'Casey Trustee',
        trustee_successor: 'Quinn Successor',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['joint-trust', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-joint-revocable-trust.docx',
      '00-estate-plan-summary.docx',
    ])
  })

  it('supports simplified married joint trust generation through the app-level Node entry point', async () => {
    const result = await generateEstatePlanDocumentsNode(draftPayload({
      matter: {
        type: 'married_joint',
      },
      spouse: {
        first_name: 'Jordan',
        last_name: 'Example',
        full_name: 'Jordan Example',
        dob: '1972-02-02',
      },
      trust: {
        separate_trusts: true,
      },
      fiduciaries: {
        trustee_initial: 'Casey Trustee',
        trustee_successor: 'Quinn Successor',
      },
    }))

    if (!result.ok) throw new Error(result.error)
    expect(result.packageNames).toEqual(['joint-trust-simplified', 'estate-plan-summary'])
    expect(result.files.map(file => file.name)).toEqual([
      '01-simplified-joint-revocable-trust.docx',
      '00-estate-plan-summary.docx',
    ])
  })
})
