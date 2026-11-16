'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Check,
  CircleSlash,
  GripVertical,
  MoreHorizontal,
  Play,
  Printer,
  RotateCcw,
  Share2,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import {
  formatEstimate,
  type PrintRequestPriority,
  type PrintRequestStatus,
  type RequestFilament,
} from '@pb/core/requests'
import { formatMoney, type PriceStatus } from '@pb/core/pricing'
import type { FilamentSlot, LivePrint, LoadedVerdict } from '@pb/core'
import { Badge } from '@/components/ui/badge'
import { Swatch } from '@/components/ui/swatch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import type { FilamentOption } from '@/lib/filament-options'
import { ClockTime } from '@/components/ui/clock-time'
import { LinkPicker } from './link-picker'
import { RequestEditor } from './request-editor'
import { SendButton } from './send-button'
import { ShareStatusDialog } from './share-status'
import { removeRequest, setRequestModel, setStatus } from './actions'

export interface SpoolBadge {
  remainingG: number | null
  archived: boolean
  /** Spoolman's page for the spool. */
  url: string | null
}

/** A printer the row can send to; `busy` is the worker's last reading. */
export interface SendTarget {
  id: string
  name: string
  busy: boolean
}

/** Drag-to-reorder wiring for a row, from the list around it. */
export interface RowDrag {
  dragging: boolean
  disabled: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  /** Keyboard: one place up (-1) or down (+1). */
  onMove: (delta: number) => void
}

/** Where the spool this asks for runs dry, when it does before this one. */
export interface SpoolShortfall {
  spoolId: number
  /** Queued prints the spool still covers. */
  after: number
  /** Queued prints on the spool in all. */
  of: number
}

/** One of the filaments a request prints in, with its Spoolman spool's state. */
export interface QueueFilament extends RequestFilament {
  /** Live state of its Spoolman spool; null when Spoolman is off, down, or lost it. */
  spool: SpoolBadge | null
}

/** Where a request's price stands, for whoever does the charging. */
export interface RowPrice {
  status: PriceStatus
  quoted: number | null
  /** What it was expected to cost, when quoted. */
  quotedCost: number | null
  paid: number
  needsRequote: boolean
  expired: boolean
  invoiceId: string | null
  invoiceNumber: number | null
}

/** What the editor needs to charge for a request; null when the viewer does not charge. */
export interface QueueBilling {
  currency: string
  tiers: { key: string; label: string }[]
  defaultTier: string
  customers: { id: string; name: string }[]
}

/** What an idle printer could start next, shown on the row it points at. */
export interface NextHint {
  printerName: string
  slotIndex: number | null
}

export interface QueueRow {
  id: string
  title: string
  notes: string | null
  requestedBy: string | null
  quantity: number
  priority: PrintRequestPriority
  status: PrintRequestStatus
  /** Every filament it prints in, in tool order; empty for "any". */
  filaments: QueueFilament[]
  /** Minutes for one print. */
  estimatedMin: number | null
  /** ISO; set while it is on the printer. */
  startedAt: string | null
  /** Grams for one print across every filament, from the chosen G-code. */
  filamentG: number | null
  /** Prints finished towards `quantity`. */
  printsDone: number
  /** The watched printer it is on, with its live progress. */
  live: LivePrint | null
  /** ISO; when the print on the printer should finish, from `live`. */
  liveDoneAt: string | null
  /** Whether every asked-for filament is in one printer's slots; null when unknowable. */
  loaded: LoadedVerdict | null
  /** The filaments not loaded, by name, when `loaded` says some are not. */
  missing: string | null
  /** Waiting on its requester rather than the printer. */
  held: 'quote' | 'deposit' | null
  customerId: string | null
  customerName: string | null
  pricingTier: string | null
  /** Set only for whoever does the charging, once it has a price. */
  price: RowPrice | null
  /** The chosen file is sliced output a printer accepts. */
  sendable: boolean
  /** The spool will not stretch to this one, given everything before it. */
  shortfall: SpoolShortfall | null
  /** An idle printer could start this one now, with what it has loaded. */
  nextOn: NextHint[]
  /** ISO strings: Dates do not need to survive the round trip, only render. */
  dueAt: string | null
  createdAt: string
  /** Set once marking it printed has written it to the print history. */
  printRunId: string | null
  modelId: string | null
  modelFileId: string | null
  modelPublicId: string | null
  modelName: string | null
  modelMissing: boolean
  thumbFileId: string | null
  filename: string | null
  /** True when the signed-in user raised this one. */
  mine: boolean
}

const STATUS_META: Record<PrintRequestStatus, { label: string; icon: LucideIcon; class: string }> =
  {
    requested: {
      label: 'Waiting',
      icon: Printer,
      class: 'text-[var(--color-ink-faint)]',
    },
    printing: { label: 'Printing', icon: Play, class: 'text-[var(--color-accent)]' },
    done: { label: 'Printed', icon: Check, class: 'text-[var(--color-success)]' },
    cancelled: { label: 'Cancelled', icon: CircleSlash, class: 'text-[var(--color-ink-faint)]' },
  }

export function RequestRow({
  request,
  canRun,
  filaments,
  billing,
  sendTargets,
  drag,
}: {
  request: QueueRow
  canRun: boolean
  filaments: FilamentOption[]
  billing: QueueBilling | null
  /** Printers to offer Send & start for; empty when the user may not send. */
  sendTargets: SendTarget[]
  /** Set when the row can be dragged to a new place in the queue. */
  drag?: RowDrag
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /*
   * Anyone signed in may raise a request, so the person looking at this row is
   * not necessarily allowed to act on it. Editing and cancelling follow
   * authorship; starting and finishing a print follow the role. The server
   * enforces both — this only decides what is worth rendering.
   */
  const canEdit = canRun || request.mine

  const meta = STATUS_META[request.status]
  const Icon = meta.icon
  const closed = request.status === 'done' || request.status === 'cancelled'
  const [sharing, setSharing] = useState(false)
  const titleIsModel =
    request.modelPublicId != null &&
    request.modelName?.trim().toLowerCase() === request.title.trim().toLowerCase()
  const overdue = !closed && request.dueAt != null && new Date(request.dueAt) < new Date()

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error ?? 'That did not work.')
        return
      }
      router.refresh()
    })
  }

  const named = request.filaments.filter(
    (filament) =>
      filament.material || filament.colorName || filament.colorHex || filament.spoolmanSpoolId,
  )
  const look =
    named.length > 1
      ? `${named.length} colours`
      : [named[0]?.material, named[0]?.colorName].filter(Boolean).join(' · ')
  // Prints still to do: the rest of the quantity once some are done.
  const left = Math.max(1, request.quantity - request.printsDone)
  const estimate =
    request.estimatedMin != null
      ? left > 1
        ? `~${formatEstimate(request.estimatedMin * left)} (${left} × ${formatEstimate(request.estimatedMin)})`
        : `~${formatEstimate(request.estimatedMin)}`
      : null

  const neededG = request.filamentG != null ? request.filamentG * left : null
  // The Spoolman spools it draws on, each with what it needs from it. Only a
  // warning while it still matters, and only with both numbers known.
  const spoolLines = [
    ...request.filaments
      .filter((filament) => filament.spoolmanSpoolId != null)
      .reduce((bySpool, filament) => {
        const line = bySpool.get(filament.spoolmanSpoolId!) ?? {
          id: filament.spoolmanSpoolId!,
          spool: filament.spool,
          needed: 0 as number | null,
        }
        line.needed =
          line.needed == null || filament.grams == null ? null : line.needed + filament.grams * left
        bySpool.set(filament.spoolmanSpoolId!, line)
        return bySpool
      }, new Map<number, { id: number; spool: SpoolBadge | null; needed: number | null }>())
      .values(),
  ].map((line) => ({
    ...line,
    needed: line.needed == null ? null : Math.ceil(line.needed),
    short:
      !closed &&
      line.needed != null &&
      line.spool?.remainingG != null &&
      line.needed > line.spool.remainingG,
  }))

  const details = [
    request.requestedBy && `for ${request.requestedBy}`,
    request.printsDone > 0 && `${request.printsDone} of ${request.quantity} printed`,
    look,
    request.filename,
    !closed && estimate,
    !closed && neededG != null && `~${neededG} g`,
    request.dueAt && `${overdue ? 'was due' : 'due'} ${formatDate(request.dueAt)}`,
  ].filter(Boolean) as string[]

  return (
    <li
      className={cn(
        'flex flex-wrap items-start gap-3 px-4 py-3',
        closed && 'opacity-60',
        drag?.dragging && 'bg-[var(--color-accent-soft)] opacity-70',
      )}
      draggable={drag != null && !drag.disabled}
      onDragStart={
        drag
          ? (event) => {
              event.dataTransfer.effectAllowed = 'move'
              drag.onDragStart()
            }
          : undefined
      }
      onDragEnter={drag ? () => drag.onDragEnter() : undefined}
      onDragOver={drag ? (event) => event.preventDefault() : undefined}
      onDragEnd={drag ? () => drag.onDragEnd() : undefined}
    >
      {drag && (
        <button
          type="button"
          disabled={drag.disabled}
          className="-ml-2 flex h-10 cursor-grab items-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] active:cursor-grabbing"
          aria-label={`Move ${request.title}: drag, or use the arrow keys`}
          title="Drag to reorder"
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              drag.onMove(event.key === 'ArrowUp' ? -1 : 1)
            }
          }}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {request.thumbFileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${request.thumbFileId}/thumb`}
          alt=""
          className="size-10 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded bg-[var(--color-surface-2)]">
          <Icon className={cn('size-4', meta.class)} />
        </span>
      )}

      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {titleIsModel ? (
            <Link
              href={`/models/${request.modelPublicId}`}
              className={cn('text-sm font-medium hover:underline', closed && 'line-through')}
            >
              {request.title}
            </Link>
          ) : (
            <span className={cn('text-sm font-medium', closed && 'line-through')}>
              {request.title}
            </span>
          )}
          {request.quantity > 1 && <Badge tone="neutral">×{request.quantity}</Badge>}
          {request.priority === 'high' && !closed && <Badge tone="danger">Urgent</Badge>}
          {request.priority === 'low' && !closed && <Badge tone="neutral">Low</Badge>}
          {overdue && <Badge tone="danger">Overdue</Badge>}
          {/* One swatch per colour, so a two-colour print reads as one at a glance. */}
          {named.some((filament) => filament.colorHex) && (
            <span className="flex items-center gap-0.5">
              {named.map((filament, index) => {
                const label = [
                  filament.tool != null && `T${filament.tool}`,
                  filament.material,
                  filament.colorName,
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <Swatch
                    key={`${filament.tool}-${index}`}
                    color={filament.colorHex}
                    title={label}
                    label={label}
                  />
                )
              })}
            </span>
          )}
          {request.held === 'quote' && !closed && <Badge tone="warning">Awaiting answer</Badge>}
          {request.held === 'deposit' && !closed && <Badge tone="warning">Deposit due</Badge>}
          {request.price && billing && (
            <PriceTag price={request.price} currency={billing.currency} />
          )}
        </div>

        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {/*
           * The state of the library link is the thing worth saying on every
           * row: a request nobody can find a file for is the one that stalls,
           * and it should be visible without opening anything. When the title
           * already is the model's name, the title is the link.
           */}
          {titleIsModel ? (
            [request.modelMissing && 'Missing from disk', ...details].filter(Boolean).join(' · ')
          ) : request.modelPublicId ? (
            <>
              <Link
                href={`/models/${request.modelPublicId}`}
                className="text-[var(--color-accent)] hover:underline"
              >
                {request.modelName}
              </Link>
              {request.modelMissing && ' (missing from disk)'}
              {details.length > 0 && ` · ${details.join(' · ')}`}
            </>
          ) : (
            <>
              <span className="text-[var(--color-ink-faint)]">Not in the library yet</span>
              {details.length > 0 && ` · ${details.join(' · ')}`}
            </>
          )}
        </p>

        {!closed &&
          spoolLines.map((line) => (
            <p key={line.id} className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              {line.spool?.url ? (
                <a
                  href={line.spool.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  Spool #{line.id}
                </a>
              ) : (
                `Spool #${line.id}`
              )}
              {line.spool?.remainingG != null && ` · ${Math.round(line.spool.remainingG)} g left`}
              {line.spool?.archived && ' · archived'}
              {line.short && (
                <span className="text-[var(--color-danger)]">
                  {' '}
                  · not enough for {left > 1 ? `all ${left}` : 'this'} (needs ~{line.needed} g)
                </span>
              )}
              {!line.short && request.shortfall?.spoolId === line.id && (
                <span className="text-[var(--color-danger)]">
                  {' '}
                  · runs out before this one, after {request.shortfall.after} of the{' '}
                  {request.shortfall.of} queued prints on it
                </span>
              )}
            </p>
          ))}

        {request.status === 'printing' && request.live ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            <Link href="/printers" className="text-[var(--color-accent)] hover:underline">
              On {request.live.printerName}
            </Link>
            {request.live.progress != null && ` · ${Math.round(request.live.progress * 100)}%`}
            {request.liveDoneAt && (
              <>
                {' · done around '}
                <ClockTime value={request.liveDoneAt} />
              </>
            )}
            {left > 1 && `, then ${left - 1} more`}
          </p>
        ) : (
          request.status === 'printing' &&
          request.startedAt && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              On the printer since <ClockTime value={request.startedAt} />
              {request.estimatedMin != null && (
                <>
                  {' · done around '}
                  <ClockTime
                    value={new Date(
                      new Date(request.startedAt).getTime() + request.estimatedMin * left * 60_000,
                    ).toISOString()}
                  />
                </>
              )}
            </p>
          )
        )}

        {request.loaded && request.status === 'requested' && (
          <LoadedHint verdict={request.loaded} missing={request.missing} />
        )}

        {request.nextOn.length > 0 && request.status === 'requested' && (
          <p className="mt-0.5 text-xs font-medium text-[var(--color-accent)]">
            Next up:{' '}
            {request.nextOn
              .map((hint) =>
                hint.slotIndex != null
                  ? `${hint.printerName} is idle with it in slot ${hint.slotIndex + 1}`
                  : `${hint.printerName} is idle`,
              )
              .join('; ')}
          </p>
        )}

        {request.notes && (
          <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-[var(--color-ink-muted)]">
            {request.notes}
          </p>
        )}

        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {closed ? (
          <>
            <span className="mr-1 text-xs text-[var(--color-ink-faint)]">
              {meta.label}
              {/* Say so rather than leaving it to be discovered: the print
                  history gained a row because of this button. */}
              {request.printRunId && ' · logged'}
            </span>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Reopen ${request.title}`}
                onClick={() => run(() => setStatus(request.id, 'requested'))}
              >
                <RotateCcw />
                <span className="hidden sm:inline">Reopen</span>
              </Button>
            )}
          </>
        ) : (
          <>
            {/* First, because its label changes width ("Link to library" or
                "Change link"): the buttons after it stay lined up row to row. */}
            {canEdit && (
              <LinkPicker
                linkedName={request.modelName}
                suggestQuery={request.title}
                pending={pending}
                onLink={(modelId) => run(() => setRequestModel(request.id, modelId))}
              />
            )}

            {canRun && request.status === 'requested' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Start printing ${request.title}`}
                onClick={() => run(() => setStatus(request.id, 'printing'))}
              >
                <Play />
                <span className="hidden sm:inline">Start</span>
              </Button>
            )}

            {canRun &&
              request.status === 'requested' &&
              request.sendable &&
              request.filename &&
              sendTargets.length > 0 && (
                <SendButton
                  requestId={request.id}
                  title={request.title}
                  filename={request.filename}
                  targets={sendTargets}
                  disabled={pending}
                  onError={setError}
                />
              )}

            {canRun && request.status === 'printing' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Put ${request.title} back in the queue`}
                onClick={() => run(() => setStatus(request.id, 'requested'))}
              >
                <Undo2 />
                <span className="hidden sm:inline">Back to queue</span>
              </Button>
            )}

            {canRun && (
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                aria-label={
                  request.modelPublicId
                    ? `Mark ${request.title} printed and add it to the print history`
                    : `Mark ${request.title} printed`
                }
                title={
                  request.modelPublicId
                    ? 'Also records this in the print history'
                    : 'Link a model to have this recorded in the print history'
                }
                onClick={() => run(() => setStatus(request.id, 'done'))}
              >
                <Check />
                <span className="hidden sm:inline">Printed</span>
              </Button>
            )}

            {canEdit && (
              <RequestEditor
                request={request}
                filaments={filaments}
                billing={billing}
                pending={pending}
              />
            )}
          </>
        )}

        {canEdit && (
          // Sharing, cancelling and removing are occasional, so they wait
          // behind one button rather than adding three more icons to every row.
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  aria-label={`More actions for ${request.title}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {!closed && (
                  <>
                    <DropdownMenuItem onSelect={() => setSharing(true)}>
                      <Share2 />
                      Status link…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => run(() => setStatus(request.id, 'cancelled'))}
                    >
                      <CircleSlash />
                      Cancel request
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => {
                    /*
                     * Cancelling keeps the record and is what people usually mean.
                     * Deleting is for a request that should never have existed, so
                     * it is the one that asks.
                     */
                    if (confirm(`Remove "${request.title}" from the queue entirely?`)) {
                      run(() => removeRequest(request.id))
                    }
                  }}
                >
                  <Trash2 />
                  Remove…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ShareStatusDialog
              requestId={request.id}
              title={request.title}
              open={sharing}
              onOpenChange={setSharing}
              onError={setError}
            />
          </>
        )}
      </div>
    </li>
  )
}

/** Whether the filaments this asks for are in a printer right now. */
function LoadedHint({ verdict, missing }: { verdict: LoadedVerdict; missing: string | null }) {
  if (verdict.loaded) {
    const slots = verdict.matches.map((match) => match.slot)
    const distinct = slots.filter(
      (slot, index) => slots.findIndex((other) => other.index === slot.index) === index,
    )
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        {distinct.map((slot) => (
          <SlotDot key={slot.index} slot={slot} />
        ))}
        Loaded on {verdict.printerName},{' '}
        {distinct.length === 1
          ? `slot ${distinct[0]!.index + 1}`
          : `slots ${distinct.map((slot) => slot.index + 1).join(', ')}`}
      </p>
    )
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-danger)]">
      {missing ? `Not loaded: ${missing}` : 'Not loaded'}
      {verdict.instead.length > 0 && (
        <span className="flex items-center gap-1 text-[var(--color-ink-muted)]">
          (loaded:
          {verdict.instead.map((slot) => (
            <SlotDot key={slot.index} slot={slot} />
          ))}
          )
        </span>
      )}
    </p>
  )
}

function SlotDot({ slot }: { slot: FilamentSlot }) {
  const label = [
    `Slot ${slot.index + 1}`,
    slot.material,
    slot.spoolmanSpoolId && `spool #${slot.spoolmanSpoolId}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return <Swatch color={slot.colorHex} title={label} label={label} />
}

const PRICE_LABEL: Record<PriceStatus, string> = {
  none: '',
  quoted: 'quoted',
  accepted: 'accepted',
  declined: 'declined',
  invoiced: 'invoiced',
  paid: 'paid',
  waived: 'no charge',
}

/** The price and where it stands, for whoever does the charging. */
function PriceTag({ price, currency }: { price: RowPrice; currency: string }) {
  const amount = price.quoted != null ? formatMoney(price.quoted, currency) : null
  const state = price.needsRequote
    ? 'needs requote'
    : price.expired
      ? 'quote expired'
      : PRICE_LABEL[price.status]
  const tone =
    price.status === 'declined'
      ? 'danger'
      : price.needsRequote || price.expired
        ? 'warning'
        : price.status === 'paid'
          ? 'success'
          : 'neutral'
  const owing =
    price.quoted != null && price.paid > 0 && price.paid < price.quoted && price.status !== 'waived'
  return (
    <Badge tone={tone} title={owing ? `${formatMoney(price.paid, currency)} paid` : undefined}>
      {[price.status === 'waived' ? null : amount, state, owing && 'part paid']
        .filter(Boolean)
        .join(' · ')}
    </Badge>
  )
}
