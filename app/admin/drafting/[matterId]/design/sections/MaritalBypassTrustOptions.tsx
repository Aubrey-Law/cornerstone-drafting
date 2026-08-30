'use client'

import { Input } from '@/components/ui/input'
import {
  createsBypassTrust,
  createsMaritalTrust,
  getTrustDetails,
  setTrustDetails,
  type BypassTrustFormula,
  type BypassTrustType,
  type MaritalTrustInvasion,
  type MaritalTrustType,
  type TrustRemainderPowerOfAppointment,
} from '@/lib/designSheetTrustDetails'
import {
  AttorneyNoteBanner,
  DecisionRow,
  DesignSheetCheckboxOption,
  FieldLabel,
  SectionBlock,
  SectionHelp,
  type DecisionRowOption,
  type SectionProps,
} from './shared'

/**
 * Marital and bypass trust options — what becomes of the deceased spouse's
 * share at the first death.
 *
 * Both plan shapes ask the same questions and write the same `trust_details`
 * keys; only the wording and a couple of the option lists differ, so `variant`
 * selects the copy rather than the storage:
 *
 * - `joint`: a joint revocable trust, where the survivor's own property
 *   continues as the Survivor's Trust and these decide what is carved out of
 *   the deceased settlor's share first.
 * - `separate`: a married client's own trust that distributes in trust for the
 *   spouse, where these decide the shape of that spouse's trust.
 *
 * `is_joint` picks the variant, so the two never render together and one stored
 * answer set can serve both — toggling `is_joint` keeps the decisions.
 *
 * Kept out of TrustDetailsSection.tsx, which is already past a thousand lines
 * (see docs/design-sheet-sections/trust-details.md).
 *
 * Every option list is typed against its union, so a value that drifts from the
 * type is a compile error rather than a radio nobody can ever select.
 */

export type MaritalBypassVariant = 'joint' | 'separate'

const MARITAL_TRUST_OPTIONS: Record<
  MaritalBypassVariant,
  readonly DecisionRowOption<MaritalTrustType>[]
> = {
  joint: [
    {
      value: 'none',
      label: 'None',
      description: 'Do not create a separate marital deduction trust.',
    },
    {
      value: 'general_power_of_appointment',
      label: 'General Power of Appointment Trust',
      description:
        "The survivor is the sole beneficiary. On the survivor's death, the Marital Trust distributes as the surviving settlor appoints in their will. If they do not exercise the power of appointment, it distributes according to the trust terms.",
    },
    {
      value: 'qtip',
      label: 'Qualified Terminable Interest Property Trust (QTIP)',
      description:
        "The survivor is the sole beneficiary. On the survivor's death, the Marital Trust distributes according to the trust terms.",
    },
  ],
  separate: [
    {
      value: 'qtip',
      label: 'Qualified Terminable Interest Property Trust (QTIP)',
      description:
        'For a married couple, a QTIP allows the deceased spouse to defer taxes on property given to the surviving spouse, while retaining control over the final distribution.',
    },
    {
      value: 'general_power_of_appointment',
      label: 'General Power of Appointment Trust',
      description:
        'This trust allows the surviving spouse to receive property with some restrictions and creditor protection during their lifetime, but gives them the ability to appoint where the property goes on their death.',
    },
    {
      value: 'none',
      label: 'No Marital Trust',
      description:
        "Don't create a marital trust for the surviving spouse. (Select this if the client wishes to create only a bypass/credit shelter trust.)",
    },
  ],
}

/** Identical in both variants — the invasion ladder does not depend on plan shape. */
const MARITAL_TRUST_INVASION_OPTIONS: readonly DecisionRowOption<MaritalTrustInvasion>[] = [
  {
    value: 'no_invasion',
    label: 'No Invasion',
    description:
      "The surviving spouse has no enforceable right to principal, but the trustee may distribute principal for the surviving spouse's health, education, maintenance, and support.",
  },
  {
    value: 'hems',
    label: 'Invasion for HEMS',
    description:
      'The surviving spouse may invade Marital Trust principal for their health, education, maintenance, and support.',
  },
  {
    value: 'five_by_five',
    label: '"5 by 5" Invasion Power',
    description:
      'The surviving spouse may withdraw the greater of $5,000 or 5% of the principal each year, in addition to HEMS distributions.',
  },
  {
    value: 'complete',
    label: 'Complete Invasion Power',
    description: 'The surviving spouse may withdraw any amount of principal for any reason.',
  },
]

/** Same two answers for the marital and the bypass trust; only the trust named differs. */
function remainderPowerOptions(
  trustLabel: string,
): readonly DecisionRowOption<TrustRemainderPowerOfAppointment>[] {
  return [
    {
      value: 'none',
      label: 'No appointment power',
      description: "The trust controls who receives property left at the surviving spouse's death.",
    },
    {
      value: 'limited_testamentary',
      label: 'Limited testamentary power',
      description: `The surviving spouse may redirect property remaining in the ${trustLabel} at death only among selected permitted appointees.`,
    },
  ]
}

const BYPASS_TRUST_OPTIONS: Record<
  MaritalBypassVariant,
  readonly DecisionRowOption<BypassTrustType>[]
> = {
  joint: [
    {
      value: 'none',
      label: 'None',
      description: 'Do not create a bypass trust.',
    },
    {
      value: 'bypass',
      label: 'Bypass Trust (A/B)',
      description:
        "Create a (formula or non-formula) bypass trust that will hold a predetermined share of the deceased settlor's assets. The rest will go to the Marital Trust (if created), or otherwise to the Survivor's Trust.",
    },
    {
      value: 'disclaimer',
      label: 'Contingent Disclaimer Trust',
      description:
        'Provide for a contingent disclaimer trust to be created to hold any property disclaimed by the surviving settlor, if the surviving settlor disclaims property.',
    },
  ],
  separate: [
    {
      value: 'bypass',
      label: 'Bypass/Credit-Shelter Trust',
      description:
        "This trust uses the client's estate tax deduction, and bypasses the surviving spouse's estate. Unlike a Marital Trust, it can benefit people other than the surviving spouse (e.g. by sprinkling to children).",
    },
    {
      value: 'disclaimer',
      label: 'Disclaimer Trust',
      description:
        'The Disclaimer Trust is a bypass trust that is created only if the surviving spouse disclaims assets that they would otherwise inherit. These assets go into the Disclaimer Trust instead of passing directly to the presumptive beneficiaries.',
    },
    {
      value: 'none',
      label: 'No Bypass Trust',
      description: "Don't create any bypass trust.",
    },
  ],
}

const FORMULA_OPTIONS: Record<string, DecisionRowOption<BypassTrustFormula>> = {
  all_assets: {
    value: 'all_assets',
    label: 'All Assets',
    description:
      'Put all remaining assets into the bypass trust (select this option if not creating a Marital Trust).',
  },
  formula: {
    value: 'formula',
    label: 'Formula',
    description:
      'Use a formula to determine the amount of assets to hold in the bypass trust. The formula is the largest amount that can pass free of federal estate tax.',
  },
  fixed_amount: {
    value: 'fixed_amount',
    label: 'Fixed Amount',
    description: 'Place a fixed dollar amount of assets in the bypass trust.',
  },
  percentage: {
    value: 'percentage',
    label: 'Percentage',
    description: 'Place a percentage of the remaining assets in the bypass trust.',
  },
  clayton_election: {
    value: 'clayton_election',
    label: 'Clayton Election',
    description:
      'Use a Clayton election to allow the personal representative to decide how to split assets between marital and bypass trusts.',
  },
}

/**
 * "All assets" only exists where the whole share can go to the bypass trust, so
 * a marital trust rules it out; it is disabled rather than dropped so the reason
 * stays on screen. The joint sheet does not offer it at all — a joint trust
 * always leaves the survivor's own half outside the division.
 */
function bypassFormulaOptions(
  variant: MaritalBypassVariant,
  hasMaritalTrust: boolean,
): readonly DecisionRowOption<BypassTrustFormula>[] {
  const order: BypassTrustFormula[] = variant === 'joint'
    ? ['clayton_election', 'formula', 'fixed_amount', 'percentage']
    : ['all_assets', 'formula', 'fixed_amount', 'percentage', 'clayton_election']

  return order.map(key => (
    key === 'all_assets' && hasMaritalTrust
      ? { ...FORMULA_OPTIONS[key], disabled: true }
      : FORMULA_OPTIONS[key]
  ))
}

/** Blank clears the amount rather than storing 0 — "unanswered" and "zero" are different answers. */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function MaritalBypassTrustOptions({
  sheet,
  onChange,
  variant,
}: Pick<SectionProps, 'sheet' | 'onChange'> & { variant: MaritalBypassVariant }) {
  const details = getTrustDetails(sheet)
  const update = (patch: Parameters<typeof setTrustDetails>[1]) =>
    onChange('decisions', prevSheet => setTrustDetails(prevSheet, patch))

  const joint = variant === 'joint'
  const hasMaritalTrust = createsMaritalTrust(details.marital_trust)
  const hasBypassTrust = createsBypassTrust(details.bypass_trust)
  // Only the mandatory bypass trust has a share to size. A disclaimer trust is
  // funded by whatever the survivor disclaims, so it has no formula, no
  // predetermined remainder, and nothing to ask here.
  const sizesBypassShare = details.bypass_trust === 'bypass'
  const formula = details.bypass_trust_formula
  const sprinklingSource = details.bypass_trust === 'disclaimer' ? 'Disclaimer Trust' : 'Bypass Trust'

  const maritalBlock = (
    <>
      <DecisionRow
        question={joint ? 'Marital Trust' : 'Marital Trust for the Spouse'}
        help={joint
          ? "If the settlors are married, you may create a separate marital deduction trust from all or a portion of the deceased settlor's share of the trust estate. (Property passing instead to the Survivor's Trust also qualifies for the marital deduction.)"
          : 'Select the type of Marital Trust to create for the spouse, if any.'}
        fieldName="marital_trust"
        value={details.marital_trust}
        options={MARITAL_TRUST_OPTIONS[variant]}
        onChange={value => update({ marital_trust: value })}
      />

      {hasMaritalTrust && (
        <DecisionRow
          question="Marital Trust Invasion Powers"
          help="Select the level of invasion powers the surviving spouse will have over the Marital Trust principal."
          fieldName="marital_trust_invasion"
          value={details.marital_trust_invasion}
          options={MARITAL_TRUST_INVASION_OPTIONS}
          onChange={value => update({ marital_trust_invasion: value })}
        />
      )}

      {/* A general power of appointment already lets the survivor redirect the
          remainder outright, so this question only arises for a QTIP. */}
      {details.marital_trust === 'qtip' && (
        <DecisionRow
          question="QTIP Remainder Power of Appointment"
          help="Optionally let the surviving spouse redirect the Marital Trust remainder at death by a limited testamentary power of appointment."
          fieldName="marital_trust_remainder_power"
          value={details.marital_trust_remainder_power}
          options={remainderPowerOptions('Marital Trust')}
          onChange={value => update({ marital_trust_remainder_power: value })}
        />
      )}

      {hasMaritalTrust && (
        <div className="mt-4">
          <DesignSheetCheckboxOption
            label="Include QDOT Language"
            description="Add QDOT (Qualified Domestic Trust) language to defer estate tax for a non-citizen spouse."
            checked={details.marital_trust_include_qdot}
            onChange={checked => update({ marital_trust_include_qdot: checked })}
          />
        </div>
      )}
    </>
  )

  const bypassBlock = (
    <>
      <DecisionRow
        question={joint ? 'Bypass Trust' : 'Bypass Trust for the Spouse'}
        help={joint
          ? "Whether or not a marital deduction trust is created, you may create a bypass trust, which will hold property that should be excluded from the surviving settlor's estate."
          : 'Select the type of Bypass Trust to create for the spouse, if any. If no marital trust is created, you must create a credit-shelter trust instead.'}
        fieldName="bypass_trust"
        value={details.bypass_trust}
        options={BYPASS_TRUST_OPTIONS[variant].map(option => (
          // Leaving the spouse neither trust is not a plan — one of the two has
          // to hold the share. Disabling the option says so where the attorney
          // is looking, instead of failing later in readiness.
          option.value === 'none' && !hasMaritalTrust && details.marital_trust !== null
            ? { ...option, disabled: true }
            : option
        ))}
        onChange={value => update({ bypass_trust: value })}
      />

      {sizesBypassShare && (
        <DecisionRow
          question="Bypass Trust Formula"
          help="Determine what portion of the assets should be allocated to the bypass trust."
          fieldName="bypass_trust_formula"
          value={formula}
          options={bypassFormulaOptions(variant, hasMaritalTrust)}
          onChange={value => update({ bypass_trust_formula: value })}
        />
      )}

      {sizesBypassShare && formula === 'fixed_amount' && (
        <div className="mt-4 max-w-xs">
          <FieldLabel>Fixed Amount</FieldLabel>
          <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
            Enter the fixed dollar amount of assets to hold in the bypass trust.
          </p>
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            value={details.bypass_trust_fixed_amount ?? ''}
            onChange={event => update({ bypass_trust_fixed_amount: parseAmount(event.target.value) })}
            className="bg-card border-border text-foreground"
          />
        </div>
      )}

      {sizesBypassShare && formula === 'percentage' && (
        <div className="mt-4 max-w-xs">
          <FieldLabel>Percentage</FieldLabel>
          <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
            Enter the percentage of the remaining assets to hold in the bypass trust.
          </p>
          <Input
            type="number"
            min={0}
            max={100}
            inputMode="decimal"
            value={details.bypass_trust_percentage ?? ''}
            onChange={event => update({ bypass_trust_percentage: parseAmount(event.target.value) })}
            className="bg-card border-border text-foreground"
          />
        </div>
      )}

      {sizesBypassShare && (
        <DecisionRow
          question="Bypass Trust Power of Appointment"
          help="Optionally let the surviving spouse redirect the Bypass Trust remainder at death by a limited testamentary power of appointment."
          fieldName="bypass_trust_remainder_power"
          value={details.bypass_trust_remainder_power}
          options={remainderPowerOptions('Bypass Trust')}
          onChange={value => update({ bypass_trust_remainder_power: value })}
        />
      )}

      {/* Hidden rather than disabled when no bypass trust exists: there is
          nothing to sprinkle from, and a stale `true` would otherwise ride along
          into the payload after the attorney backs out to "None". */}
      {hasBypassTrust && (
        <div className="mt-4">
          <DesignSheetCheckboxOption
            label={joint
              ? 'Allow Discretionary Sprinkling'
              : 'Should the Bypass Trust sprinkle to children/grandchildren?'}
            description={joint
              ? `This will allow discretionary sprinkling from the ${sprinklingSource} to children/grandchildren during the survivor's lifetime.`
              : 'If selected, the Bypass Trust or Disclaimer Trust will be set up to sprinkle to issue.'}
            checked={details.bypass_trust_allow_sprinkling}
            onChange={checked => update({ bypass_trust_allow_sprinkling: checked })}
          />
        </div>
      )}
    </>
  )

  // The joint sheet splits these across two headed blocks, mirroring the two
  // decisions a joint trust makes at the first death. The separate sheet keeps
  // them under one "Trust(s) for Spouse" heading, where they describe a single
  // spouse's trust.
  if (!joint) {
    return (
      <SectionBlock title="Trust(s) for Spouse">
        {maritalBlock}
        {bypassBlock}
      </SectionBlock>
    )
  }

  return (
    <>
      <SectionBlock title="Trusts for Survivor">
        <SectionHelp>
          The surviving settlor&rsquo;s property will continue to be held in trust as the Survivor&rsquo;s Trust.
          If no other trusts are created, all of the deceased settlor&rsquo;s property will be added to the
          Survivor&rsquo;s Trust. For married settlors, the Survivor&rsquo;s Trust is intended to qualify for the
          estate tax marital deduction.
        </SectionHelp>
        <AttorneyNoteBanner>
          In common-law (non-community-property) states, estate tax planning is more commonly handled in separate
          individual trusts rather than a joint trust. Consider whether separate trusts are a better fit. If you
          proceed with a joint trust, review the marital and bypass trust language carefully for tax implications
          under your state&rsquo;s law.
        </AttorneyNoteBanner>
        {maritalBlock}
      </SectionBlock>

      <SectionBlock title="Bypass Trust Options">{bypassBlock}</SectionBlock>
    </>
  )
}
