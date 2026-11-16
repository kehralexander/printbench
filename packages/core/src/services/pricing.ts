/**
 * What a print costs, and what to charge for it.
 *
 * Cost is what a print costs whoever runs the printer: filament, electricity,
 * machine wear, and the prints that fail along the way. It stays on the admin
 * side. Price is what the requester is charged — cost plus a handling fee and
 * a markup that depend on who is asking (the tier) — and is what a quote
 * freezes.
 *
 * Pure, like queue-planning: the caller resolves the cost per gram of each
 * filament, the printer's rates and the success rate from history, and this
 * only does the arithmetic. Free of any database import, so the settings form
 * can preview a price with the same rules the server quotes by. Reachable as
 * `@pb/core/pricing`.
 */

export interface PricingTier {
  /** Stable key stored on requests and customers. */
  key: string
  label: string
  markupPercent: number
  /** Charged once per request, not per copy: setup, support removal, packing. */
  handlingFee: number
  /** The least a request on this tier comes to. */
  minimum?: number | null
}

export type TaxMode = 'none' | 'small-business-note' | 'vat'

export const TAX_MODES: readonly TaxMode[] = ['none', 'small-business-note', 'vat']

export interface SellerDetails {
  name: string
  address: string
  /** How to pay: a PayPal link, an IBAN. Printed on invoices. */
  paymentNote: string
}

export interface PricingSettings {
  /** Off hides every price in the app. */
  enabled: boolean
  /** ISO 4217, e.g. "EUR". */
  currency: string
  /** Per kWh. */
  kwhPrice: number
  /**
   * Fallback filament price per kilogram, by material family ("PLA", "PETG").
   * The key "*" applies to any material not listed.
   */
  defaultPerKg: Record<string, number>
  /** 0–1: the share of prints that come out right, when history has too little to say. */
  defaultSuccessRate: number
  /** For a printer that has no rates of its own. */
  defaultWatts: number | null
  defaultHourlyRate: number | null
  tiers: PricingTier[]
  defaultTier: string
  /** Prices are rounded to a multiple of this; 0 rounds to the cent. */
  roundTo: number
  quoteValidDays: number
  /** Show the requester the material / time / handling split, not just the total. */
  showBreakdownToRequester: boolean
  /** Keep a quoted request out of "next up" until it is accepted. */
  holdUntilAccepted: boolean
  /** A price above this needs a deposit before printing; null never does. */
  depositThreshold: number | null
  depositPercent: number
  seller: SellerDetails
  /** Which tax rule invoices follow. Which one applies is a question for a tax adviser. */
  taxMode: TaxMode
  /** Percent, used when `taxMode` is "vat". */
  taxRate: number
}

export const DEFAULT_PRICING: PricingSettings = {
  enabled: false,
  currency: 'EUR',
  kwhPrice: 0.35,
  defaultPerKg: { '*': 20, PLA: 20, PETG: 22, ABS: 22, ASA: 28, TPU: 30 },
  defaultSuccessRate: 0.9,
  defaultWatts: 150,
  defaultHourlyRate: 0.3,
  tiers: [
    { key: 'cost', label: 'At cost', markupPercent: 0, handlingFee: 0, minimum: null },
    { key: 'friend', label: 'Friends', markupPercent: 10, handlingFee: 1, minimum: null },
    { key: 'public', label: 'Standard', markupPercent: 50, handlingFee: 3, minimum: 5 },
  ],
  defaultTier: 'friend',
  roundTo: 0.1,
  quoteValidDays: 14,
  showBreakdownToRequester: false,
  holdUntilAccepted: false,
  depositThreshold: null,
  depositPercent: 50,
  seller: { name: '', address: '', paymentNote: '' },
  taxMode: 'none',
  taxRate: 19,
}

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PricingValidationError'
  }
}

/* ------------------------------------------------------------------ *
 * Quoting
 * ------------------------------------------------------------------ */

export interface QuoteFilament {
  /** Grams for ONE print; null when the file has not said. */
  grams: number | null
  /** Resolved from the spool when known; null falls back to the material default. */
  costPerGram: number | null
  material: string | null
  /** "spool #12", "red PLA" — for saying what could not be priced. */
  label?: string | null
}

export interface QuoteInput {
  filaments: QuoteFilament[]
  /** Minutes for ONE print. */
  printMin: number | null
  quantity: number
  printer: { watts: number | null; hourlyRate: number | null } | null
  /** From print history; falls back to the settings default. */
  successRate?: number | null
}

export interface QuoteLine {
  label: string
  amount: number
}

export interface Quote {
  /** Material, electricity, machine time and failure allowance, for the whole request. */
  costLines: QuoteLine[]
  cost: number
  /** The price per copy, for invoice lines. */
  unitPrice: number
  /** What the requester is charged, tax included when there is tax. */
  price: number
  /** The tax inside `price`; zero unless VAT is charged. */
  tax: number
  /** The price split into material, time and handling, for a requester who is shown it. */
  split: QuoteLine[]
  /** What could not be priced, e.g. "no price for spool #12". */
  incomplete: string[]
}

/**
 *     unit  = (material + electricity + machine) / successRate
 *     price = round(max(minimum, (unit × quantity + handlingFee) × (1 + markup)))
 *
 * Slicer totals already include purge and the prime tower, so the grams are
 * taken as they come.
 */
export function quotePrint(input: QuoteInput, rates: PricingSettings, tier: PricingTier): Quote {
  const incomplete: string[] = []
  const quantity = Math.max(1, Math.trunc(input.quantity) || 1)

  let material = 0
  if (input.filaments.length === 0) incomplete.push('no filament weight')
  for (const filament of input.filaments) {
    if (filament.grams == null) {
      incomplete.push(`no weight for ${filament.label || filament.material || 'a filament'}`)
      continue
    }
    const perGram = filament.costPerGram ?? defaultCostPerGram(filament.material, rates)
    if (perGram == null) {
      incomplete.push(`no price for ${filament.label || filament.material || 'a filament'}`)
      continue
    }
    material += filament.grams * perGram
  }

  const watts = input.printer?.watts ?? rates.defaultWatts
  const hourlyRate = input.printer?.hourlyRate ?? rates.defaultHourlyRate
  let electricity = 0
  let machine = 0
  if (input.printMin == null) {
    if ((watts && rates.kwhPrice > 0) || hourlyRate) incomplete.push('no print time')
  } else {
    const hours = Math.max(0, input.printMin) / 60
    if (watts && rates.kwhPrice > 0) electricity = hours * (watts / 1000) * rates.kwhPrice
    if (hourlyRate) machine = hours * hourlyRate
  }

  const successRate = clamp(input.successRate ?? rates.defaultSuccessRate, 0.05, 1)
  const base = material + electricity + machine
  const unit = base / successRate
  const allowance = unit - base

  const costLines: QuoteLine[] = [
    { label: 'Material', amount: cents(material * quantity) },
    { label: 'Electricity', amount: cents(electricity * quantity) },
    { label: 'Machine time', amount: cents(machine * quantity) },
    { label: 'Failure allowance', amount: cents(allowance * quantity) },
  ]
  const cost = cents(unit * quantity)

  const markup = 1 + Math.max(0, tier.markupPercent) / 100
  const handling = Math.max(0, tier.handlingFee)
  const net = Math.max(tier.minimum ?? 0, (unit * quantity + handling) * markup)
  const taxRate = rates.taxMode === 'vat' ? Math.max(0, rates.taxRate) / 100 : 0
  const price = roundPrice(net * (1 + taxRate), rates.roundTo)
  const tax = taxRate > 0 ? cents(price - price / (1 + taxRate)) : 0

  return {
    costLines,
    cost,
    unitPrice: cents(price / quantity),
    price,
    tax,
    split: splitPrice(price, {
      material: (material / successRate) * quantity,
      time: ((electricity + machine) / successRate) * quantity,
      handling,
    }),
    incomplete,
  }
}

/**
 * The price in the proportions it was built from. Rounding is settled on the
 * last line, so the parts always add up to the total shown beside them.
 */
function splitPrice(
  price: number,
  parts: { material: number; time: number; handling: number },
): QuoteLine[] {
  const total = parts.material + parts.time + parts.handling
  if (price <= 0) return []
  if (total <= 0) return [{ label: 'Handling', amount: price }]
  const material = cents((price * parts.material) / total)
  const time = cents((price * parts.time) / total)
  return [
    { label: 'Material', amount: material },
    { label: 'Printing time', amount: time },
    { label: 'Handling', amount: cents(price - material - time) },
  ].filter((line) => line.amount !== 0)
}

/** The settings' price per gram for a material, by family, else the catch-all. */
export function defaultCostPerGram(
  material: string | null,
  rates: Pick<PricingSettings, 'defaultPerKg'>,
): number | null {
  const family = material ? familyOf(material) : null
  const perKg = (family != null ? rates.defaultPerKg[family] : undefined) ?? rates.defaultPerKg['*']
  return perKg != null && Number.isFinite(perKg) && perKg >= 0 ? perKg / 1000 : null
}

/** Same rule as loaded-filament's materialFamily, kept here so this file has no imports. */
function familyOf(material: string): string {
  const first =
    material
      .trim()
      .toUpperCase()
      .split(/[\s\-_/]+/)[0] ?? ''
  return first.replace(/[^A-Z0-9]/g, '')
}

/** The tier by key, falling back to the default, then the first. */
export function pickTier(
  rates: PricingSettings,
  ...keys: (string | null | undefined)[]
): PricingTier {
  for (const key of [...keys, rates.defaultTier]) {
    const tier = key ? rates.tiers.find((candidate) => candidate.key === key) : undefined
    if (tier) return tier
  }
  return rates.tiers[0] ?? { key: 'cost', label: 'At cost', markupPercent: 0, handlingFee: 0 }
}

/**
 * The share of prints that came out, when there are enough of them to say.
 * Partial prints count as half: something was usable, something was not.
 */
export function successRateFrom(
  history: { success: number; partial: number; failed: number },
  minimumRuns = 5,
): number | null {
  const total = history.success + history.partial + history.failed
  if (total < minimumRuns) return null
  return (history.success + history.partial / 2) / total
}

/* ------------------------------------------------------------------ *
 * Quote lifecycle
 * ------------------------------------------------------------------ */

export type PriceStatus =
  'none' | 'quoted' | 'accepted' | 'declined' | 'invoiced' | 'paid' | 'waived'

export const PRICE_STATUSES: readonly PriceStatus[] = [
  'none',
  'quoted',
  'accepted',
  'declined',
  'invoiced',
  'paid',
  'waived',
]

/** Statuses in which a price is owed. */
export const OWED_STATUSES: readonly PriceStatus[] = ['accepted', 'invoiced', 'paid']

/** A deposit due before printing, or null when none is asked. */
export function depositDue(
  price: number | null,
  rates: Pick<PricingSettings, 'depositThreshold' | 'depositPercent' | 'roundTo'>,
): number | null {
  if (price == null || rates.depositThreshold == null || price <= rates.depositThreshold) {
    return null
  }
  return roundPrice((price * clamp(rates.depositPercent, 0, 100)) / 100, rates.roundTo)
}

/**
 * Whether a request waits on its requester rather than the printer: a quote
 * not yet accepted, when the instance holds those back, or a deposit not yet
 * paid. A request that was never quoted is never held.
 */
export function heldForRequester(
  request: { priceStatus: PriceStatus; quotedPrice: number | null; paid: number },
  rates: Pick<
    PricingSettings,
    'enabled' | 'holdUntilAccepted' | 'depositThreshold' | 'depositPercent' | 'roundTo'
  >,
): 'quote' | 'deposit' | null {
  if (!rates.enabled) return null
  if (request.priceStatus === 'quoted' && rates.holdUntilAccepted) return 'quote'
  if (request.priceStatus === 'accepted') {
    const deposit = depositDue(request.quotedPrice, rates)
    if (deposit != null && request.paid + 0.005 < deposit) return 'deposit'
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

export function cents(value: number): number {
  return Math.round(value * 100) / 100
}

export function roundPrice(value: number, step: number): number {
  if (!(step > 0)) return cents(value)
  return cents(Math.round(value / step) * step)
}

export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : max))
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * Coerces a stored or submitted `pricing` setting, filling gaps from the
 * defaults. Throws on a value that would quote nonsense: a negative markup,
 * a success rate of zero, a tier the default points at that does not exist.
 */
export function validatePricing(value: unknown): PricingSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const d = DEFAULT_PRICING
  const num = (key: string, fallback: number, min: number, max: number, label: string) => {
    const raw = input[key]
    if (raw === undefined || raw === null || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new PricingValidationError(`${label} must be between ${min} and ${max}.`)
    }
    return n
  }
  const optional = (key: string, fallback: number | null, max: number, label: string) => {
    if (!(key in input)) return fallback
    const raw = input[key]
    if (raw === null || raw === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > max) {
      throw new PricingValidationError(`${label} must be between 0 and ${max}.`)
    }
    return n
  }

  const currency = String(input.currency ?? d.currency)
    .trim()
    .toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PricingValidationError('The currency must be a three-letter code, like EUR.')
  }

  const perKgInput = (input.defaultPerKg ?? d.defaultPerKg) as Record<string, unknown>
  const defaultPerKg: Record<string, number> = {}
  for (const [rawKey, rawValue] of Object.entries(perKgInput ?? {})) {
    const key = rawKey === '*' ? '*' : familyOf(rawKey)
    if (!key) continue
    const n = Number(rawValue)
    if (!Number.isFinite(n) || n < 0 || n > 10_000) {
      throw new PricingValidationError(`The price per kg for ${rawKey} is not a price.`)
    }
    defaultPerKg[key] = n
  }

  const tiersInput = Array.isArray(input.tiers) ? input.tiers : d.tiers
  const tiers: PricingTier[] = []
  for (const raw of tiersInput as Record<string, unknown>[]) {
    const label = String(raw?.label ?? '').trim()
    const key =
      String(raw?.key ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (!key || !label) throw new PricingValidationError('Every tier needs a name.')
    if (tiers.some((tier) => tier.key === key)) {
      throw new PricingValidationError(`Two tiers are called ${label}.`)
    }
    const markupPercent = Number(raw.markupPercent ?? 0)
    const handlingFee = Number(raw.handlingFee ?? 0)
    const minimum = raw.minimum == null || raw.minimum === '' ? null : Number(raw.minimum)
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
      throw new PricingValidationError(`The markup on ${label} must be between 0 and 1000 %.`)
    }
    if (!Number.isFinite(handlingFee) || handlingFee < 0 || handlingFee > 100_000) {
      throw new PricingValidationError(`The handling fee on ${label} is not a price.`)
    }
    if (minimum != null && (!Number.isFinite(minimum) || minimum < 0 || minimum > 100_000)) {
      throw new PricingValidationError(`The minimum on ${label} is not a price.`)
    }
    tiers.push({ key, label: label.slice(0, 60), markupPercent, handlingFee, minimum })
  }
  if (tiers.length === 0) throw new PricingValidationError('Keep at least one tier.')
  if (tiers.length > 20) throw new PricingValidationError('Keep it to twenty tiers.')

  const defaultTier = String(input.defaultTier ?? d.defaultTier)
  const taxMode = (input.taxMode ?? d.taxMode) as TaxMode
  if (!TAX_MODES.includes(taxMode)) throw new PricingValidationError('That is not a tax mode.')

  const sellerInput = (input.seller ?? {}) as Record<string, unknown>
  const text = (raw: unknown, max: number) =>
    String(raw ?? '')
      .trim()
      .slice(0, max)

  return {
    enabled: input.enabled === undefined ? d.enabled : Boolean(input.enabled),
    currency,
    kwhPrice: num('kwhPrice', d.kwhPrice, 0, 100, 'The price per kWh'),
    defaultPerKg,
    defaultSuccessRate: num(
      'defaultSuccessRate',
      d.defaultSuccessRate,
      0.05,
      1,
      'The success rate',
    ),
    defaultWatts: optional('defaultWatts', d.defaultWatts, 100_000, 'The default wattage'),
    defaultHourlyRate: optional(
      'defaultHourlyRate',
      d.defaultHourlyRate,
      10_000,
      'The hourly rate',
    ),
    tiers,
    defaultTier: tiers.some((tier) => tier.key === defaultTier) ? defaultTier : tiers[0]!.key,
    roundTo: num('roundTo', d.roundTo, 0, 100, 'Rounding'),
    quoteValidDays: Math.round(num('quoteValidDays', d.quoteValidDays, 1, 365, 'Quote validity')),
    showBreakdownToRequester:
      input.showBreakdownToRequester === undefined
        ? d.showBreakdownToRequester
        : Boolean(input.showBreakdownToRequester),
    holdUntilAccepted:
      input.holdUntilAccepted === undefined
        ? d.holdUntilAccepted
        : Boolean(input.holdUntilAccepted),
    depositThreshold: optional(
      'depositThreshold',
      d.depositThreshold,
      1_000_000,
      'The deposit threshold',
    ),
    depositPercent: num('depositPercent', d.depositPercent, 0, 100, 'The deposit'),
    seller: {
      name: text(sellerInput.name, 200),
      address: text(sellerInput.address, 1000),
      paymentNote: text(sellerInput.paymentNote, 1000),
    },
    taxMode,
    taxRate: num('taxRate', d.taxRate, 0, 100, 'The tax rate'),
  }
}
