import Link from 'next/link'
import { FileText, ReceiptText, Wallet } from 'lucide-react'
import {
  balances,
  can,
  formatMoney,
  getSettings,
  listCustomers,
  listInvoices,
  type Invoice,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { SectionHeader } from '@/components/ui/section-header'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { BalanceList, type BalanceView } from './balance-list'
import { AddCustomerButton, CustomerList } from './customer-list'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Billing' }

const PRICE_STATUS: Record<string, string> = {
  none: 'No price',
  quoted: 'Quoted',
  accepted: 'Agreed',
  declined: 'Declined',
  invoiced: 'Invoiced',
  paid: 'Paid',
  waived: 'Waived',
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const user = await getSessionUser()
  const policyUser = { id: user?.id ?? '', role: user?.role ?? null, banned: user?.banned ?? false }
  if (!user || !can(policyUser, 'billing:manage')) {
    return <NotPermitted what="billing" />
  }

  const db = getDb()
  const { pricing } = await getSettings(db)
  const invoices = await listInvoices(db)

  if (!pricing.enabled) {
    const admin = can(policyUser, 'settings:manage')
    return (
      <>
        <PageHeader title="Billing" description="Who owes what, customers and invoices." />
        <EmptyState
          icon={<Wallet />}
          title="Pricing is turned off"
          description={
            admin
              ? 'Turn on pricing in the system settings, with your rates, tiers and seller details, and requests can be quoted, invoiced and paid for.'
              : 'An admin can turn on pricing in the system settings. Until then requests carry no price.'
          }
          action={
            admin ? (
              <Button asChild variant="secondary">
                <Link href="/admin/settings">System settings</Link>
              </Button>
            ) : undefined
          }
        />
        {/* Invoices already written stay reachable: they are records. */}
        {invoices.length > 0 && <InvoiceTable invoices={invoices} className="mt-8" />}
      </>
    )
  }

  // Open balances by default; settled ones are history, a click away.
  const showAll = (await searchParams).show === 'all'
  const [owing, customers] = await Promise.all([
    balances(db, { openOnly: !showAll }),
    listCustomers(db),
  ])
  const money = (amount: number) => formatMoney(amount, pricing.currency)

  const views: BalanceView[] = owing.map((balance) => ({
    key: balance.customerId ?? `name:${balance.name.toLowerCase()}`,
    customerId: balance.customerId,
    name: balance.name,
    owed: money(balance.owed),
    paid: money(balance.paid),
    balance: balance.balance,
    balanceText: money(Math.abs(balance.balance)),
    // What "Invoice open items" would take: agreed, priced, and on no invoice yet.
    openItems: balance.requests.filter(
      (request) =>
        (request.priceStatus === 'accepted' || request.priceStatus === 'paid') &&
        request.invoiceNumber == null &&
        request.price != null,
    ).length,
    requests: balance.requests.map((request) => ({
      id: request.id,
      title: request.title,
      status: PRICE_STATUS[request.priceStatus] ?? request.priceStatus,
      cancelled: request.status === 'cancelled',
      price: request.price == null ? null : money(request.price),
      paid: request.paid !== 0 ? money(request.paid) : null,
      invoiceNumber: request.invoiceNumber,
    })),
  }))
  const debtors = owing.filter((balance) => balance.balance > 0)
  const outstanding = debtors.reduce((sum, balance) => sum + balance.balance, 0)

  return (
    <>
      <PageHeader
        title="Billing"
        description={
          outstanding > 0
            ? `${money(outstanding)} outstanding from ${debtors.length} ${debtors.length === 1 ? 'person' : 'people'}.`
            : 'Nothing outstanding. Everyone has paid what they agreed to.'
        }
        actions={<AddCustomerButton tiers={pricing.tiers} />}
      />

      <section className="mb-10">
        <SectionHeader title="Who owes what" icon={<Wallet />} />
        <FilterTabs
          options={[
            { key: 'open', label: 'Open balances', href: '/billing' },
            { key: 'all', label: 'Everyone', href: '/billing?show=all' },
          ]}
          current={showAll ? 'all' : 'open'}
        />
        {views.length === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title={showAll ? 'Nothing agreed or paid yet' : 'No open balances'}
            description={
              showAll
                ? 'Once a requester accepts a quote, or pays something, they show up here.'
                : 'Everyone is square. Settled balances are under Everyone.'
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <BalanceList balances={views} />
          </Card>
        )}
      </section>

      <section className="mb-10">
        <SectionHeader
          title="Customers"
          icon={<FileText />}
          meta={customers.length > 0 ? customers.length : undefined}
        />
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          People you print for regularly. A request whose &ldquo;requested by&rdquo; matches a
          customer&rsquo;s name, whatever the capitals, is linked to them, so their requests add up
          to one balance and take their default tier.
        </p>
        <CustomerList customers={customers} tiers={pricing.tiers} />
      </section>

      <section>
        <SectionHeader title="Invoices" icon={<ReceiptText />} />
        {invoices.length === 0 ? (
          <EmptyState
            icon={<ReceiptText />}
            title="No invoices yet"
            description="Invoice someone's open items above, or a single request from the queue."
          />
        ) : (
          <InvoiceTable invoices={invoices} />
        )}
      </section>
    </>
  )
}

function InvoiceTable({ invoices, className }: { invoices: Invoice[]; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <Table>
        <THead>
          <TR>
            <TH>No.</TH>
            <TH>Date</TH>
            <TH>For</TH>
            <TH className="text-right">Total</TH>
            <TH>
              <span className="sr-only">PDF</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {invoices.map((invoice) => (
            <TR key={invoice.id}>
              <TD className="font-medium">{invoice.number}</TD>
              <TD className="whitespace-nowrap">{formatDate(invoice.issuedAt)}</TD>
              <TD className="max-w-xs truncate">
                {invoice.recipient?.split(/\r?\n/)[0] ?? (
                  <span className="text-[var(--color-ink-faint)]">No recipient</span>
                )}
              </TD>
              <TD className="text-right">{formatMoney(invoice.total, invoice.currency)}</TD>
              <TD className="text-right">
                <Button asChild variant="ghost" size="sm">
                  {/* A route handler, not a page: a plain link, opened beside the app. */}
                  <a href={`/billing/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener">
                    <FileText />
                    PDF
                  </a>
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}
