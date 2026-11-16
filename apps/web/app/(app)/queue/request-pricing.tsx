'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Trash2 } from 'lucide-react'
import { formatMoney, type PriceStatus } from '@pb/core/pricing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDate } from '@/lib/format'
import {
  invoiceRequest,
  quoteForRequest,
  recordPayment,
  removePayment,
  requestPricing,
  setRequestPriceStatus,
  type RequestPricing,
} from './actions'
import type { QueueBilling, QueueRow } from './request-row'

/**
 * The money side of a request, inside its editor: what it would cost and be
 * quoted at now, the quote it was given, payments, and its receipt.
 *
 * Unlike the rest of the editor these act straight away — a quote or a
 * payment is a record of something that happened, not a field waiting for
 * Save. The live price is fetched on open: working it out reads spool prices
 * and print history, and most rows are never opened.
 */
export function RequestPricingPanel({
  request,
  billing,
}: {
  request: QueueRow
  billing: QueueBilling
}) {
  const router = useRouter()
  const [pricing, setPricing] = useState<RequestPricing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'transfer' | 'paypal' | 'other'>('cash')
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const money = (value: number) => formatMoney(value, billing.currency)

  const load = useCallback(async () => {
    const result = await requestPricing(request.id)
    if (result.ok) setPricing(result.pricing)
    else setError(result.error)
  }, [request.id])

  useEffect(() => {
    let cancelled = false
    void requestPricing(request.id).then((result) => {
      if (cancelled) return
      if (result.ok) setPricing(result.pricing)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [request.id])

  function act(work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error ?? 'That did not work.')
        return
      }
      after?.()
      await load()
      router.refresh()
    })
  }

  const price = request.price
  const status: PriceStatus = price?.status ?? 'none'
  const quote = pricing?.quote
  const paid = pricing ? pricing.payments.reduce((sum, payment) => sum + payment.amount, 0) : 0
  const canQuote = status !== 'invoiced' && status !== 'paid'

  return (
    <section className="space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Price</h3>
        <span className="text-xs text-[var(--color-ink-faint)]">Changes here apply at once</span>
      </div>

      {price && price.quoted != null && (
        <p className="text-sm">
          Quoted <strong>{money(price.quoted)}</strong> · {STATUS_TEXT[status]}
          {price.expired && ' · expired'}
          {price.needsRequote && (
            <span className="text-[var(--color-danger)]">
              {' '}
              · changed since, quote again before asking for it
            </span>
          )}
        </p>
      )}

      {!pricing && !error && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <Loader2 className="size-3 animate-spin" /> Working out a price…
        </p>
      )}

      {quote && (
        <div className="space-y-1 text-xs text-[var(--color-ink-muted)]">
          <p>
            Now: <strong className="text-[var(--color-ink)]">{money(quote.price)}</strong> at{' '}
            {quote.tier.label}, costing you {money(quote.cost)}
          </p>
          <ul className="grid grid-cols-[1fr_auto] gap-x-4">
            {quote.costLines
              .filter((line) => line.amount !== 0)
              .map((line) => (
                <li key={line.label} className="contents">
                  <span>{line.label}</span>
                  <span className="text-right tabular-nums">{money(line.amount)}</span>
                </li>
              ))}
          </ul>
          <p>
            Success rate {Math.round(quote.successRate * 100)} %{' '}
            {quote.successFrom === 'model'
              ? 'from earlier prints of this model'
              : quote.successFrom === 'printer'
                ? 'from earlier prints on this printer'
                : 'by default'}
            {quote.tax > 0 && ` · includes ${money(quote.tax)} VAT`}
          </p>
          {quote.incomplete.length > 0 && (
            <p className="text-[var(--color-danger)]">Not counted: {quote.incomplete.join(', ')}</p>
          )}
          {pricing?.actual && (
            <p>
              Actually cost {money(pricing.actual.cost)} over {pricing.actual.runs}{' '}
              {pricing.actual.runs === 1 ? 'print' : 'prints'}
              {pricing.actual.failed > 0 && ` (${pricing.actual.failed} failed)`}
              {price?.quotedCost != null && ` against ${money(price.quotedCost)} quoted`}
            </p>
          )}
        </div>
      )}

      {canQuote && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !quote}
            onClick={() => act(() => quoteForRequest(request.id))}
          >
            {status === 'none' ? 'Quote' : 'Quote again'}
            {quote && ` ${money(quote.price)}`}
          </Button>
          <span className="flex items-center gap-1">
            <Input
              aria-label="A price of your own"
              inputMode="decimal"
              placeholder="Or a price"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              className="h-8 w-24"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || parseAmount(manual) == null}
              onClick={() =>
                act(
                  () => quoteForRequest(request.id, parseAmount(manual)),
                  () => setManual(''),
                )
              }
            >
              Quote this
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(status === 'quoted' || status === 'declined') && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            title="They said yes some other way"
            onClick={() => act(() => setRequestPriceStatus(request.id, 'accepted'))}
          >
            Mark accepted
          </Button>
        )}
        {(status === 'quoted' || status === 'accepted') && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => setRequestPriceStatus(request.id, 'declined'))}
          >
            Mark declined
          </Button>
        )}
        {status !== 'paid' && status !== 'waived' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            title="No charge for this one"
            onClick={() => act(() => setRequestPriceStatus(request.id, 'waived'))}
          >
            Waive
          </Button>
        )}
        {(status === 'quoted' || status === 'declined' || status === 'waived') && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => setRequestPriceStatus(request.id, 'none'))}
          >
            Withdraw price
          </Button>
        )}
        {price?.invoiceId ? (
          <Button size="sm" variant="ghost" asChild>
            <a href={`/billing/invoices/${price.invoiceId}/pdf`} target="_blank" rel="noreferrer">
              <FileText />
              Invoice no. {price.invoiceNumber}
            </a>
          </Button>
        ) : (
          (status === 'accepted' || status === 'paid') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const result = await invoiceRequest(request.id)
                  if (result.ok) window.open(`/billing/invoices/${result.invoiceId}/pdf`, '_blank')
                  return result
                })
              }
            >
              <FileText />
              {status === 'paid' ? 'Write a receipt' : 'Write an invoice'}
            </Button>
          )
        )}
      </div>

      {pricing && (
        <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-medium">
            Payments
            {pricing.payments.length > 0 && (
              <span className="font-normal text-[var(--color-ink-muted)]">
                {' '}
                · {money(paid)} received
                {price?.quoted != null &&
                  paid < price.quoted &&
                  status !== 'waived' &&
                  `, ${money(price.quoted - paid)} to go`}
              </span>
            )}
          </p>
          {pricing.payments.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {pricing.payments.map((payment) => (
                <li key={payment.id} className="flex items-center gap-2">
                  <span className="tabular-nums">{money(payment.amount)}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    {METHOD_TEXT[payment.method]} · {formatDate(new Date(payment.paidAt))}
                    {payment.note && ` · ${payment.note}`}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-6"
                    aria-label="Remove this payment"
                    disabled={pending}
                    onClick={() => {
                      if (confirm('Remove this payment?')) {
                        act(() => removePayment(request.id, payment.id))
                      }
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Input
              aria-label="Amount received"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-8 w-24"
            />
            <Select
              aria-label="How it was paid"
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
              className="h-8 w-28"
            >
              {Object.entries(METHOD_TEXT).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Note"
              placeholder="Note, e.g. deposit"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="h-8 min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || parseAmount(amount) == null}
              onClick={() =>
                act(
                  () =>
                    recordPayment(request.id, {
                      amount: parseAmount(amount)!,
                      method,
                      note: note.trim() || null,
                    }),
                  () => {
                    setAmount('')
                    setNote('')
                  },
                )
              }
            >
              Record
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </section>
  )
}

const STATUS_TEXT: Record<PriceStatus, string> = {
  none: 'not quoted',
  quoted: 'waiting for their answer',
  accepted: 'accepted',
  declined: 'declined',
  invoiced: 'invoiced',
  paid: 'paid',
  waived: 'no charge',
}

const METHOD_TEXT = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  paypal: 'PayPal',
  other: 'Other',
} as const

/** "3,50" or "3.50"; negative for a refund. Null when it is not an amount. */
function parseAmount(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) && value !== 0 ? value : null
}
