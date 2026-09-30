import { describe, expect, it } from 'vitest'
import { parseAssetSpreadsheetRows } from '@/lib/import/parseAssetSpreadsheetRows'

/** Mirrors Venables_financial_information.xlsx (Financial Summary sheet). */
const VENABLES_FINANCIAL_SUMMARY: string[][] = [
  ['Exported', '6/10/2026'],
  [],
  ['Real Estate'],
  ['Type', 'Address', 'Owner', '', '', 'Estimated Value', 'Mortgage Balance', 'Net'],
  ['Residential', '19 Mayo Ave, Needham, MA 02492, USA', 'primary', '', '', '2000000', '601869.09', ''],
  [],
  [],
  [],
  ['Bank Accounts'],
  ['Bank', 'Type', 'Owner', 'Account Number', 'Beneficiaries', 'Balance', '', 'Net'],
  ['Mercury', 'Savings', 'primary', '', '', '73915.76', '', ''],
  ['Ally', 'Savings', 'primary', '', '', '25250.64', '', ''],
  ['Fidelity', 'Checking', 'primary', '1065', '', '16.27', '', ''],
  [],
  [],
  [],
  ['Retirement Accounts'],
  ['Bank', 'Type', 'Owner', 'Account Number', 'Beneficiaries', 'Balance', '', 'Net'],
  ['Fidelity', 'Roth IRA', 'primary', '', 'Sawyer Venables, Oliver Venables, Jack Venables', '16388.41', '', ''],
  ['Fidelity', '401(k)', 'primary', '', 'Sawyer Venables, Oliver Venables, Jack Venables', '65584.44', '', ''],
  ['Fidelity', '401(k)', 'primary', '', 'Sawyer Venables, Oliver Venables, Jack Venables', '53535.19', '', ''],
  ['Vanguard', 'Roth IRA', 'primary', '8040', '', '67301.65', '', ''],
  ['Fidelity', 'IRA', 'primary', '7409', '', '63380.24', '', ''],
  ['Vanguard', 'IRA', 'primary', '5562', '', '42698.89', '', ''],
  ['Circle', '401(k)', 'primary', '1138', '', '112743.08', '', ''],
  [],
  [],
  [],
  ['Stock, Bonds, Brokerage Accounts'],
  ['', '', 'Owner', 'Description', '', 'Estimated Value', '', 'Net'],
  ['', '', 'primary', '', '', '162942', '', ''],
  ['', '', 'primary', '', '', '3239366.71', '', ''],
  [],
  [],
  [],
  ['Custodial Accounts'],
  ['', '', 'Owner', 'Description', '', 'Estimated Value', '', 'Net'],
  ['', '', 'primary', 'UTMA', '', '1219', '', ''],
  ['', '', 'primary', 'UTMA', '', '1219', '', ''],
  ['', '', 'primary', 'UTMA', '', '1219', '', ''],
  [],
  [],
  [],
  ['Cryptocurrencies'],
  ['', '', 'Owner', 'Description', '', 'Estimated Value', '', 'Net'],
  ['', '', 'primary', 'Bitcoin', '', '62000', '', ''],
  ['', '', 'primary', 'Ethereum', '', '16000', '', ''],
  ['', '', 'primary', 'Solana', '', '15000', '', ''],
  [],
  [],
  [],
  ['Life Insurance'],
  ['', '', 'Owner', 'Description', '', 'Estimated Value', '', 'Net'],
  ['', '', 'primary', '', '', '1000000', '', ''],
  [],
  [],
  [],
  ['Business You Own'],
  ['Business Name', 'Type', 'Owner', 'EIN', 'Ownership %', 'Value', '', 'Net'],
  ['Catena Labs, Inc', 'Corporation', '', '92-0718046', '20', '40000000', '', ''],
  ['Blendist LLC', 'LLC', '', '27-5491645', '100', '30000', '', ''],
  [],
  [],
  [],
  ['Vehicles and Other Titled Moving Property'],
  ['Make, Model, Year', '', 'Owner', 'VIN', '', 'Estimated Value', 'Outstanding Debt', 'Net'],
  ['2025 Acura MDX', '', 'primary', '5J8YE1H82SL020418', '', '0', '56000', ''],
  [],
  [],
  [],
  ['Category Totals'],
  ['Category', 'Primary', 'Spouse', 'Joint', '(other)', 'Credit', 'Debit', 'Net'],
  ['Real Estate', '1398130.91', '0', '0', '0', '2000000', '601869.09', ''],
  ['Bank Accounts', '99182.67', '0', '0', '0', '99182.67', '0', ''],
  ['TOTAL'],
]

const FLAT_EXPORT: string[][] = [
  ['Asset Inventory — Test Client'],
  ['Generated: July 10, 2026'],
  [],
  ['Category', 'Description', 'Ownership', 'Value', 'Property Type', 'Mortgage Balance', 'Institution', 'Account Type', 'Beneficiary'],
  ['Real Estate', '19 Mayo Ave, Needham, MA 02492, USA', 'Client', '2000000', 'Residential', '601869.09', '', '', ''],
  ['Bank Accounts', 'Mercury Savings', 'Client', '73915.76', '', '', 'Mercury', 'Savings', ''],
  ['Bank Accounts Subtotal', '', '', '73915.76'],
  ['Retirement Accounts', 'Fidelity Roth IRA', 'Client', '16388.41', '', '', 'Fidelity', 'Roth IRA', 'Sawyer Venables'],
  ['SUMMARY'],
  ['Client Owned', '', '', '2091304.17'],
  ['Grand Total', '', '', '2091304.17'],
]

describe('parseAssetSpreadsheetRows — financial summary', () => {
  it('imports Venables-style Financial Summary without totals or header noise', () => {
    const assets = parseAssetSpreadsheetRows(VENABLES_FINANCIAL_SUMMARY)

    expect(assets).toHaveLength(23)
    expect(assets.every(a => a.ownership === 'client')).toBe(true)
    expect(assets.some(a => a.description === 'Category Totals')).toBe(false)
    expect(assets.some(a => a.description === 'Type')).toBe(false)
    expect(assets.some(a => a.description === '[object Object]')).toBe(false)
    expect(assets.some(a => String(a.value) === '99182.67')).toBe(false) // bank category total

    const realEstate = assets.filter(a => a.category === 'real_estate')
    expect(realEstate).toHaveLength(1)
    expect(realEstate[0]).toMatchObject({
      description: '19 Mayo Ave, Needham, MA 02492, USA',
      value: 2000000,
      details: { property_type: 'Residential', mortgage_balance: 601869.09 },
    })

    const banks = assets.filter(a => a.category === 'bank')
    expect(banks).toHaveLength(3)
    expect(banks.map(a => a.description)).toEqual([
      'Mercury Savings',
      'Ally Savings',
      'Fidelity Checking (1065)',
    ])
    expect(banks.reduce((s, a) => s + a.value, 0)).toBeCloseTo(99182.67, 2)

    const retirement = assets.filter(a => a.category === 'retirement')
    expect(retirement).toHaveLength(7)
    expect(retirement[0]).toMatchObject({
      description: 'Fidelity Roth IRA',
      value: 16388.41,
      details: {
        institution: 'Fidelity',
        account_type: 'Roth IRA',
        beneficiary: 'Sawyer Venables, Oliver Venables, Jack Venables',
      },
    })

    const investments = assets.filter(a => a.category === 'investment')
    expect(investments).toHaveLength(2)
    expect(investments.map(a => a.value)).toEqual([162942, 3239366.71])
    expect(investments.every(a => a.description === 'Brokerage account')).toBe(true)

    const custodial = assets.filter(a => a.category === 'other' && a.description === 'UTMA')
    expect(custodial).toHaveLength(3)

    const crypto = assets.filter(a => a.category === 'crypto')
    expect(crypto.map(a => [a.description, a.value])).toEqual([
      ['Bitcoin', 62000],
      ['Ethereum', 16000],
      ['Solana', 15000],
    ])

    const life = assets.filter(a => a.category === 'life_insurance')
    expect(life).toHaveLength(1)
    expect(life[0].value).toBe(1000000)

    const businesses = assets.filter(a => a.category === 'business')
    expect(businesses).toHaveLength(2)
    expect(businesses[0]).toMatchObject({
      description: 'Catena Labs, Inc',
      value: 40000000,
      details: { account_type: 'Corporation', ein: '92-0718046', ownership_percent: 20 },
    })
    expect(businesses[1]).toMatchObject({
      description: 'Blendist LLC',
      value: 30000,
      details: { account_type: 'LLC', ein: '27-5491645', ownership_percent: 100 },
    })

    const vehicles = assets.filter(a => a.category === 'vehicles')
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0]).toMatchObject({
      description: '2025 Acura MDX',
      value: 0,
      details: { vin: '5J8YE1H82SL020418', mortgage_balance: 56000 },
    })
  })
})

describe('parseAssetSpreadsheetRows — flat export', () => {
  it('still re-imports Cornerstone asset export spreadsheets', () => {
    const assets = parseAssetSpreadsheetRows(FLAT_EXPORT)
    expect(assets).toHaveLength(3)
    expect(assets.map(a => a.category)).toEqual(['real_estate', 'bank', 'retirement'])
    expect(assets[0]).toMatchObject({
      description: '19 Mayo Ave, Needham, MA 02492, USA',
      value: 2000000,
      ownership: 'client',
      details: { property_type: 'Residential', mortgage_balance: 601869.09 },
    })
    expect(assets[1].details).toMatchObject({ institution: 'Mercury', account_type: 'Savings' })
  })
})

/** Mirrors an "Asset Report" export: content starts in column B, a formula-only summary table, then the inventory. */
const ASSET_REPORT: string[][] = [
  ['', 'ASSET REPORT', 'ASSET REPORT', 'ASSET REPORT', 'ASSET REPORT', 'ASSET REPORT'],
  ['', 'DISCLAIMER: The below Asset Report is provided solely as a planning tool.'],
  ['', 'CLIENT', '', '', '', 'Test Client and Test Spouse'],
  ['', 'EXPORTED', '', '', '', '09-29-2026 at 04:41 PM'],
  ['', 'Summary of Assets', 'Summary of Assets', 'Summary of Assets', 'Summary of Assets', 'Summary of Assets'],
  ['', 'ASSET TYPE', '', 'CUR VALUE', 'CUR DEBT', 'NET VALUE'],
  // Formula cells with no cached result read as blank
  ['', 'Real Estate', '', '', '', ''],
  ['', 'Bank Accounts', '', '', '', ''],
  ['', 'Life Insurance', '', '', '', ''],
  ['', 'Total', '', '', '', ''],
  ['', 'Asset Inventory', 'Asset Inventory', 'Asset Inventory', 'Asset Inventory', 'Asset Inventory'],
  ['', 'ASSET TYPE', 'OWNER', 'CUR VALUE', 'CUR DEBT', 'NET VALUE'],
  ['', 'REAL ESTATE'],
  ['', '12 Example Street, Needham, Massachusetts 02492', '', '1228000', '350000', ''],
  ['', 'Subtotal Real Estate', '', '', '', ''],
  ['', 'BANK ACCOUNTS'],
  ['', 'Example Bank joint checking 0001', 'Joint', '23000', '0', ''],
  ['', 'Subtotal Bank Accounts', '', '', '', ''],
  ['', 'LIFE INSURANCE'],
  ['', 'No life insurance'],
  ['', 'Subtotal Life Insurance', '', '', '', ''],
  ['', 'VEHICLES'],
  ['', '2016 Mazda CX5', '', '5000', '0', ''],
  ['', 'DIGITAL ASSETS'],
  ['', 'No digital assets'],
  ['', 'MINERAL INTERESTS'],
  ['', 'Example royalty interest', '', '1500', '0', ''],
  ['', 'Subtotal Mineral Interests', '', '', '', ''],
]

describe('parseAssetSpreadsheetRows — asset report', () => {
  it('imports inventory rows with section categories and values, skipping summary, subtotals and placeholders', () => {
    const assets = parseAssetSpreadsheetRows(ASSET_REPORT)
    expect(assets.map(a => [a.category, a.description, a.value])).toEqual([
      ['real_estate', '12 Example Street, Needham, Massachusetts 02492', 1228000],
      ['bank', 'Example Bank joint checking 0001', 23000],
      ['vehicles', '2016 Mazda CX5', 5000],
      ['other', 'Example royalty interest', 1500],
    ])
    expect(assets[0].details).toEqual({ mortgage_balance: 350000 })
    expect(assets[1]).toMatchObject({ ownership: 'joint', details: {} })
  })

  it('reads the real exceljs cell shapes (leading blank column, formula cells)', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Assets')
    ws.getCell('B2').value = 'ASSET TYPE'
    ws.getCell('D2').value = 'CUR VALUE'
    ws.getCell('B3').value = 'Real Estate'
    ws.getCell('D3').value = { formula: 'D9' } as never
    ws.getCell('B5').value = 'ASSET TYPE'
    ws.getCell('C5').value = 'OWNER'
    ws.getCell('D5').value = 'CUR VALUE'
    ws.getCell('E5').value = 'CUR DEBT'
    ws.getCell('B6').value = 'REAL ESTATE'
    ws.getCell('B7').value = '  12 Example Street'
    ws.getCell('D7').value = 600000
    ws.getCell('E7').value = 0
    ws.getCell('F7').value = { formula: 'D7-E7' } as never
    const buffer = await wb.xlsx.writeBuffer()

    const { parseAssetSpreadsheet } = await import('@/lib/import/parseAssetSpreadsheet')
    const assets = await parseAssetSpreadsheet(new File([buffer as ArrayBuffer], 'report.xlsx'))
    expect(assets).toEqual([
      {
        category: 'real_estate',
        description: '12 Example Street',
        value: 600000,
        ownership: 'client',
        details: { mortgage_balance: 0 },
      },
    ])
  })
})
