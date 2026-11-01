import * as React from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { ClipboardList } from 'lucide-react'
import {
  can,
  canSendToPrinter,
  formatEstimate,
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
  type PrintRequestStatus,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { filamentOptions } from '@/lib/filament-options'
import { NotPermitted } from '@/components/shell/not-permitted'
import { NextUpHint } from '@/components/printer/next-up-hint'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ClockTime } from '@/components/ui/clock-time'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort } from '@/lib/sort'
import { AddRequests } from './add-requests'
import { QueueList } from './queue-list'
import { ResetOrder } from './reset-order'
import type { NextHint, QueueRow, SendTarget, SpoolBadge, SpoolShortfall } from './request-row'
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
  searchParams: Promise<{ filter?: string; sort?: string }>
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

  const db = getDb()
  const [requests, stats, requesters, filaments, printers] = await Promise.all([
    listRequests(db, { status: filter.status, limit: 200, sort }),
    queueStats(db),
    requesterSuggestions(db),
    filamentOptions(db),
    printerSnapshots(db),
  ])
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
    open.filter((request) => request.status === 'requested'),
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
          spoolmanSpoolId: request.spoolmanSpoolId,
          filamentG: request.filamentG,
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
    material: request.material,
    colorHex: request.colorHex,
    colorName: request.colorName,
    estimatedMin: request.estimatedMin,
    startedAt: request.startedAt?.toISOString() ?? null,
    spoolmanSpoolId: request.spoolmanSpoolId,
    spool: request.spoolmanSpoolId != null ? (spools.get(request.spoolmanSpoolId) ?? null) : null,
    filamentG: request.filamentG,
    printsDone: request.printsDone,
    live: request.live,
    liveDoneAt: request.live?.remainingMin != null ? finishTime(request.live.remainingMin) : null,
    loaded:
      request.status === 'done' || request.status === 'cancelled'
        ? null
        : loadedFilament(request, printerSlots),
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

  // Idle printers whose next print no queue row already announces: nothing
  // loaded matches, or the most urgent request needs a different filament.
  const idleNotes = canRun ? hints.filter((hint) => !hint.ready || hint.swap) : []
  const sortLabel = QUEUE_SORTS.find((option) => option.value === sort)!.label
  const withSort = (query: Record<string, string>) => {
    const search = new URLSearchParams(query)
    if (!manual) search.set('sort', sort)
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
        <Card className="overflow-hidden">
          <QueueList
            rows={rows}
            canRun={canRun}
            filaments={filaments}
            sendTargets={sendTargets}
            sortable={canRun && manual && filter.key === 'open' && rows.length > 1}
          />
        </Card>
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
