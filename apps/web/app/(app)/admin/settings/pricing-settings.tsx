'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  formatMoney,
  quotePrint,
  type PricingSettings,
  type PricingTier,
  type TaxMode,
} from '@pb/core/pricing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Toggle } from './toggle'

const TAX_LABELS: Record<TaxMode, string> = {
  none: 'No tax shown on invoices',
  'small-business-note': 'Small business: invoices say no VAT is charged (§19 UStG)',
  vat: 'Charge VAT',
}

/**
 * The print used for the preview: small enough to be typical, long enough
 * that time-based costs show up beside the filament.
 */
const SAMPLE = { grams: 50, hours: 2, material: 'PLA' }

/**
 * Pricing, as one card on the settings page.
 *
 * Off by default and folded away while off: an instance that only prints for
 * its own household should not have to read through tiers and tax modes. The
 * preview at the bottom quotes with the same function the server uses, so
 * what it shows is what a request would come to.
 */
export function PricingSettingsSection({
  value,
  onChange,
}: {
  value: PricingSettings
  onChange: (value: PricingSettings) => void
}) {
  function set<K extends keyof PricingSettings>(key: K, next: PricingSettings[K]) {
    onChange({ ...value, [key]: next })
  }

  const money = value.currency || 'money'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing</CardTitle>
        <CardDescription>
          For printing for other people: what a print costs you, and what to charge for it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Toggle
          label="Price prints"
          hint="Shows prices on requests and lets you send quotes. Off hides every price in the app."
          checked={value.enabled}
          onChange={(enabled) => set('enabled', enabled)}
        />

        {value.enabled && (
          <>
            <Section
              title="What a print costs you"
              description="Filament, electricity and machine wear, divided by how often prints succeed so the failures are paid for too."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Currency" htmlFor="pricing-currency" hint="A three-letter code.">
                  <Input
                    value={value.currency}
                    maxLength={3}
                    onChange={(e) => set('currency', e.target.value.toUpperCase())}
                    className="w-28 uppercase"
                    placeholder="EUR"
                  />
                </Field>

                <Field label="Electricity" htmlFor="pricing-kwh">
                  <Suffixed suffix={`${money} per kWh`}>
                    <NumberInput
                      id="pricing-kwh"
                      value={value.kwhPrice}
                      onChange={(n) => set('kwhPrice', n ?? 0)}
                    />
                  </Suffixed>
                </Field>

                <Field
                  label="Prints that succeed"
                  htmlFor="pricing-success"
                  hint="Used until a model or printer has enough history of its own."
                >
                  <Suffixed suffix="%">
                    <NumberInput
                      id="pricing-success"
                      value={value.defaultSuccessRate}
                      scale={100}
                      onChange={(n) => set('defaultSuccessRate', n ?? 1)}
                    />
                  </Suffixed>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Default printer power"
                  htmlFor="pricing-watts"
                  hint="Average while printing, for printers without their own. Blank leaves electricity out."
                >
                  <Suffixed suffix="W">
                    <NumberInput
                      id="pricing-watts"
                      value={value.defaultWatts}
                      blank
                      onChange={(n) => set('defaultWatts', n)}
                    />
                  </Suffixed>
                </Field>

                <Field
                  label="Default machine rate"
                  htmlFor="pricing-hourly"
                  hint="Wear, nozzles, build plates. Blank leaves machine time out."
                >
                  <Suffixed suffix={`${money} per hour`}>
                    <NumberInput
                      id="pricing-hourly"
                      value={value.defaultHourlyRate}
                      blank
                      onChange={(n) => set('defaultHourlyRate', n)}
                    />
                  </Suffixed>
                </Field>
              </div>

              <MaterialPrices
                value={value.defaultPerKg}
                currency={money}
                onChange={(next) => set('defaultPerKg', next)}
              />
            </Section>

            <Section
              title="What you charge"
              description="Each request has a tier, so friends and strangers can pay differently. The handling fee is charged once per request, not per copy; the minimum stops a 4 g keychain coming to a few cents."
            >
              <Tiers value={value} currency={money} onChange={onChange} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default tier" htmlFor="pricing-default-tier">
                  <Select
                    value={value.defaultTier}
                    onChange={(e) => set('defaultTier', e.target.value)}
                  >
                    {value.tiers.map((tier) => (
                      <option key={tier.key} value={tier.key}>
                        {tier.label || 'Unnamed tier'}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Round prices to" htmlFor="pricing-round" hint="0 rounds to the cent.">
                  <Suffixed suffix={money}>
                    <NumberInput
                      id="pricing-round"
                      value={value.roundTo}
                      onChange={(n) => set('roundTo', n ?? 0)}
                    />
                  </Suffixed>
                </Field>
              </div>

              <Preview value={value} />
            </Section>

            <Section title="Quotes and payment">
              <Field
                label="Quotes are valid for"
                htmlFor="pricing-valid-days"
                hint="Filament prices change, so an old quote has to be renewed."
              >
                <Suffixed suffix="days">
                  <NumberInput
                    id="pricing-valid-days"
                    value={value.quoteValidDays}
                    onChange={(n) => set('quoteValidDays', n ?? 1)}
                  />
                </Suffixed>
              </Field>

              <Toggle
                label="Show the requester the breakdown"
                hint="Splits the price into material, printing time and handling on their request page, rather than only the total."
                checked={value.showBreakdownToRequester}
                onChange={(next) => set('showBreakdownToRequester', next)}
              />

              <Toggle
                label="Hold quoted requests until accepted"
                hint="A quoted request stays out of “next up” until the requester accepts the price."
                checked={value.holdUntilAccepted}
                onChange={(next) => set('holdUntilAccepted', next)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Ask for a deposit above"
                  htmlFor="pricing-deposit-threshold"
                  hint="Blank never asks for one."
                >
                  <Suffixed suffix={money}>
                    <NumberInput
                      id="pricing-deposit-threshold"
                      value={value.depositThreshold}
                      blank
                      onChange={(n) => set('depositThreshold', n)}
                    />
                  </Suffixed>
                </Field>

                {value.depositThreshold != null && (
                  <Field
                    label="Deposit"
                    htmlFor="pricing-deposit-percent"
                    hint="Of the price, paid before printing starts."
                  >
                    <Suffixed suffix="%">
                      <NumberInput
                        id="pricing-deposit-percent"
                        value={value.depositPercent}
                        onChange={(n) => set('depositPercent', n ?? 0)}
                      />
                    </Suffixed>
                  </Field>
                )}
              </div>
            </Section>

            <Section title="Invoices" description="Printed on receipts and invoices.">
              <Field label="Your name or business" htmlFor="pricing-seller-name">
                <Input
                  value={value.seller.name}
                  onChange={(e) => set('seller', { ...value.seller, name: e.target.value })}
                />
              </Field>

              <Field label="Address" htmlFor="pricing-seller-address">
                <Textarea
                  rows={3}
                  value={value.seller.address}
                  onChange={(e) => set('seller', { ...value.seller, address: e.target.value })}
                />
              </Field>

              <Field
                label="How to pay"
                htmlFor="pricing-payment-note"
                hint="A PayPal link, an IBAN, or “cash on collection”."
              >
                <Textarea
                  rows={2}
                  value={value.seller.paymentNote}
                  onChange={(e) => set('seller', { ...value.seller, paymentNote: e.target.value })}
                />
              </Field>

              <Field
                label="Tax"
                htmlFor="pricing-tax-mode"
                hint="PrintBench does not decide which rule applies to you. Charging regularly may count as a trade; ask a tax adviser."
              >
                <Select
                  value={value.taxMode}
                  onChange={(e) => set('taxMode', e.target.value as TaxMode)}
                >
                  {(Object.keys(TAX_LABELS) as TaxMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {TAX_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </Field>

              {value.taxMode === 'vat' && (
                <Field
                  label="VAT rate"
                  htmlFor="pricing-tax-rate"
                  hint="Prices include it; invoices show the share."
                >
                  <Suffixed suffix="%">
                    <NumberInput
                      id="pricing-tax-rate"
                      value={value.taxRate}
                      onChange={(n) => set('taxRate', n ?? 0)}
                    />
                  </Suffixed>
                </Field>
              )}
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Filament prices
 * ------------------------------------------------------------------ */

interface MaterialRow {
  id: number
  material: string
  price: number
}

/**
 * The per-kilogram fallback by material, for spools with no price of their
 * own. Kept as rows in local state rather than read straight from the record:
 * a record cannot hold a row whose material is still being typed, or two rows
 * briefly called the same thing.
 */
function MaterialPrices({
  value,
  currency,
  onChange,
}: {
  value: Record<string, number>
  currency: string
  onChange: (value: Record<string, number>) => void
}) {
  const [rows, setRows] = useState<MaterialRow[]>(() => {
    const entries = Object.entries(value)
    // The catch-all first, so it reads as the rule the others are exceptions to.
    const ordered = [
      ...entries.filter(([key]) => key === '*'),
      ...entries.filter(([key]) => key !== '*'),
    ]
    if (!('*' in value)) ordered.unshift(['*', 20])
    return ordered.map(([material, price], id) => ({ id, material, price }))
  })

  function update(next: MaterialRow[]) {
    setRows(next)
    const record: Record<string, number> = {}
    for (const row of next) {
      const key = row.material.trim()
      if (key) record[key] = row.price
    }
    onChange(record)
  }

  const fallback = rows.find((row) => row.material === '*')?.price ?? 20

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-ink)]">Filament without a price</p>
      <p className="text-xs text-[var(--color-ink-faint)]">
        Used when neither the spool nor Spoolman knows what it cost. By material family, such as PLA
        or PETG.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            {row.material === '*' ? (
              <span className="flex h-10 flex-1 items-center text-sm text-[var(--color-ink-muted)]">
                Any other material
              </span>
            ) : (
              <Input
                aria-label="Material"
                value={row.material}
                placeholder="PETG"
                onChange={(e) =>
                  update(
                    rows.map((r) => (r.id === row.id ? { ...r, material: e.target.value } : r)),
                  )
                }
                className="flex-1"
              />
            )}
            <Suffixed suffix={`${currency} per kg`}>
              <NumberInput
                aria-label={`Price per kg for ${row.material === '*' ? 'any other material' : row.material || 'this material'}`}
                value={row.price}
                onChange={(n) =>
                  update(rows.map((r) => (r.id === row.id ? { ...r, price: n ?? 0 } : r)))
                }
              />
            </Suffixed>
            {row.material === '*' ? (
              // Keeps the price inputs lined up with the rows that can be removed.
              <span className="size-9 shrink-0" aria-hidden />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${row.material || 'this material'}`}
                onClick={() => update(rows.filter((r) => r.id !== row.id))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          update([
            ...rows,
            { id: Math.max(0, ...rows.map((r) => r.id)) + 1, material: '', price: fallback },
          ])
        }
      >
        <Plus />
        Add a material
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tiers
 * ------------------------------------------------------------------ */

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tier'
  )
}

function uniqueKey(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function Tiers({
  value,
  currency,
  onChange,
}: {
  value: PricingSettings
  currency: string
  onChange: (value: PricingSettings) => void
}) {
  /*
   * A tier's key is stored on requests and customers, so a saved tier keeps
   * its key when renamed. Only a tier added since the page loaded follows its
   * label, so it gets a readable key rather than "tier-2".
   */
  const [savedKeys] = useState(() => new Set(value.tiers.map((tier) => tier.key)))

  function update(index: number, patch: Partial<PricingTier>) {
    const current = value.tiers[index]!
    let next = { ...current, ...patch }
    let defaultTier = value.defaultTier
    if (patch.label !== undefined && !savedKeys.has(current.key)) {
      const others = value.tiers.filter((_, i) => i !== index).map((tier) => tier.key)
      next = { ...next, key: uniqueKey(slug(patch.label), [...others, ...savedKeys]) }
      if (defaultTier === current.key) defaultTier = next.key
    }
    onChange({
      ...value,
      tiers: value.tiers.map((tier, i) => (i === index ? next : tier)),
      defaultTier,
    })
  }

  function remove(index: number) {
    const tiers = value.tiers.filter((_, i) => i !== index)
    const defaultTier = tiers.some((tier) => tier.key === value.defaultTier)
      ? value.defaultTier
      : tiers[0]!.key
    onChange({ ...value, tiers, defaultTier })
  }

  function add() {
    const key = uniqueKey('tier', [...value.tiers.map((tier) => tier.key), ...savedKeys])
    onChange({
      ...value,
      tiers: [...value.tiers, { key, label: '', markupPercent: 0, handlingFee: 0, minimum: null }],
    })
  }

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_7rem_2.25rem] gap-2 text-xs font-medium text-[var(--color-ink-muted)] sm:grid">
        <span>Tier</span>
        <span>Markup</span>
        <span>Handling fee</span>
        <span>Minimum</span>
        <span />
      </div>
      <ul className="space-y-3 sm:space-y-2">
        {value.tiers.map((tier, index) => (
          // By position: a new tier's key follows its label, and a changing key
          // would remount the row and take the cursor out of the name field.
          <li
            key={index}
            className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_7rem_2.25rem]"
          >
            <Input
              aria-label="Tier name"
              value={tier.label}
              placeholder="Club members"
              onChange={(e) => update(index, { label: e.target.value })}
              className="col-span-2 sm:col-span-1"
            />
            <Suffixed suffix="%">
              <NumberInput
                aria-label={`Markup for ${tier.label || 'this tier'}`}
                className="min-w-0 flex-1"
                value={tier.markupPercent}
                onChange={(n) => update(index, { markupPercent: n ?? 0 })}
              />
            </Suffixed>
            <Suffixed suffix={currency}>
              <NumberInput
                aria-label={`Handling fee for ${tier.label || 'this tier'}`}
                className="min-w-0 flex-1"
                value={tier.handlingFee}
                onChange={(n) => update(index, { handlingFee: n ?? 0 })}
              />
            </Suffixed>
            <Suffixed suffix={currency}>
              <NumberInput
                aria-label={`Minimum for ${tier.label || 'this tier'}`}
                className="min-w-0 flex-1"
                value={tier.minimum ?? null}
                blank
                placeholder="None"
                onChange={(n) => update(index, { minimum: n })}
              />
            </Suffixed>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${tier.label || 'this tier'}`}
              disabled={value.tiers.length <= 1}
              onClick={() => remove(index)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--color-ink-faint)]">
        Requests on a tier you remove are priced at the default tier.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={add}>
        <Plus />
        Add a tier
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

function Preview({ value }: { value: PricingSettings }) {
  const input = {
    filaments: [{ grams: SAMPLE.grams, costPerGram: null, material: SAMPLE.material }],
    printMin: SAMPLE.hours * 60,
    quantity: 1,
    printer: null,
  }
  const quotes = value.tiers.map((tier) => ({ tier, quote: quotePrint(input, value, tier) }))
  const first = quotes[0]?.quote
  if (!first) return null
  const format = (amount: number) => formatMoney(amount, value.currency)

  return (
    <div className="space-y-2 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm">
      <p className="text-[var(--color-ink-muted)]">
        A {SAMPLE.grams} g {SAMPLE.material} print taking {SAMPLE.hours} hours on a printer without
        its own rates costs you{' '}
        <span suppressHydrationWarning className="font-medium text-[var(--color-ink)]">
          {format(first.cost)}
        </span>
        :{' '}
        <span suppressHydrationWarning>
          {first.costLines
            .filter((line) => line.amount > 0)
            .map((line) => `${line.label.toLowerCase()} ${format(line.amount)}`)
            .join(', ') || 'nothing to price'}
        </span>
        .
      </p>
      <ul className="space-y-0.5">
        {quotes.map(({ tier, quote }) => (
          <li key={tier.key} className="flex justify-between gap-3">
            <span>{tier.label || 'Unnamed tier'}</span>
            <span suppressHydrationWarning className="font-medium tabular-nums">
              {format(quote.price)}
              {quote.tax > 0 && (
                <span className="font-normal text-[var(--color-ink-faint)]"> incl. VAT</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 border-t border-[var(--color-border)] pt-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
        {description && <p className="text-xs text-[var(--color-ink-faint)]">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** An input with its unit beside it, the way the rest of the settings page shows days and MB. */
function Suffixed({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {children}
      <span className="shrink-0 text-sm text-[var(--color-ink-muted)]">{suffix}</span>
    </div>
  )
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : NaN
}

/**
 * A number field that keeps what is typed as text.
 *
 * Holding the number alone would turn "0." back into "0" mid-keystroke and
 * reject a decimal comma. The settings only ever receive a number (or null,
 * where blank means "none"); anything else is held here until it parses, and
 * leaving the field shows what is actually stored.
 */
function NumberInput({
  value,
  onChange,
  blank = false,
  scale = 1,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null
  onChange: (value: number | null) => void
  /** Whether an empty field is a value (null) rather than unfinished typing. */
  blank?: boolean
  /** Shown multiplied by this: 100 edits a 0–1 share as a percentage. */
  scale?: number
}) {
  const shown = value == null ? '' : String(Math.round(value * scale * 1e6) / 1e6)
  const [draft, setDraft] = useState(shown)
  const [synced, setSynced] = useState(shown)

  // Follow a change from outside, unless the draft already says the same thing.
  if (shown !== synced) {
    setSynced(shown)
    const parsed = parseNumber(draft)
    if (parsed == null ? value != null : parsed / scale !== value) setDraft(shown)
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const parsed = parseNumber(e.target.value)
        if (parsed == null) {
          if (blank) onChange(null)
        } else if (!Number.isNaN(parsed)) {
          onChange(parsed / scale)
        }
      }}
      onBlur={() => setDraft(shown)}
      className={className ?? 'w-28'}
    />
  )
}
