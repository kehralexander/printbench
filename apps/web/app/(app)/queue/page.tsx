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
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { ClockTime } from '@/components/ui/clock-time'
import { EmptyState } from '@/components/ui/empty-state'
import { AddRequests } from './add-requests'
import { QueueList } from './queue-list'
import { ResetOrder } from './reset-order'
import type { NextHint, QueueRow, SendTarget, SpoolBadge, SpoolShortfall } from './request-row'

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
  searchParams: Promise<{ filter?: string }>
}) {
  const user = await getSessionUser()
  const policyUser = { id: user?.id ?? '', role: user?.role ?? null }

  if (!user || !can(policyUser, 'request:create')) {
    return <NotPermitted what="the print queue" />
  }

  const params = await searchParams
  const filter = FILTERS.find((option) => option.key === params.filter) ?? FILTERS[0]!

  const db = getDb()
  const [requests, stats, requesters, filaments, printers] = await Promise.all([
    listRequests(db, { status: filter.status, limit: 200 }),
    queueStats(db),
    requesterSuggestions(db),
    filamentOptions(db),
    printerSnapshots(db),
  ])
  // The look-ahead needs the open queue whatever the filter shows.
  const open =
    filter.key === 'open'
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

  return (
    <>
      <PageHeader
        title="Print queue"
        description={empty ? 'Things people have asked you to print.' : summarise(stats)}
      />
      {stats.remainingMin > 0 && (
        <p className="-mt-5 mb-6 text-sm text-[var(--color-ink-muted)]">
          All done around <ClockTime value={finishTime(stats.remainingMin)} />
          {stats.unestimated > 0 && ', plus whatever has no estimate'}
        </p>
      )}

      <div className="mb-4">
        <AddRequests requesterSuggestions={requesters} filaments={filaments} />
      </div>

      {canRun && (hints.length > 0 || forecast.length > 0) && (
        <Card className="mb-4 space-y-1.5 p-3 text-sm">
          {hints.map((hint) => (
            <p key={hint.printerId}>
              <span className="font-medium">{hint.printerName} is idle.</span>{' '}
              {hint.ready ? (
                <>
                  Ready to start: {hint.ready.request.title}
                  {hint.ready.slot && ` (slot ${hint.ready.slot.index + 1})`}.
                </>
              ) : (
                'Nothing queued matches what it has loaded.'
              )}
              {hint.swap && (
                <span className="text-[var(--color-ink-muted)]">
                  {' '}
                  Most urgent is {hint.swap.request.title}: load {hint.swap.filament}.
                </span>
              )}
            </p>
          ))}
          {forecast.map((spool) => (
            <p key={spool.spoolId} className="text-[var(--color-danger)]">
              {spoolLabel(spool.spoolId)} runs out after {spool.runsOutAfter} of the {spool.prints}{' '}
              queued prints on it (needs ~{spool.neededG} g, {Math.round(spool.remainingG)} g left).
            </p>
          ))}
        </Card>
      )}

      {!empty && (
        <nav className="mb-4 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((option) => (
            <Link
              key={option.key}
              href={`/queue?filter=${option.key}` as Route}
              aria-current={option.key === filter.key ? 'page' : undefined}
              className={
                option.key === filter.key
                  ? 'rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-sm font-medium text-[var(--color-accent)]'
                  : 'rounded-full px-3 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
              }
            >
              {option.label}
            </Link>
          ))}
          {canRun && manualOrder && filter.key === 'open' && (
            <span className="ml-auto">
              <ResetOrder />
            </span>
          )}
        </nav>
      )}

      {rows.length === 0 ? (
        /*
         * An empty queue and an empty filter are different things, and saying
         * "nothing to print" while the header counts eleven finished prints
         * would simply be wrong.
         */
        <EmptyState
          icon={<ClipboardList className="size-6" />}
          title={empty ? 'Nothing in the queue' : `Nothing ${filter.label.toLowerCase()}`}
          description={
            empty
              ? 'When someone asks you to print something, put it here. Requests do not need a file. Add what they asked for and link it to your library later, if the model turns up.'
              : 'Nothing in the queue matches this filter.'
          }
          action={
            empty ? undefined : (
              <Link
                href={'/queue' as Route}
                className="text-sm text-[var(--color-accent)] hover:underline"
              >
                Show everything
              </Link>
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
            sortable={canRun && filter.key === 'open' && rows.length > 1}
          />
        </Card>
      )}
    </>
  )
}

function spoolLabel(spoolId: number) {
  const url = spoolmanSpoolLink(spoolId)
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="underline">
      Spool #{spoolId}
    </a>
  ) : (
    `Spool #${spoolId}`
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
}): string {
  const parts: string[] = []
  if (stats.waiting > 0) parts.push(`${stats.waiting} waiting`)
  if (stats.printing > 0) parts.push(`${stats.printing} on the printer`)
  if (stats.remainingMin > 0) {
    // Said outright when it is a floor rather than a total.
    parts.push(
      `~${formatEstimate(stats.remainingMin)} of printing` +
        (stats.unestimated > 0 ? ` (+${stats.unestimated} without an estimate)` : ''),
    )
  }
  if (stats.overdue > 0) parts.push(`${stats.overdue} overdue`)
  if (stats.done > 0) parts.push(`${stats.done} printed`)

  // Everything is closed: the queue is clear, which is worth saying outright.
  return parts.length > 0 ? parts.join(' · ') : 'Nothing waiting. The queue is clear.'
}
