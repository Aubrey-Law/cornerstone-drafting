/**
 * pmps-data-schema.js
 * Full data schema definition for all PMPS templates.
 * Copy and populate this object, then pass to each template function.
 *
 * Usage:
 *   const schema = require('./pmps-data-schema');
 *   // schema.SAMPLE                      → default couple example (separate_clayton)
 *   // schema.SAMPLES.joint_outright      → per-structure examples
 *   // schema.SAMPLES.joint_disclaimer
 *   // schema.SAMPLES.separate_clayton
 *   // schema.SAMPLES.individual_single
 *   // schema.EMPTY                       → blank template
 *
 * ─────────────────────────────────────────────────────────────────────────
 * plan.planStructure — master switch (added 2026). One of:
 *   "joint_outright"    couple, joint trust, outright to spouse, NO credit
 *                       shelter funded; one $2M exemption used (baseline).
 *   "joint_disclaimer"  couple, single joint trust; survivor MAY disclaim up to
 *                       $2M into a bypass trust within 9 months → both exemptions
 *                       ($4M) preserved IF the disclaimer is valid and timely.
 *   "separate_clayton"  couple, two separate trusts + credit shelter + Clayton
 *                       election (fiduciary-controlled); both exemptions ($4M)
 *                       preserved. Premium / most reliable.
 *   "individual_single" single person; no marital/CS/Clayton/QTIP; one $2M
 *                       exemption; single-death scenario; no spouse references.
 *
 * Backward compatibility: the top-level booleans (hasTrust, hasCreditShelter,
 * etc.) remain. Templates derive defaults from planStructure when present, but
 * existing data objects WITHOUT planStructure still render via the booleans.
 * See references/pmps-planstructure-mapping.md for the full toggle matrix.
 *
 * plan.clayton  — true ONLY for separate_clayton.
 * plan.maQtip   — true for joint_disclaimer AND separate_clayton.
 *
 * ALL tax dollar figures are ESTIMATES pending attorney M-706 verification.
 * netTax fields are NET of the $99,600 unified credit (see
 * references/ma-estate-tax-computation.md).
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ===========================================================================
 * SAMPLE — separate_clayton couple (also exported as schema.SAMPLE default)
 * Gross estate $6,500,000. Net-of-credit figures, $4M shelter at second death.
 * =========================================================================== */
const SAMPLE_SEPARATE_CLAYTON = {
  matter: {
    date: "May 2, 2026",
    filePrefix: "Chen",
    outputDir: "/path/to/OUTPUTS/Chen_PMPS/"
  },

  clients: {
    type: "couple",
    spouse1: { firstName: "David", lastName: "Chen", fullName: "David Chen",
               dob: "March 15, 1972", age: 54, citizenship: "US" },
    spouse2: { firstName: "Maria", lastName: "Santos-Chen", fullName: "Maria Santos-Chen",
               dob: "August 22, 1974", age: 51, citizenship: "US" },
    address: "45 Maple Street, Wellesley, MA 02481",
    county: "Norfolk County",
    marriedSince: "June 2005"
  },

  children: [
    { name: "Sophia Chen", dob: "January 10, 2012", age: 14, isMinor: true },
    { name: "Lucas Chen",  dob: "May 3, 2016",       age: 9,  isMinor: true }
  ],

  hasMinorChildren: true,
  hasLegalPlan: false,
  legalPlan: null,
  flatFee: "$9,500",

  hasTrust: true,
  hasCreditShelter: true,
  hasRealEstate: true,
  hasLifeInsurance: true,
  hasAnticipatedInheritance: false,
  hasPets: true,

  assets: {
    grossEstate: 6500000,
    grossEstateDisplay: "$6,500,000",
    grossEstateApprox: "$6.5 million",
    breakdown: [
      { category: "Primary Residence (net of mortgage)", value: 1800000, display: "$1,800,000" },
      { category: "401(k) — David",                      value: 1450000, display: "$1,450,000" },
      { category: "Brokerage Account",                    value: 2150000, display: "$2,150,000" },
      { category: "Savings",                              value: 600000,  display: "$600,000"   },
      { category: "Life Insurance (face value)",          value: 500000,  display: "$500,000"   }
    ]
  },

  tax: {
    scenario1: {
      label: "Without Planning",
      taxableEstate: 6500000,
      adjustedTaxableEstate: 6440000,
      bracketFloor: 6040000, bracketCeiling: 7040000, bracketRate: 0.128,
      baseTax: 522800, excess: 400000, taxOnExcess: 51200,
      grossTax: 574000, unifiedCredit: 99600,
      netTax: 474400, netTaxDisplay: "$474,400", netTaxApprox: "~$474,000"
    },
    scenario2: {
      label: "With Credit Shelter + Clayton Election",
      firstDeath: { bypassAmount: 2000000, grossTax: 99600, credit: 99600, netTax: 0 },
      secondDeath: {
        taxableEstate: 2500000,            // grossEstate - 4,000,000 (BOTH exemptions)
        adjustedTaxableEstate: 2440000,
        bracketFloor: 2040000, bracketCeiling: 2540000, bracketRate: 0.08,
        baseTax: 106800, excess: 400000, taxOnExcess: 32000,
        grossTax: 138800, unifiedCredit: 99600, netTax: 39200
      },
      totalNetTax: 39200, netTaxDisplay: "$39,200", netTaxApprox: "~$39,000"
    },
    savings: 435200, savingsDisplay: "$435,200", savingsApprox: "~$435,000"
  },

  plan: {
    planStructure: "separate_clayton",
    clayton: true,
    maQtip: true,
    type: "Separate Trusts with Credit Shelter (Clayton Election)",
    documents: [
      { name: "Revocable Living Trust", displayName: "Revocable Living Trust (David Chen Revocable Trust)",
        category: "core", forSpouse: 1 },
      { name: "Revocable Living Trust", displayName: "Revocable Living Trust (Maria Santos-Chen Revocable Trust)",
        category: "core", forSpouse: 2 },
      { name: "Pour-Over Will",                 category: "will",       perSpouse: true },
      { name: "Durable Power of Attorney",      category: "incapacity", perSpouse: true },
      { name: "Health Care Proxy",              category: "incapacity", perSpouse: true },
      { name: "HIPAA Authorization",            category: "incapacity", perSpouse: true },
      { name: "Advance Health Directive (Living Will)", category: "incapacity", perSpouse: true },
      { name: "Certificate of Trust",           category: "asset",      perSpouse: true },
      { name: "Quitclaim Deed",                 category: "asset",      joint: true },
      { name: "Parental Appointment of Guardian", category: "guardian", joint: true }
    ]
  },

  fiduciaries: {
    notes: [
      { label: "Coordinated QTIP Elections",
        body: "Federal and Massachusetts-only QTIP elections must be coordinated deliberately (see Shaffer, SJC-12812). Document the intended election at the first death." }
    ],
    spouse1: {
      initialTrustee: "David (self)",
      successorTrustees: ["Maria", "Ana Santos", "James Chen"],
      personalRep: "Maria, then Ana Santos",
      poaAgent: "Maria, then James Chen",
      poaSuccessor: "James Chen",
      hcpAgent: "Maria, then James Chen",
      hcpSuccessor: "James Chen",
      guardian: "Ana Santos (primary), James Chen (backup)"
    },
    spouse2: {
      initialTrustee: "Maria (self)",
      successorTrustees: ["David", "Ana Santos", "James Chen"],
      personalRep: "David, then Ana Santos",
      poaAgent: "David, then Ana Santos",
      poaSuccessor: "Ana Santos",
      hcpAgent: "David, then Ana Santos",
      hcpSuccessor: "Ana Santos",
      guardian: "Ana Santos (primary), James Chen (backup)"
    }
  },

  considerations: {
    pets: "Golden retriever named Bear — discuss pet trust provisions.",
    petName: "Bear",
    lifeInsurance: "David's $500K term policy — consider ILIT to remove from taxable estate.",
    anticipatedInheritance: null,
    businessInterest: "20% interest in a closely held company — review for situs and liquidity.",
    realEstateTransfer: "Primary residence to be transferred into the trusts via quitclaim deed.",
    beneficiaryDesignations: "Review 401(k) beneficiary designations to align with the trust plan.",
    youngAdultPlans: null,
    ilit: true,
    gifting: false,
    giftingNote: null
  },

  flags: []
};

/* ===========================================================================
 * joint_outright couple — baseline / minimal planning, NO credit shelter.
 * scenario2 = null, savings = 0. Same $6.5M estate to show lost-exemption cost.
 * =========================================================================== */
const SAMPLE_JOINT_OUTRIGHT = {
  matter: { date: "May 2, 2026", filePrefix: "Okafor", outputDir: "/path/to/OUTPUTS/Okafor_PMPS/" },
  clients: {
    type: "couple",
    spouse1: { firstName: "Daniel", lastName: "Okafor", fullName: "Daniel Okafor",
               dob: "April 2, 1968", age: 58, citizenship: "US" },
    spouse2: { firstName: "Grace", lastName: "Okafor", fullName: "Grace Okafor",
               dob: "July 19, 1970", age: 55, citizenship: "US" },
    address: "12 Birch Lane, Needham, MA 02492",
    county: "Norfolk County",
    marriedSince: "September 1998"
  },
  children: [
    { name: "Chioma Okafor", dob: "March 1, 2000", age: 26, isMinor: false },
    { name: "Emeka Okafor",  dob: "June 14, 2003", age: 22, isMinor: false }
  ],
  hasMinorChildren: false,
  hasLegalPlan: false,
  legalPlan: null,
  flatFee: "$6,500",
  hasTrust: true,
  hasCreditShelter: false,
  hasRealEstate: true,
  hasLifeInsurance: false,
  hasAnticipatedInheritance: false,
  hasPets: false,
  assets: {
    grossEstate: 6500000,
    grossEstateDisplay: "$6,500,000",
    grossEstateApprox: "$6.5 million",
    breakdown: [
      { category: "Primary Residence (net of mortgage)", value: 1900000, display: "$1,900,000" },
      { category: "Retirement Accounts",                  value: 2200000, display: "$2,200,000" },
      { category: "Brokerage Account",                    value: 1900000, display: "$1,900,000" },
      { category: "Savings",                              value: 500000,  display: "$500,000"   }
    ]
  },
  tax: {
    scenario1: {
      label: "At Second Death (one exemption used)",
      taxableEstate: 6500000,
      adjustedTaxableEstate: 6440000,
      bracketFloor: 6040000, bracketCeiling: 7040000, bracketRate: 0.128,
      baseTax: 522800, excess: 400000, taxOnExcess: 51200,
      grossTax: 574000, unifiedCredit: 99600,
      netTax: 474400, netTaxDisplay: "$474,400", netTaxApprox: "~$474,000"
    },
    scenario2: null,
    savings: 0, savingsDisplay: "$0", savingsApprox: "$0"
  },
  plan: {
    planStructure: "joint_outright",
    clayton: false,
    maQtip: false,
    type: "Joint Trust, Outright to Surviving Spouse (no credit shelter)",
    documents: [
      { name: "Joint Revocable Living Trust", displayName: "Joint Revocable Living Trust (Okafor Family Trust)",
        category: "core", joint: true },
      { name: "Pour-Over Will",            category: "will",       perSpouse: true },
      { name: "Durable Power of Attorney", category: "incapacity", perSpouse: true },
      { name: "Health Care Proxy",         category: "incapacity", perSpouse: true },
      { name: "HIPAA Authorization",       category: "incapacity", perSpouse: true },
      { name: "Advance Health Directive (Living Will)", category: "incapacity", perSpouse: true },
      { name: "Certificate of Trust",      category: "asset",      joint: true },
      { name: "Quitclaim Deed",            category: "asset",      joint: true }
    ]
  },
  fiduciaries: {
    notes: null,
    spouse1: {
      initialTrustee: "Daniel (self)",
      successorTrustees: ["Grace", "Chioma Okafor"],
      personalRep: "Grace, then Chioma Okafor",
      poaAgent: "Grace, then Chioma Okafor",
      hcpAgent: "Grace, then Chioma Okafor",
      guardian: null
    },
    spouse2: {
      initialTrustee: "Grace (self)",
      successorTrustees: ["Daniel", "Chioma Okafor"],
      personalRep: "Daniel, then Chioma Okafor",
      poaAgent: "Daniel, then Chioma Okafor",
      hcpAgent: "Daniel, then Chioma Okafor",
      guardian: null
    }
  },
  considerations: {
    pets: null, petName: null,
    lifeInsurance: null,
    anticipatedInheritance: null,
    realEstateTransfer: "Primary residence to be transferred into the joint trust via quitclaim deed.",
    beneficiaryDesignations: "Review retirement beneficiary designations.",
    youngAdultPlans: { name: "Emeka Okafor", age: 22, school: "in college" },
    ilit: false,
    gifting: false,
    giftingNote: null
  },
  flags: ["Baseline structure: first spouse's $2M Massachusetts exemption is NOT preserved. Quantify lost-exemption exposure and present credit-shelter alternatives."]
};

/* ===========================================================================
 * joint_disclaimer couple — single joint trust, disclaimer planning.
 * scenario2 uses $4M shelter (both exemptions) BUT contingent on a valid,
 * timely disclaimer by the survivor.
 * =========================================================================== */
const SAMPLE_JOINT_DISCLAIMER = {
  matter: { date: "May 2, 2026", filePrefix: "Romano", outputDir: "/path/to/OUTPUTS/Romano_PMPS/" },
  clients: {
    type: "couple",
    spouse1: { firstName: "Anthony", lastName: "Romano", fullName: "Anthony Romano",
               dob: "October 8, 1965", age: 60, citizenship: "US" },
    spouse2: { firstName: "Linda", lastName: "Romano", fullName: "Linda Romano",
               dob: "February 11, 1967", age: 59, citizenship: "US" },
    address: "8 Hillcrest Road, Newton, MA 02459",
    county: "Middlesex County",
    marriedSince: "May 1992"
  },
  children: [
    { name: "Marco Romano", dob: "December 3, 1995", age: 30, isMinor: false }
  ],
  hasMinorChildren: false,
  hasLegalPlan: false,
  legalPlan: null,
  flatFee: "$7,500",
  hasTrust: true,
  hasCreditShelter: true,
  hasRealEstate: true,
  hasLifeInsurance: false,
  hasAnticipatedInheritance: false,
  hasPets: false,
  assets: {
    grossEstate: 6500000,
    grossEstateDisplay: "$6,500,000",
    grossEstateApprox: "$6.5 million",
    breakdown: [
      { category: "Primary Residence (net of mortgage)", value: 2100000, display: "$2,100,000" },
      { category: "Retirement Accounts",                  value: 1900000, display: "$1,900,000" },
      { category: "Brokerage Account",                    value: 2000000, display: "$2,000,000" },
      { category: "Savings",                              value: 500000,  display: "$500,000"   }
    ]
  },
  tax: {
    scenario1: {
      label: "Without Planning",
      taxableEstate: 6500000,
      adjustedTaxableEstate: 6440000,
      bracketFloor: 6040000, bracketCeiling: 7040000, bracketRate: 0.128,
      baseTax: 522800, excess: 400000, taxOnExcess: 51200,
      grossTax: 574000, unifiedCredit: 99600,
      netTax: 474400, netTaxDisplay: "$474,400", netTaxApprox: "~$474,000"
    },
    scenario2: {
      label: "With Disclaimer Planning",
      firstDeath: { bypassAmount: 2000000, grossTax: 99600, credit: 99600, netTax: 0 },
      secondDeath: {
        taxableEstate: 2500000,            // grossEstate - 4,000,000 (BOTH exemptions)
        adjustedTaxableEstate: 2440000,
        bracketFloor: 2040000, bracketCeiling: 2540000, bracketRate: 0.08,
        baseTax: 106800, excess: 400000, taxOnExcess: 32000,
        grossTax: 138800, unifiedCredit: 99600, netTax: 39200
      },
      totalNetTax: 39200, netTaxDisplay: "$39,200", netTaxApprox: "~$39,000"
    },
    savings: 435200, savingsDisplay: "$435,200", savingsApprox: "~$435,000"
  },
  plan: {
    planStructure: "joint_disclaimer",
    clayton: false,
    maQtip: true,
    type: "Joint Trust with Disclaimer Planning",
    documents: [
      { name: "Joint Revocable Living Trust",
        displayName: "Joint Revocable Living Trust with Disclaimer Provisions (Romano Family Trust)",
        category: "core", joint: true },
      { name: "Pour-Over Will",            category: "will",       perSpouse: true },
      { name: "Durable Power of Attorney", category: "incapacity", perSpouse: true },
      { name: "Health Care Proxy",         category: "incapacity", perSpouse: true },
      { name: "HIPAA Authorization",       category: "incapacity", perSpouse: true },
      { name: "Advance Health Directive (Living Will)", category: "incapacity", perSpouse: true },
      { name: "Certificate of Trust",      category: "asset",      joint: true },
      { name: "Quitclaim Deed",            category: "asset",      joint: true }
    ]
  },
  fiduciaries: {
    notes: [
      { label: "Disclaimer Dependency",
        body: "The credit shelter is funded only if the surviving spouse executes a qualified disclaimer within 9 months and does not accept benefits or control of the disclaimed assets. If not, the plan reverts to the one-exemption (outright) result." }
    ],
    spouse1: {
      initialTrustee: "Anthony (self)",
      successorTrustees: ["Linda", "Marco Romano"],
      personalRep: "Linda, then Marco Romano",
      poaAgent: "Linda, then Marco Romano",
      hcpAgent: "Linda, then Marco Romano",
      guardian: null
    },
    spouse2: {
      initialTrustee: "Linda (self)",
      successorTrustees: ["Anthony", "Marco Romano"],
      personalRep: "Anthony, then Marco Romano",
      poaAgent: "Anthony, then Marco Romano",
      hcpAgent: "Anthony, then Marco Romano",
      guardian: null
    }
  },
  considerations: {
    pets: null, petName: null,
    lifeInsurance: null,
    anticipatedInheritance: null,
    realEstateTransfer: "Primary residence to be transferred into the joint trust via quitclaim deed.",
    beneficiaryDesignations: "Review retirement beneficiary designations.",
    youngAdultPlans: null,
    ilit: false,
    gifting: false,
    giftingNote: null
  },
  flags: ["Disclaimer planning is survivor-dependent. Emphasize the 9-month deadline and the consequence of failure to disclaim."]
};

/* ===========================================================================
 * individual_single — single person, one $2M exemption, single-death scenario.
 * spouse2 = null, scenario2 = null, no credit shelter / Clayton / QTIP.
 * =========================================================================== */
const SAMPLE_INDIVIDUAL_SINGLE = {
  matter: { date: "May 2, 2026", filePrefix: "Whitman", outputDir: "/path/to/OUTPUTS/Whitman_PMPS/" },
  clients: {
    type: "individual",
    spouse1: { firstName: "Eleanor", lastName: "Whitman", fullName: "Eleanor Whitman",
               dob: "November 30, 1958", age: 67, citizenship: "US" },
    spouse2: null,
    address: "55 Walnut Street, Brookline, MA 02445",
    county: "Norfolk County",
    marriedSince: null
  },
  children: [
    { name: "Theodore Whitman", dob: "August 5, 1990", age: 35, isMinor: false }
  ],
  hasMinorChildren: false,
  hasLegalPlan: false,
  legalPlan: null,
  flatFee: "$5,500",
  hasTrust: true,
  hasCreditShelter: false,
  hasRealEstate: true,
  hasLifeInsurance: false,
  hasAnticipatedInheritance: false,
  hasPets: true,
  assets: {
    grossEstate: 3200000,
    grossEstateDisplay: "$3,200,000",
    grossEstateApprox: "$3.2 million",
    breakdown: [
      { category: "Primary Residence (net of mortgage)", value: 1100000, display: "$1,100,000" },
      { category: "Retirement Accounts",                  value: 1200000, display: "$1,200,000" },
      { category: "Brokerage Account",                    value: 700000,  display: "$700,000"   },
      { category: "Savings",                              value: 200000,  display: "$200,000"   }
    ]
  },
  tax: {
    scenario1: {
      label: "At Death",
      taxableEstate: 3200000,
      adjustedTaxableEstate: 3140000,
      bracketFloor: 3040000, bracketCeiling: 3540000, bracketRate: 0.096,
      baseTax: 190800, excess: 100000, taxOnExcess: 9600,
      grossTax: 200400, unifiedCredit: 99600,
      netTax: 100800, netTaxDisplay: "$100,800", netTaxApprox: "~$101,000"
    },
    scenario2: null,
    savings: 0, savingsDisplay: "$0", savingsApprox: "$0"
  },
  plan: {
    planStructure: "individual_single",
    clayton: false,
    maQtip: false,
    type: "Individual Revocable Trust",
    documents: [
      { name: "Revocable Living Trust", displayName: "Revocable Living Trust (Eleanor Whitman Revocable Trust)",
        category: "core" },
      { name: "Pour-Over Will",            category: "will" },
      { name: "Durable Power of Attorney", category: "incapacity" },
      { name: "Health Care Proxy",         category: "incapacity" },
      { name: "HIPAA Authorization",       category: "incapacity" },
      { name: "Advance Health Directive (Living Will)", category: "incapacity" },
      { name: "Certificate of Trust",      category: "asset" },
      { name: "Quitclaim Deed",            category: "asset" }
    ]
  },
  fiduciaries: {
    notes: null,
    spouse1: {
      initialTrustee: "Eleanor (self)",
      successorTrustees: ["Theodore Whitman", "First Republic Trust Co."],
      personalRep: "Theodore Whitman",
      poaAgent: "Theodore Whitman",
      hcpAgent: "Theodore Whitman",
      guardian: null
    },
    spouse2: null
  },
  considerations: {
    pets: "Cat named Pepper — discuss pet trust provisions.",
    petName: "Pepper",
    lifeInsurance: null,
    anticipatedInheritance: null,
    realEstateTransfer: "Primary residence to be transferred into the trust via quitclaim deed.",
    beneficiaryDesignations: "Review retirement beneficiary designations to align with the trust plan.",
    youngAdultPlans: null,
    ilit: false,
    gifting: true,
    giftingNote: null
  },
  flags: ["Single client over the $2M threshold. Discuss lifetime strategies (gifting, charitable, ILIT). No marital/credit-shelter machinery applies."]
};

/* Default SAMPLE = the premium structure. */
const SAMPLE = SAMPLE_SEPARATE_CLAYTON;

const SAMPLES = {
  joint_outright:    SAMPLE_JOINT_OUTRIGHT,
  joint_disclaimer:  SAMPLE_JOINT_DISCLAIMER,
  separate_clayton:  SAMPLE_SEPARATE_CLAYTON,
  individual_single: SAMPLE_INDIVIDUAL_SINGLE
};

const EMPTY = {
  matter: { date: null, filePrefix: null, outputDir: null },
  clients: {
    type: null,
    spouse1: { firstName: null, lastName: null, fullName: null, dob: null, age: null, citizenship: null },
    spouse2: null,
    address: null, county: null, marriedSince: null
  },
  children: [],
  hasMinorChildren: false,
  hasLegalPlan: null, legalPlan: null, flatFee: null,
  hasTrust: null, hasCreditShelter: null, hasRealEstate: null,
  hasLifeInsurance: null, hasAnticipatedInheritance: null, hasPets: null,
  assets: { grossEstate: null, grossEstateDisplay: null, grossEstateApprox: null, breakdown: [] },
  tax: { scenario1: null, scenario2: null, savings: 0, savingsDisplay: "$0", savingsApprox: "$0" },
  plan: {
    planStructure: null,   // "joint_outright" | "joint_disclaimer" | "separate_clayton" | "individual_single"
    clayton: null,         // true ONLY for separate_clayton
    maQtip: null,          // true for joint_disclaimer AND separate_clayton
    type: null,
    documents: []
  },
  fiduciaries: { notes: null, spouse1: null, spouse2: null },
  considerations: { pets: null, petName: null, lifeInsurance: null, anticipatedInheritance: null,
    realEstateTransfer: null, beneficiaryDesignations: null,
    youngAdultPlans: null, ilit: false, gifting: false, giftingNote: null },
  flags: []
};

module.exports = { SAMPLE, SAMPLES, EMPTY };
