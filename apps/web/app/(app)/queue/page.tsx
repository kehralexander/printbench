import * as React from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { ClipboardList } from 'lucide-react'
import {
  can,
  canSendToPrinter,
  describeFilaments,
  formatEstimate,
  getSettings,
  heldForRequester,
  listCustomers,
  quoteExpired,
  listRequests,
  loadNextHints,
  loadedFilament,
  spoolForecast,
  printerSnapshots,
  listSpoolmanSpools,
  spoolmanEnabled,
  spoolmanSpoolLink,
  queueStats,
  requesterSuggestions,
  type PrintRequest,
  type PrintRequestStatus,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { filamentOptions } from '@/lib/filament-options'
import { spoolLoadTarget } from '@/lib/load-target'
import { NotPermitted } from '@/components/shell/not-permitted'
import { NextUpHint } from '@/components/printer/next-up-hint'
import { Button } from '@/components/ui/button'
import { ClockTime } from '@/components/ui/clock-time'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort } from '@/lib/sort'
import { AddRequests } from './add-requests'
import { GroupControl, type QueueGrouping } from './group-control'
import { groupRows, partName } from './grouping'
import { PrintingNow, type PrinterFooter } from './printing-now'
import { QueueList } from './queue-list'
import { ResetOrder } from './reset-order'
import type {
  NextHint,
  QueueBilling,
  QueueRow,
  RowContext,
  SendTarget,
  SpoolBadge,
  SpoolShortfall,
} from './request-row'
import { QUEUE_SORTS } from './sort'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Print queue' }

const FILTERS: { key: string; label: string; status?: PrintRequestStatus[] }[] = [
  { key: 'open', label: 'To print', status: ['requested', 'printing'] },
  { key: 'printing', label: 'On the printer', status: ['printing'] },
  { key: 'done', label: 'Printed', status: ['done'] },
  { key: 'cancelled', label: 'Cancelled', status: ['cancelled'] },
  { key: 'all', label: 'Everything' },
]

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string; group?: string }>
}) {
  const user = await getSessionUser()
  const policyUser = { id: user?.id ?? '', role: user?.role ?? null }

  if (!user || !can(policyUser, 'request:create')) {
    return <NotPermitted what="the print queue" />
  }

  const params = await searchParams
  const filter = FILTERS.find((option) => option.key === params.filter) ?? FILTERS[0]!
  // Anything but the queue's own order is only a way of looking at it.
  const sort = pickSort(params.sort, QUEUE_SORTS, 'manual')
  const manual = sort === 'manual'
  const grouping: QueueGrouping = params.group === 'none' ? 'none' : 'model'

  const db = getDb()
  const [requests, stats, requesters, filaments, printers, { pricing }] = await Promise.all([
    listRequests(db, { status: filter.status, limit: 200, sort }),
    queueStats(db),
    requesterSuggestions(db),
    filamentOptions(db),
    printerSnapshots(db),
    getSettings(db),
  ])
  // Prices are for whoever does the charging; a viewer may be the one charged.
  const canBill = pricing.enabled && can(policyUser, 'billing:manage')
  const billing: QueueBilling | null = canBill
    ? {
        currency: pricing.currency,
        tiers: pricing.tiers.map((tier) => ({ key: tier.key, label: tier.label })),
        defaultTier: pricing.defaultTier,
        customers: (await listCustomers(db)).map((customer) => ({
          id: customer.id,
          name: customer.name,
        })),
      }
    : null
  /** Waiting on its requester: a quote not accepted, a deposit not paid. */
  const heldFor = (request: PrintRequest) =>
    heldForRequester(
      { priceStatus: request.priceStatus, quotedPrice: request.quotedPrice, paid: request.paid },
      pricing,
    )
  // The look-ahead needs the open queue, in queue order, whatever the view.
  const open =
    filter.key === 'open' && manual
      ? requests
      : await listRequests(db, { status: ['requested', 'printing'], limit: 200 })

  // What the watched printers have loaded, from the worker's last reading.
  const printerSlots = printers
    .filter((printer) => printer.fresh && printer.status?.slots)
    .map((printer) => ({ printerName: printer.name, slots: printer.status!.slots! }))

  // Live spool state for the badges. Cached briefly; when Spoolman is down the
  // rows simply show no spool, rather than the page failing.
  const spoolman = spoolmanEnabled() ? await listSpoolmanSpools() : null
  const spools = new Map<number, SpoolBadge>(
    spoolman?.ok
      ? spoolman.spools.map((spool) => [
          spool.id,
          {
            remainingG: spool.remainingG,
            archived: spool.archived,
            url: spoolmanSpoolLink(spool.id),
          },
        ])
      : [],
  )

  // What each idle printer could start next, from what it has loaded.
  const idle = printers
    .filter(
      (printer) =>
        printer.fresh &&
        printer.status &&
        !printer.status.busy &&
        printer.status.state !== 'offline' &&
        printer.status.state !== 'error',
    )
    .map((printer) => ({ id: printer.id, name: printer.name, slots: printer.status!.slots ?? [] }))
  const hints = loadNextHints(
    idle,
    open
      .filter((request) => request.status === 'requested')
      .map((request) => ({
        id: request.id,
        title: request.title,
        filaments: request.filaments,
        held: heldFor(request) != null,
      })),
  )
  const nextOn = new Map<string, NextHint[]>()
  for (const hint of hints) {
    if (!hint.ready) continue
    const list = nextOn.get(hint.ready.request.id) ?? []
    list.push({ printerName: hint.printerName, slotIndex: hint.ready.slot?.index ?? null })
    nextOn.set(hint.ready.request.id, list)
  }

  // Whether the spools last for everything queued on them, in queue order.
  const forecast = spoolman?.ok
    ? spoolForecast(
        open.map((request) => ({
          id: request.id,
          title: request.title,
          status: request.status === 'printing' ? 'printing' : 'requested',
          filaments: request.filaments,
          left: Math.max(1, request.quantity - request.printsDone),
          progress: request.live?.progress ?? null,
        })),
        new Map(spoolman.spools.map((spool) => [spool.id, spool.remainingG])),
      ).filter((spool) => spool.runsOutAfter != null)
    : []
  const shortfalls = new Map<string, SpoolShortfall>()
  for (const spool of forecast) {
    for (const id of spool.shortRequestIds) {
      shortfalls.set(id, { spoolId: spool.spoolId, after: spool.runsOutAfter!, of: spool.prints })
    }
  }
  const manualOrder = open.some((request) => request.position != null)

  // Working the queue is a member's job; asking is open to anyone signed in.
  const canRun = can(policyUser, 'request:manage')
  const sendTargets: SendTarget[] =
    canRun && can(policyUser, 'printhost:send')
      ? printers.map((printer) => ({
          id: printer.id,
          name: printer.name,
          busy: printer.fresh && printer.status?.busy === true,
        }))
      : []
  const empty = stats.waiting + stats.printing + stats.done + stats.cancelled === 0

  const rows: QueueRow[] = requests.map((request) => ({
    id: request.id,
    title: request.title,
    notes: request.notes,
    requestedBy: request.requestedBy,
    quantity: request.quantity,
    priority: request.priority,
    status: request.status,
    filaments: request.filaments.map((filament) => ({
      ...filament,
      spool:
        filament.spoolmanSpoolId != null ? (spools.get(filament.spoolmanSpoolId) ?? null) : null,
    })),
    estimatedMin: request.estimatedMin,
    startedAt: request.startedAt?.toISOString() ?? null,
    filamentG: request.filamentG,
    printsDone: request.printsDone,
    live: request.live,
    liveDoneAt: request.live?.remainingMin != null ? finishTime(request.live.remainingMin) : null,
    ...loadedFor(request),
    held: request.status === 'requested' ? heldFor(request) : null,
    customerId: request.customerId,
    customerName: request.customerName,
    pricingTier: request.pricingTier,
    price:
      canBill && request.priceStatus !== 'none'
        ? {
            status: request.priceStatus,
            quoted: request.quotedPrice,
            quotedCost: request.quotedCost,
            paid: request.paid,
            needsRequote: request.needsRequote,
            expired: quoteExpired(request),
            invoiceId: request.invoiceId,
            invoiceNumber: request.invoiceNumber,
          }
        : null,
    sendable:
      request.modelFileId != null &&
      request.filename != null &&
      canSendToPrinter(request.filename.split('.').pop() ?? ''),
    shortfall: shortfalls.get(request.id) ?? null,
    nextOn: nextOn.get(request.id) ?? [],
    dueAt: request.dueAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    printRunId: request.printRunId,
    modelId: request.modelId,
    modelFileId: request.modelFileId,
    modelPublicId: request.modelPublicId,
    modelName: request.modelName,
    modelMissing: request.modelMissing,
    thumbFileId: request.thumbFileId,
    filename: request.filename,
    mine: request.createdBy === user.id,
  }))

  /** Whether its filaments are in a printer, and the missing ones by name. */
  function loadedFor(request: PrintRequest): Pick<QueueRow, 'loaded' | 'missing'> {
    if (request.status === 'done' || request.status === 'cancelled') {
      return { loaded: null, missing: null }
    }
    const loaded = loadedFilament(request.filaments, printerSlots)
    return {
      loaded,
      missing: loaded && !loaded.loaded ? describeFilaments(loaded.missing) : null,
    }
  }

  // Idle printers whose next print no queue row already announces: nothing
  // loaded matches, or the most urgent request needs a different filament.
  const idleNotes = canRun ? hints.filter((hint) => !hint.ready || hint.swap) : []
  const loadTarget = canRun ? await spoolLoadTarget(db, policyUser) : null
  const context: RowContext = { canRun, filaments, billing, sendTargets, loadTarget }
  // "for Alexander" on every row says nothing when every row is for Alexander.
  const showRequester =
    new Set(rows.map((row) => row.requestedBy?.trim().toLowerCase() ?? '')).size > 1

  /*
   * What is on a printer gets a card of its own at the top of the open queue,
   * with what that printer has loaded underneath. Its row then stays out of
   * the list, or slim in its model's group so the group still adds up.
   */
  const showPrinting = filter.key === 'open' || filter.key === 'printing'
  const printingRows = showPrinting ? rows.filter((row) => row.status === 'printing') : []
  const onPrinterCard = new Set(printingRows.map((row) => row.id))
  const allGroups = groupRows(rows, grouping === 'model')
  const waitingRows = rows.filter((row) => row.status === 'requested')
  const printingCards = printingRows.map((row) => {
    const group = allGroups.find((candidate) => candidate.rows.some((r) => r.id === row.id))
    const part =
      group && group.rows.length > 1
        ? { index: group.rows.findIndex((r) => r.id === row.id) + 1, of: group.rows.length }
        : null
    const snapshot = row.live
      ? printers.find((printer) => printer.fresh && printer.name === row.live!.printerName)
      : undefined
    const matching = snapshot
      ? waitingRows.filter(
          (waiting) => waiting.loaded?.loaded && waiting.loaded.printerName === snapshot.name,
        )
      : []
    const printer: PrinterFooter | null = snapshot
      ? {
          slots: snapshot.status?.slots ?? [],
          upNext: matching[0] ? partName(matching[0]) : null,
          matching: matching.length,
          waiting: waitingRows.length,
        }
      : null
    return { row, part, printer }
  })
  const listRows = filter.key === 'printing' ? [] : rows
  const listed = listRows.filter((row) => !onPrinterCard.has(row.id)).length

  const sortLabel = QUEUE_SORTS.find((option) => option.value === sort)!.label
  const withSort = (query: Record<string, string>) => {
    const search = new URLSearchParams(query)
    if (!manual) search.set('sort', sort)
    if (grouping !== 'model') search.set('group', grouping)
    return `/queue?${search.toString()}`
  }

  return (
    <>
      <AddRequests
        title="Print queue"
        description={empty ? 'Things people have asked you to print.' : summarise(stats)}
        requesterSuggestions={requesters}
        filaments={filaments}
      />

      {idleNotes.length > 0 && (
        <div className="mb-4 space-y-2">
          {idleNotes.map((hint) => (
            <NextUpHint
              key={hint.printerId}
              hint={hint}
              printerName={hint.printerName}
              showReady={false}
            />
          ))}
        </div>
      )}

      {!empty && (
        <FilterTabs
          options={FILTERS.map((option) => ({
            key: option.key,
            label: option.label,
            href: withSort({ filter: option.key }),
          }))}
          current={filter.key}
          trailing={
            <>
              {canRun && filter.key === 'open' && !manual && (
                <span className="text-xs text-[var(--color-ink-faint)]">
                  Sorted by {sortLabel.toLowerCase()} — switch to Manual to drag
                </span>
              )}
              {canRun && manual && manualOrder && filter.key === 'open' && <ResetOrder />}
              <GroupControl value={grouping} />
              <UrlSortControl
                options={QUEUE_SORTS}
                value={sort}
                defaultValue="manual"
                count={rows.length}
              />
            </>
          }
        />
      )}

      {rows.length === 0 ? (
        /*
         * An empty queue and an empty filter are different things, and saying
         * "nothing to print" while the header counts eleven finished prints
         * would simply be wrong.
         */
        <EmptyState
          icon={<ClipboardList />}
          title={empty ? 'Nothing in the queue' : `Nothing ${filter.label.toLowerCase()}`}
          description={
            empty
              ? 'When someone asks you to print something, put it here. Requests do not need a file. Add what they asked for and link it to your library later, if the model turns up.'
              : 'Nothing in the queue matches this filter.'
          }
          action={
            empty ? undefined : (
              <Button asChild variant="secondary">
                <Link href={withSort({ filter: 'all' }) as Route}>Show everything</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          {printingCards.length > 0 && (
            <div className="mb-5 space-y-3">
              {printingCards.map(({ row, part, printer }) => (
                <PrintingNow
                  key={row.id}
                  request={row}
                  context={context}
                  part={part}
                  printer={printer}
                  showRequester={showRequester}
                />
              ))}
            </div>
          )}
          {listed > 0 && (
            <>
              {printingCards.length > 0 && (
                <h2 className="mb-2 ml-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                  Up next · {listed}
                </h2>
              )}
              <QueueList
                rows={listRows}
                context={context}
                sortable={canRun && manual && filter.key === 'open' && rows.length > 1}
                grouped={grouping === 'model'}
                onPrinterCard={[...onPrinterCard]}
                showRequester={showRequester}
              />
            </>
          )}
        </>
      )}
    </>
  )
}

/** When the open queue is through, printing back to back from now. */
function finishTime(remainingMin: number): string {
  return new Date(Date.now() + remainingMin * 60_000).toISOString()
}

function summarise(stats: {
  waiting: number
  printing: number
  done: number
  overdue: number
  remainingMin: number
  unestimated: number
}): React.ReactNode {
  const parts: React.ReactNode[] = []
  if (stats.waiting > 0) parts.push(`${stats.waiting} waiting`)
  if (stats.printing > 0) parts.push(`${stats.printing} on the printer`)
  if (stats.remainingMin > 0) {
    // Said outright when it is a floor rather than a total.
    parts.push(
      <>
        ~{formatEstimate(stats.remainingMin)} of printing, all done around{' '}
        <ClockTime value={finishTime(stats.remainingMin)} />
        {stats.unestimated > 0 && ` (+${stats.unestimated} without an estimate)`}
      </>,
    )
  }
  if (stats.overdue > 0) parts.push(`${stats.overdue} overdue`)
  if (stats.done > 0) parts.push(`${stats.done} printed`)

  // Everything is closed: the queue is clear, which is worth saying outright.
  if (parts.length === 0) return 'Nothing waiting. The queue is clear.'
  return parts.map((part, index) => (
    <React.Fragment key={index}>
      {index > 0 && ' · '}
      {part}
    </React.Fragment>
  ))
}
