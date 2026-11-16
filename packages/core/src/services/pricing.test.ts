import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING,
  PricingValidationError,
  defaultCostPerGram,
  depositDue,
  heldForRequester,
  pickTier,
  quotePrint,
  roundPrice,
  successRateFrom,
  validatePricing,
  type PricingSettings,
  type PricingTier,
} from './pricing'

const rates: PricingSettings = {
  ...DEFAULT_PRICING,
  enabled: true,
  kwhPrice: 0.4,
  defaultPerKg: { '*': 25, PLA: 20 },
  defaultSuccessRate: 0.8,
  defaultWatts: null,
  defaultHourlyRate: null,
  roundTo: 0,
}
const atCost: PricingTier = { key: 'cost', label: 'At cost', markupPercent: 0, handlingFee: 0 }
const standard: PricingTier = {
  key: 'public',
  label: 'Standard',
  markupPercent: 50,
  handlingFee: 3,
  minimum: 5,
}

describe('what a print costs', () => {
  it('adds material, electricity and machine time, and divides by the success rate', () => {
    const quote = quotePrint(
      {
        filaments: [{ grams: 100, costPerGram: 0.02, material: 'PLA' }],
        printMin: 120,
        quantity: 1,
        printer: { watts: 250, hourlyRate: 0.5 },
      },
      rates,
      atCost,
    )
    // 2.00 material + 2 h × 0.25 kW × 0.40 = 0.20 + 2 h × 0.50 = 1.00 → 3.20 / 0.8 = 4.00
    expect(quote.costLines).toEqual([
      { label: 'Material', amount: 2 },
      { label: 'Electricity', amount: 0.2 },
      { label: 'Machine time', amount: 1 },
      { label: 'Failure allowance', amount: 0.8 },
    ])
    expect(quote.cost).toBe(4)
    expect(quote.price).toBe(4)
    expect(quote.incomplete).toEqual([])
  })

  it('charges the handling fee once per request and the markup on top, per copy otherwise', () => {
    const quote = quotePrint(
      {
        filaments: [{ grams: 50, costPerGram: 0.02, material: 'PLA' }],
        printMin: null,
        quantity: 4,
        printer: null,
        successRate: 1,
      },
      rates,
      standard,
    )
    // 1.00 per copy × 4 + 3 handling = 7 × 1.5 = 10.50
    expect(quote.cost).toBe(4)
    expect(quote.price).toBe(10.5)
    expect(quote.unitPrice).toBe(2.63)
  })

  it('stops a tiny print coming to almost nothing', () => {
    const quote = quotePrint(
      {
        filaments: [{ grams: 4, costPerGram: 0.02, material: 'PLA' }],
        printMin: 10,
        quantity: 1,
        printer: null,
      },
      rates,
      standard,
    )
    expect(quote.price).toBe(5)
  })

  it('sums every filament of a multi-colour print', () => {
    const quote = quotePrint(
      {
        filaments: [
          { grams: 30, costPerGram: 0.03, material: 'PETG' },
          { grams: 10, costPerGram: null, material: 'PLA Matte' },
        ],
        printMin: null,
        quantity: 1,
        printer: null,
        successRate: 1,
      },
      rates,
      atCost,
    )
    // 0.90 + 10 g at the PLA default of 20/kg = 0.20
    expect(quote.costLines[0]).toEqual({ label: 'Material', amount: 1.1 })
  })

  it('says what it could not price instead of pricing it at zero silently', () => {
    const quote = quotePrint(
      {
        filaments: [
          { grams: 10, costPerGram: null, material: 'Nylon', label: 'spool #12' },
          { grams: null, costPerGram: 0.02, material: 'PLA' },
        ],
        printMin: null,
        quantity: 1,
        printer: { watts: 100, hourlyRate: null },
      },
      { ...rates, defaultPerKg: { PLA: 20 } },
      atCost,
    )
    expect(quote.incomplete).toEqual([
      'no price for spool #12',
      'no weight for PLA',
      'no print time',
    ])
  })

  it('adds VAT to the price and reports the share of it', () => {
    const quote = quotePrint(
      {
        filaments: [{ grams: 500, costPerGram: 0.02, material: 'PLA' }],
        printMin: null,
        quantity: 1,
        printer: null,
        successRate: 1,
      },
      { ...rates, taxMode: 'vat', taxRate: 19 },
      atCost,
    )
    expect(quote.price).toBe(11.9)
    expect(quote.tax).toBe(1.9)
  })

  it('splits the price into parts that add up to it', () => {
    const quote = quotePrint(
      {
        filaments: [{ grams: 100, costPerGram: 0.02, material: 'PLA' }],
        printMin: 60,
        quantity: 3,
        printer: { watts: 200, hourlyRate: 0.3 },
      },
      { ...rates, roundTo: 0.5 },
      standard,
    )
    const sum = quote.split.reduce((total, line) => total + line.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(quote.price)
    expect(quote.split.map((line) => line.label)).toEqual(['Material', 'Printing time', 'Handling'])
  })
})

describe('pricing helpers', () => {
  it('rounds to the chosen step', () => {
    expect(roundPrice(3.27, 0.5)).toBe(3.5)
    expect(roundPrice(3.24, 0.1)).toBe(3.2)
    expect(roundPrice(3.333, 0)).toBe(3.33)
  })

  it('falls back to the catch-all material price', () => {
    expect(defaultCostPerGram('PETG-CF', rates)).toBe(0.025)
    expect(defaultCostPerGram('pla silk', rates)).toBe(0.02)
    expect(defaultCostPerGram('PLA', { defaultPerKg: {} })).toBeNull()
  })

  it('picks the request tier, then the customer tier, then the default', () => {
    expect(pickTier(DEFAULT_PRICING, null, 'public').key).toBe('public')
    expect(pickTier(DEFAULT_PRICING, 'cost', 'public').key).toBe('cost')
    expect(pickTier(DEFAULT_PRICING, 'gone').key).toBe(DEFAULT_PRICING.defaultTier)
  })

  it('needs enough history before trusting a success rate', () => {
    expect(successRateFrom({ success: 3, partial: 0, failed: 1 })).toBeNull()
    expect(successRateFrom({ success: 7, partial: 2, failed: 1 })).toBe(0.8)
  })

  it('asks a deposit above the threshold and holds the print until it is paid', () => {
    const withDeposit = { ...rates, depositThreshold: 20, depositPercent: 50, roundTo: 0.5 }
    expect(depositDue(15, withDeposit)).toBeNull()
    expect(depositDue(41, withDeposit)).toBe(20.5)
    expect(
      heldForRequester({ priceStatus: 'accepted', quotedPrice: 41, paid: 10 }, withDeposit),
    ).toBe('deposit')
    expect(
      heldForRequester({ priceStatus: 'accepted', quotedPrice: 41, paid: 20.5 }, withDeposit),
    ).toBeNull()
    expect(
      heldForRequester(
        { priceStatus: 'quoted', quotedPrice: 10, paid: 0 },
        { ...rates, holdUntilAccepted: true },
      ),
    ).toBe('quote')
    expect(heldForRequester({ priceStatus: 'quoted', quotedPrice: 10, paid: 0 }, rates)).toBeNull()
  })
})

describe('the pricing setting', () => {
  it('fills gaps from the defaults', () => {
    expect(validatePricing({})).toEqual(DEFAULT_PRICING)
    expect(validatePricing({ currency: 'usd', enabled: true })).toMatchObject({
      currency: 'USD',
      enabled: true,
    })
  })

  it('normalises material keys and tier keys', () => {
    const pricing = validatePricing({
      defaultPerKg: { 'pla matte': 18, '*': 21 },
      tiers: [{ label: 'Club Members', markupPercent: 5, handlingFee: 0 }],
      defaultTier: 'nope',
    })
    expect(pricing.defaultPerKg).toEqual({ PLA: 18, '*': 21 })
    expect(pricing.tiers[0]!.key).toBe('club-members')
    expect(pricing.defaultTier).toBe('club-members')
  })

  it('refuses values that would quote nonsense', () => {
    expect(() => validatePricing({ defaultSuccessRate: 0 })).toThrow(PricingValidationError)
    expect(() => validatePricing({ currency: 'Euro' })).toThrow(PricingValidationError)
    expect(() => validatePricing({ tiers: [] })).toThrow(PricingValidationError)
    expect(() =>
      validatePricing({ tiers: [{ label: 'A', markupPercent: -5, handlingFee: 0 }] }),
    ).toThrow(PricingValidationError)
    expect(() => validatePricing({ taxMode: 'maybe' })).toThrow(PricingValidationError)
  })
})
