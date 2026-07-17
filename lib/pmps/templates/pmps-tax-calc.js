/**
 * pmps-tax-calc.js — Massachusetts estate tax calculator for PMPS.
 *
 * PURPOSE: eliminate hand-computed tax errors (e.g. putting GROSS where NET
 * belongs). Call computeMATax() and drop the result straight into data.tax.
 * All returned netTax figures are NET of the $99,600 unified credit.
 *
 * Methodology: references/ma-estate-tax-computation.md (pre-2001 IRC §2011
 * credit table, $2M exclusion, post-2023 anti-cliff credit, $4M shelter for the
 * both-exemptions scenarios). ALL figures are estimates pending M-706
 * verification.
 *
 * Usage:
 *   const { computeMATax } = require('./pmps-tax-calc');
 *   data.tax = computeMATax(6500000, "separate_clayton");
 */
'use strict';

const MA_EXEMPTION = 2000000;
const ADJUSTMENT   = 60000;     // §2011 adjusted-taxable-estate reduction
const UNIFIED_CREDIT = 99600;   // tax on $2,000,000 adjusted base
const SHELTER_4M   = 4000000;   // both exemptions preserved

// pre-2001 IRC §2011 credit brackets: [floor, ceiling, baseTax, marginalRate]
const BRACKETS = [
  [0,40000,0,0.000],[40000,90000,0,0.008],[90000,140000,400,0.016],
  [140000,240000,1200,0.024],[240000,440000,3600,0.032],[440000,640000,10000,0.040],
  [640000,840000,18000,0.048],[840000,1040000,27600,0.056],[1040000,1540000,38800,0.064],
  [1540000,2040000,70800,0.072],[2040000,2540000,106800,0.080],[2540000,3040000,146800,0.088],
  [3040000,3540000,190800,0.096],[3540000,4040000,238800,0.104],[4040000,5040000,290800,0.112],
  [5040000,6040000,402800,0.120],[6040000,7040000,522800,0.128],[7040000,8040000,650800,0.136],
  [8040000,9040000,786800,0.144],[9040000,10040000,930800,0.152],[10040000,Infinity,1082800,0.160],
];

const money = n => "$" + Math.round(n).toLocaleString();
const approx = n => {
  if (n >= 1000000) return "~$" + (Math.round(n / 100000) / 10) + " million";
  return "~$" + (Math.round(n / 1000) * 1000).toLocaleString();
};

// Core: compute one scenario's full breakdown for a given taxable estate.
function computeScenario(taxableEstate, label) {
  if (taxableEstate <= MA_EXEMPTION) {
    return {
      label, taxableEstate,
      adjustedTaxableEstate: Math.max(0, taxableEstate - ADJUSTMENT),
      bracketFloor: 0, bracketCeiling: 0, bracketRate: 0,
      baseTax: 0, excess: 0, taxOnExcess: 0,
      grossTax: 0, unifiedCredit: 0,
      netTax: 0, netTaxDisplay: money(0), netTaxApprox: "$0"
    };
  }
  const adj = taxableEstate - ADJUSTMENT;
  const b = BRACKETS.find(([f, c]) => adj >= f && adj < c);
  const [floor, ceiling, baseTax, rate] = b;
  const excess = adj - floor;
  const taxOnExcess = Math.round(excess * rate);
  const grossTax = baseTax + taxOnExcess;
  const netTax = Math.max(0, grossTax - UNIFIED_CREDIT);
  return {
    label, taxableEstate, adjustedTaxableEstate: adj,
    bracketFloor: floor, bracketCeiling: ceiling, bracketRate: rate,
    baseTax, excess, taxOnExcess,
    grossTax, unifiedCredit: UNIFIED_CREDIT,
    netTax, netTaxDisplay: money(netTax), netTaxApprox: approx(netTax)
  };
}

/**
 * computeMATax(grossEstate, planStructure)
 * Returns a fully-populated `tax` object ready for data.tax.
 *
 * planStructure:
 *   "joint_outright"    → scenario1 only (one exemption), scenario2 null
 *   "joint_disclaimer"  → scenario1 (no planning) + scenario2 ($4M shelter)
 *   "separate_clayton"  → scenario1 (no planning) + scenario2 ($4M shelter)
 *   "individual_single" → scenario1 only (one exemption), scenario2 null
 */
function computeMATax(grossEstate, planStructure) {
  if (typeof grossEstate !== "number" || grossEstate < 0)
    throw new Error("computeMATax: grossEstate must be a non-negative number");

  const sheltered = (planStructure === "joint_disclaimer" || planStructure === "separate_clayton");

  const s1Label = (planStructure === "individual_single") ? "At Death"
    : sheltered ? "Without Planning"
    : "At Second Death (one exemption used)";
  const scenario1 = computeScenario(grossEstate, s1Label);

  if (!sheltered) {
    return {
      scenario1, scenario2: null,
      savings: 0, savingsDisplay: "$0", savingsApprox: "$0"
    };
  }

  // Both-exemptions scenario: $0 at first death (credit offsets $2M),
  // second-death taxable = grossEstate − $4,000,000.
  const s2Label = (planStructure === "separate_clayton")
    ? "With Credit Shelter + Clayton Election"
    : "With Disclaimer Planning";
  const secondDeath = computeScenario(Math.max(0, grossEstate - SHELTER_4M), s2Label);
  const scenario2 = {
    label: s2Label,
    firstDeath: { bypassAmount: MA_EXEMPTION, grossTax: UNIFIED_CREDIT, credit: UNIFIED_CREDIT, netTax: 0 },
    secondDeath,
    totalNetTax: secondDeath.netTax,
    netTaxDisplay: money(secondDeath.netTax),
    netTaxApprox: approx(secondDeath.netTax)
  };
  const savings = scenario1.netTax - scenario2.totalNetTax;
  return {
    scenario1, scenario2,
    savings, savingsDisplay: money(savings), savingsApprox: approx(savings)
  };
}

module.exports = { computeMATax, computeScenario, MA_EXEMPTION, UNIFIED_CREDIT };
