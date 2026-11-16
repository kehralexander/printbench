'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, FileText, Loader2, ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { invoiceOpenItems } from './actions'

export interface BalanceView {
  key: string
  customerId: string | null
  name: string
  owed: string
  paid: string
  /** Positive is still to pay; negative is credit. */
  balance: number
  /** The balance's size, formatted; the sign is said in words. */
  balanceText: string
  /** Agreed requests on no invoice yet. */
  openItems: number
  requests: {
    id: string
    title: string
    status: string
    cancelled: boolean
    price: string | null
    paid: string | null
    invoiceNumber: number | null
  }[]
}

/** One row per customer, or per name for people who are not customers. */
export function BalanceList({ balances }: { balances: BalanceView[] }) {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {balances.map((balance) => (
        <BalanceRow key={balance.key} balance={balance} />
      ))}
    </ul>
  )
}

function BalanceRow({ balance }: { balance: BalanceView }) {
  const [open, setOpen] = useState(false)
  const settled = Math.abs(balance.balance) < 0.01

  return (
    <li>
      <div className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {balance.name}
              {!balance.customerId && <Badge tone="neutral">not a customer</Badge>}
            </span>
            <span className="block text-xs text-[var(--color-ink-muted)]">
              Owed {balance.owed} · paid {balance.paid} · {balance.requests.length}{' '}
              {balance.requests.length === 1 ? 'request' : 'requests'}
            </span>
          </span>
        </button>

        <span
          className={cn(
            'text-sm tabular-nums',
            balance.balance > 0 && 'font-semibold',
            balance.balance < 0 && 'text-[var(--color-success)]',
            settled && 'text-[var(--color-ink-muted)]',
          )}
        >
          {settled
            ? 'Settled'
            : balance.balance > 0
              ? `${balance.balanceText} to pay`
              : `${balance.balanceText} credit`}
        </span>

        <InvoiceOpenItems
          customerId={balance.customerId}
          name={balance.name}
          count={balance.openItems}
        />
      </div>

      {open && (
        <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          {balance.requests.map((request) => (
            <li
              key={request.id}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-10 pr-4 text-sm"
            >
              <Link
                href="/queue?filter=all"
                className="min-w-0 flex-1 basis-48 truncate hover:underline"
              >
                {request.title}
              </Link>
              <Badge tone={request.status === 'Paid' ? 'success' : 'neutral'}>
                {request.status}
              </Badge>
              {request.cancelled && <Badge tone="warning">cancelled</Badge>}
              <span className="tabular-nums">{request.price ?? '—'}</span>
              {request.paid && (
                <span className="tabular-nums text-[var(--color-ink-muted)]">
                  paid {request.paid}
                </span>
              )}
              <span className="text-[var(--color-ink-muted)]">
                {request.invoiceNumber != null ? `Invoice ${request.invoiceNumber}` : 'No invoice'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Writes one invoice for whatever this person has agreed to and not been
 * invoiced for. Keeps the link to what it wrote after the page refreshes,
 * when there is nothing left to invoice and the button itself is gone.
 */
function InvoiceOpenItems({
  customerId,
  name,
  count,
}: {
  customerId: string | null
  name: string
  count: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [written, setWritten] = useState<{ id: string; number: number } | null>(null)

  function invoice() {
    setError(null)
    startTransition(async () => {
      const result = await invoiceOpenItems({ customerId, name })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setWritten({ id: result.id, number: result.number })
      router.refresh()
    })
  }

  if (!written && count === 0) return null

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {written && (
        <Button asChild variant="secondary" size="sm">
          <a href={`/billing/invoices/${written.id}/pdf`} target="_blank" rel="noopener">
            <FileText />
            Invoice {written.number}
          </a>
        </Button>
      )}
      {count > 0 && (
        <Button
          variant={written ? 'ghost' : 'secondary'}
          size="sm"
          onClick={invoice}
          disabled={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : <ReceiptText />}
          Invoice open items ({count})
        </Button>
      )}
      {error && <p className="basis-full text-right text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
