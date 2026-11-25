'use client'

import { useState, useTransition, type DragEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Check,
  CircleSlash,
  GripVertical,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Printer,
  RotateCcw,
  Send,
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
import { ChangeSpool, type LoadTarget } from '@/components/printer/change-spool'
import { partName, partNameFromFile } from './grouping'
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

export const STATUS_META: Record<
  PrintRequestStatus,
  { label: string; icon: LucideIcon; class: string }
> = {
  requested: {
    label: 'Waiting',
    icon: Printer,
    class: 'text-[var(--color-ink-faint)]',
  },
  printing: { label: 'Printing', icon: Play, class: 'text-[var(--color-accent)]' },
  done: { label: 'Printed', icon: Check, class: 'text-[var(--color-success)]' },
  cancelled: { label: 'Cancelled', icon: CircleSlash, class: 'text-[var(--color-ink-faint)]' },
}

/** What every way of showing a request works out from it. */
export function describeRequest(request: QueueRow) {
  const closed = request.status === 'done' || request.status === 'cancelled'
  const overdue = !closed && request.dueAt != null && new Date(request.dueAt) < new Date()
  const named = request.filaments.filter(
    (filament) =>
      filament.material || filament.colorName || filament.colorHex || filament.spoolmanSpoolId,
  )
  const look =
    named.length > 1
      ? `${named.length} colours`
      : [named[0]?.material, named[0]?.colorName].filter(Boolean).join(' ')
  // Prints still to do: the rest of the quantity once some are done.
  const left = Math.max(1, request.quantity - request.printsDone)
  const totalMin = request.estimatedMin != null ? request.estimatedMin * left : null
  const estimate =
    request.estimatedMin != null
      ? left > 1
        ? `~${formatEstimate(request.estimatedMin * left)} (${left} × ${formatEstimate(request.estimatedMin)})`
        : `~${formatEstimate(request.estimatedMin)}`
      : null
  const neededG = request.filamentG != null ? Math.round(request.filamentG * left) : null
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
    runsOut: !closed && request.shortfall?.spoolId === line.id,
  }))
  return { closed, overdue, named, look, left, totalMin, estimate, neededG, spoolLines }
}

/** Runs a row's server action and keeps its error, for every row-like thing. */
function useRowAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
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
  return { error, setError, pending, run }
}

/** Shared by everything that shows a request with its actions. */
export interface RowContext {
  canRun: boolean
  filaments: FilamentOption[]
  billing: QueueBilling | null
  /** Printers to offer Send & start for; empty when the user may not send. */
  sendTargets: SendTarget[]
  /** Where a missing spool can be loaded; null when the user may not, or nowhere. */
  loadTarget: LoadTarget | null
}

/**
 * A request's actions: at most one button for the obvious next step, and the
 * rest behind one menu, so a long queue is not a wall of identical buttons.
 *
 * `primary` picks the button: `auto` is the row's next step (send or start a
 * waiting one, finish a printing one, reopen a closed one); `printed` is for
 * the card of what is on the printer; `none` leaves only the menu.
 */
export function RequestActions({
  request,
  context,
  primary,
  pending,
  run,
  onError,
}: {
  request: QueueRow
  context: RowContext
  primary: 'auto' | 'printed' | 'none'
  pending: boolean
  run: (work: () => Promise<{ ok: boolean; error?: string }>) => void
  onError: (message: string | null) => void
}) {
  const { canRun, filaments, billing, sendTargets } = context
  /*
   * Anyone signed in may raise a request, so the person looking at this row is
   * not necessarily allowed to act on it. Editing and cancelling follow
   * authorship; starting and finishing a print follow the role. The server
   * enforces both — this only decides what is worth rendering.
   */
  const canEdit = canRun || request.mine
  const closed = request.status === 'done' || request.status === 'cancelled'
  const waiting = request.status === 'requested'
  const canSend =
    canRun && waiting && request.sendable && request.filename != null && sendTargets.length > 0

  // Opened from the menu; a fresh key each time starts the form from the request.
  const [editKey, setEditKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [linkKey, setLinkKey] = useState(0)
  const [linking, setLinking] = useState(false)
  const [sending, setSending] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Once the menu has closed and handed focus back, or the panel it opens
  // would close again straight away.
  const after = (open: () => void) => () => setTimeout(open, 0)

  const markPrinted = () => run(() => setStatus(request.id, 'done'))
  const printedTitle = request.modelPublicId
    ? 'Also records this in the print history'
    : 'Link a model to have this recorded in the print history'

  let button: ReactNode = null
  let buttonSends = false
  let buttonFinishes = false
  if (primary === 'auto') {
    if (closed && canEdit) {
      button = (
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
      )
    } else if (canSend) {
      buttonSends = true
      button = (
        <SendButton
          requestId={request.id}
          title={request.title}
          filename={request.filename!}
          targets={sendTargets}
          disabled={pending}
          onError={onError}
          variant="secondary"
        />
      )
    } else if (canRun && waiting) {
      button = (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-label={`Start printing ${request.title}`}
          onClick={() => run(() => setStatus(request.id, 'printing'))}
        >
          <Play />
          <span className="hidden sm:inline">Start</span>
        </Button>
      )
    } else if (canRun && request.status === 'printing') {
      buttonFinishes = true
    }
  } else if (primary === 'printed' && canRun && !closed) {
    buttonFinishes = true
  }
  if (buttonFinishes) {
    button = (
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        aria-label={
          request.modelPublicId
            ? `Mark ${request.title} printed and add it to the print history`
            : `Mark ${request.title} printed`
        }
        title={printedTitle}
        onClick={markPrinted}
      >
        <Check />
        <span className="hidden sm:inline">Printed</span>
      </Button>
    )
  }

  const hasMenu = canEdit || canRun
  // What the panels opened from the menu hang from: the menu's own button.
  const anchor = <span aria-hidden className="pointer-events-none absolute inset-0" />

  return (
    <div className="flex shrink-0 items-center gap-1">
      {button}
      {hasMenu && (
        <span className="relative">
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
              {!closed && canRun && (
                <>
                  {canSend && !buttonSends && (
                    <DropdownMenuItem onSelect={after(() => setSending(true))}>
                      <Send />
                      Send &amp; start…
                    </DropdownMenuItem>
                  )}
                  {waiting && (
                    <DropdownMenuItem onSelect={() => run(() => setStatus(request.id, 'printing'))}>
                      <Play />
                      Mark as on the printer
                    </DropdownMenuItem>
                  )}
                  {request.status === 'printing' && (
                    <DropdownMenuItem
                      onSelect={() => run(() => setStatus(request.id, 'requested'))}
                    >
                      <Undo2 />
                      Back to queue
                    </DropdownMenuItem>
                  )}
                  {!buttonFinishes && (
                    <DropdownMenuItem onSelect={markPrinted} title={printedTitle}>
                      <Check />
                      Mark printed
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {!closed && canEdit && (
                <>
                  <DropdownMenuItem
                    onSelect={after(() => {
                      setEditKey((key) => key + 1)
                      setEditing(true)
                    })}
                  >
                    <Pencil />
                    Edit…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={after(() => {
                      setLinkKey((key) => key + 1)
                      setLinking(true)
                    })}
                  >
                    <Link2 />
                    {request.modelName ? 'Change link…' : 'Link to library…'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={after(() => setSharing(true))}>
                    <Share2 />
                    Status link…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => run(() => setStatus(request.id, 'cancelled'))}>
                    <CircleSlash />
                    Cancel request
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {closed && canEdit && primary !== 'auto' && (
                <>
                  <DropdownMenuItem onSelect={() => run(() => setStatus(request.id, 'requested'))}>
                    <RotateCcw />
                    Reopen
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {canEdit && (
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
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {canEdit && !closed && (
            <>
              <RequestEditor
                key={`edit-${editKey}`}
                request={request}
                filaments={filaments}
                billing={billing}
                pending={pending}
                open={editing}
                onOpenChange={setEditing}
              />
              <LinkPicker
                key={`link-${linkKey}`}
                linkedName={request.modelName}
                suggestQuery={request.title}
                pending={pending}
                onLink={(modelId) => run(() => setRequestModel(request.id, modelId))}
                open={linking}
                onOpenChange={setLinking}
                anchor={anchor}
              />
            </>
          )}
          {canSend && !buttonSends && (
            <SendButton
              requestId={request.id}
              title={request.title}
              filename={request.filename!}
              targets={sendTargets}
              disabled={pending}
              onError={onError}
              open={sending}
              onOpenChange={setSending}
              anchor={anchor}
            />
          )}
          {canEdit && (
            <ShareStatusDialog
              requestId={request.id}
              title={request.title}
              open={sharing}
              onOpenChange={setSharing}
              onError={onError}
            />
          )}
        </span>
      )}
    </div>
  )
}

/** The handle a row or group is dragged by, which also moves it with the arrow keys. */
export function DragHandle({ drag, label }: { drag: RowDrag; label: string }) {
  return (
    <button
      type="button"
      disabled={drag.disabled}
      className="-ml-2 flex h-8 shrink-0 cursor-grab items-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] active:cursor-grabbing"
      aria-label={`Move ${label}: drag, or use the arrow keys`}
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
  )
}

/** The HTML drag wiring for a draggable element; it does not bubble to a group around it. */
export function dragProps(drag: RowDrag | undefined) {
  if (!drag) return {}
  return {
    draggable: !drag.disabled,
    onDragStart: (event: DragEvent) => {
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      drag.onDragStart()
    },
    onDragEnter: () => drag.onDragEnter(),
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDragEnd: (event: DragEvent) => {
      event.stopPropagation()
      drag.onDragEnd()
    },
  }
}

/** A request's picture: the model's thumbnail, else its status. */
export function RequestThumb({
  request,
  className,
}: {
  request: Pick<QueueRow, 'thumbFileId' | 'status'>
  className?: string
}) {
  const meta = STATUS_META[request.status]
  const Icon = meta.icon
  return request.thumbFileId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files/${request.thumbFileId}/thumb`}
      alt=""
      className={cn(
        'size-10 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] object-cover',
        className,
      )}
    />
  ) : (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-2)]',
        className,
      )}
    >
      <Icon className={cn('size-4', meta.class)} />
    </span>
  )
}

/** The badges that need saying wherever a request shows: how many, how urgent, held. */
function StateBadges({
  request,
  closed,
  overdue,
}: {
  request: QueueRow
  closed: boolean
  overdue: boolean
}) {
  return (
    <>
      {request.quantity > 1 && <Badge tone="neutral">×{request.quantity}</Badge>}
      {request.priority === 'high' && !closed && <Badge tone="danger">Urgent</Badge>}
      {request.priority === 'low' && !closed && <Badge tone="neutral">Low</Badge>}
      {overdue && <Badge tone="danger">Overdue</Badge>}
      {request.held === 'quote' && !closed && <Badge tone="warning">Awaiting answer</Badge>}
      {request.held === 'deposit' && !closed && <Badge tone="warning">Deposit due</Badge>}
    </>
  )
}

/**
 * The filament on one line: a dot per colour, what it is, and where it is
 * loaded — or, in red, that it is not. Replaces a separate "Loaded on…" line.
 */
export function FilamentLine({
  request,
  showPrinter = true,
  load = null,
  className,
}: {
  request: QueueRow
  /** Off where the printer is obvious, such as inside its own card. */
  showPrinter?: boolean
  /** Offer to load a missing spool into this printer. */
  load?: LoadTarget | null
  className?: string
}) {
  const { named, look, closed } = describeRequest(request)
  const verdict = request.status === 'requested' && !closed ? request.loaded : null
  const slots = verdict?.loaded
    ? verdict.matches
        .map((match) => match.slot.index + 1)
        .filter((slot, index, all) => all.indexOf(slot) === index)
    : []
  if (named.length === 0 && !verdict) {
    return (
      <span className={cn('text-xs text-[var(--color-ink-faint)]', className)}>Any filament</span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-ink-muted)]',
        className,
      )}
    >
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
      {look && <span className="text-[var(--color-ink)]">{look}</span>}
      {verdict?.loaded && (
        <span>
          · {showPrinter && `${verdict.printerName} `}
          {slots.length === 1 ? `slot ${slots[0]}` : `slots ${slots.join(', ')}`}
        </span>
      )}
      {verdict && !verdict.loaded && (
        <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
          · {request.missing ? `not loaded: ${request.missing}` : 'not loaded'}
          {verdict.instead.length > 0 && (
            <span className="flex items-center gap-0.5 text-[var(--color-ink-muted)]">
              (loaded:
              {verdict.instead.map((slot) => (
                <SlotDot key={slot.index} slot={slot} />
              ))}
              )
            </span>
          )}
          {load &&
            [...new Set(verdict.missing.map((f) => f.spoolmanSpoolId))]
              .filter((id): id is number => id != null)
              .map((id) => (
                <ChangeSpool
                  key={id}
                  hostId={load.hostId}
                  printerName={load.printerName}
                  slots={load.slots}
                  spoolId={id}
                  label={`Load #${id}`}
                />
              ))}
        </span>
      )}
    </span>
  )
}

/** Spool warnings and links, worth a line only when they say something. */
function SpoolNotes({ request }: { request: QueueRow }) {
  const { closed, left, spoolLines } = describeRequest(request)
  if (closed || spoolLines.length === 0) return null
  return (
    <>
      {spoolLines.map((line) => (
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
          {!line.short && line.runsOut && request.shortfall && (
            <span className="text-[var(--color-danger)]">
              {' '}
              · runs out before this one, after {request.shortfall.after} of the{' '}
              {request.shortfall.of} queued prints on it
            </span>
          )}
        </p>
      ))}
    </>
  )
}

/** "Next up: Kobra X is idle with it in slot 2". */
function NextOnNote({ request }: { request: QueueRow }) {
  if (request.nextOn.length === 0 || request.status !== 'requested') return null
  return (
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
  )
}

/** Where a print on the printer stands, for a request shown outside the printing card. */
function OnPrinterNote({ request, left }: { request: QueueRow; left: number }) {
  if (request.status !== 'printing') return null
  if (request.live) {
    return (
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
    )
  }
  if (!request.startedAt) return null
  return (
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
}

/**
 * One request on its own: thumbnail and title, a line of what it is, a line
 * of filament, and one button with a menu.
 */
export function RequestRow({
  request,
  context,
  drag,
  showRequester = true,
}: {
  request: QueueRow
  context: RowContext
  /** Set when the row can be dragged to a new place in the queue. */
  drag?: RowDrag
  /** Off when everything in view is for the same person. */
  showRequester?: boolean
}) {
  const { error, setError, pending, run } = useRowAction()
  const { closed, overdue, left, estimate, neededG } = describeRequest(request)
  const titleIsModel =
    request.modelPublicId != null &&
    request.modelName?.trim().toLowerCase() === request.title.trim().toLowerCase()
  const part = partNameFromFile(request.filename)

  const details = [
    part,
    showRequester && request.requestedBy && `for ${request.requestedBy}`,
    request.printsDone > 0 && `${request.printsDone} of ${request.quantity} printed`,
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
      {...dragProps(drag)}
    >
      {drag && (
        <span className="flex h-10 items-center">
          <DragHandle drag={drag} label={request.title} />
        </span>
      )}
      <RequestThumb request={request} />

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
          <StateBadges request={request} closed={closed} overdue={overdue} />
          {request.price && context.billing && (
            <PriceTag price={request.price} currency={context.billing.currency} />
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

        {!closed && <FilamentLine request={request} load={context.loadTarget} className="mt-1" />}
        <SpoolNotes request={request} />
        <OnPrinterNote request={request} left={left} />
        <NextOnNote request={request} />

        {request.notes && (
          <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-[var(--color-ink-muted)]">
            {request.notes}
          </p>
        )}
        {closed && (
          <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
            {STATUS_META[request.status].label}
            {/* Say so rather than leaving it to be discovered: the print
                history gained a row because of this button. */}
            {request.printRunId && ' · logged'}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>

      <RequestActions
        request={request}
        context={context}
        primary="auto"
        pending={pending}
        run={run}
        onError={setError}
      />
    </li>
  )
}

/**
 * One part of a group: a slim line with its name, filament, time, weight and
 * price in columns that line up down the group, and only the menu.
 *
 * With `onPrinterCard`, it is on the printer and has a card of its own at the
 * top of the page: it stays in its group so the group still adds up, but
 * highlighted and pointing there, with nothing to press twice.
 */
export function RequestPart({
  request,
  context,
  drag,
  onPrinterCard = false,
}: {
  request: QueueRow
  context: RowContext
  drag?: RowDrag
  onPrinterCard?: boolean
}) {
  const { error, setError, pending, run } = useRowAction()
  const { closed, overdue, totalMin, neededG, left } = describeRequest(request)
  const printing = request.status === 'printing'
  const highlighted = printing && onPrinterCard
  const price =
    request.price && context.billing && request.price.quoted != null
      ? formatMoney(request.price.quoted, context.billing.currency)
      : null
  const progress = request.live?.progress != null ? Math.round(request.live.progress * 100) : null

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm md:flex-nowrap',
        closed && 'opacity-60',
        highlighted && 'bg-[var(--color-accent-soft)]',
        drag?.dragging && 'bg-[var(--color-accent-soft)] opacity-70',
      )}
      {...dragProps(drag)}
    >
      {drag ? <DragHandle drag={drag} label={partName(request)} /> : <span className="-ml-2 w-4" />}
      <PartStatus status={request.status} />

      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'truncate',
              highlighted && 'font-medium text-[var(--color-accent)]',
              closed && 'line-through',
            )}
          >
            {partName(request)}
          </span>
          <StateBadges request={request} closed={closed} overdue={overdue} />
        </div>
        {highlighted && progress != null && (
          <div className="mt-1 h-1 max-w-80 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)]"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        )}
        <SpoolNotes request={request} />
        {!highlighted && <OnPrinterNote request={request} left={left} />}
        <NextOnNote request={request} />
        {request.notes && (
          <p
            className="mt-0.5 line-clamp-1 text-xs text-[var(--color-ink-muted)]"
            title={request.notes}
          >
            {request.notes}
          </p>
        )}
        {error && <p className="mt-0.5 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>

      <span className="w-full shrink-0 pl-11 md:w-56 md:pl-0">
        {highlighted ? (
          <span className="text-xs text-[var(--color-accent)]">
            On {request.live?.printerName ?? 'the printer'}
            {progress != null && ` · ${progress}%`}
            {!context.billing && ' · ↑ printing now'}
          </span>
        ) : (
          !closed && <FilamentLine request={request} load={context.loadTarget} />
        )}
      </span>
      <span className="ml-11 w-16 shrink-0 text-right tabular-nums text-[var(--color-ink-muted)] md:ml-0">
        {totalMin != null ? formatEstimate(totalMin) : '—'}
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums text-[var(--color-ink-muted)]">
        {neededG != null ? `${neededG} g` : ''}
      </span>
      {/* Only for whoever charges, so names get the room otherwise. */}
      {context.billing && (
        <span
          className={cn(
            'w-24 shrink-0 truncate text-xs',
            highlighted ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]',
          )}
          title={request.price ? PRICE_LABEL[request.price.status] : undefined}
        >
          {highlighted ? '↑ printing now' : price}
        </span>
      )}
      {highlighted ? (
        <span className="w-9 shrink-0" />
      ) : (
        <RequestActions
          request={request}
          context={context}
          primary="none"
          pending={pending}
          run={run}
          onError={setError}
        />
      )}
    </li>
  )
}

/** A part's place in its group at a glance: waiting, on the printer, printed or cancelled. */
function PartStatus({ status }: { status: PrintRequestStatus }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      title={meta.label}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
        status === 'printing'
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : status === 'done'
            ? 'border-[var(--color-success)] text-[var(--color-success)]'
            : 'border-[var(--color-border-strong)] text-[var(--color-ink-faint)]',
      )}
    >
      {status !== 'requested' && <Icon className="size-3" />}
    </span>
  )
}

export function SlotDot({ slot }: { slot: FilamentSlot }) {
  const label = [
    `Slot ${slot.index + 1}`,
    slot.material,
    slot.spoolmanSpoolId && `spool #${slot.spoolmanSpoolId}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return <Swatch color={slot.colorHex} title={label} label={label} />
}

export const PRICE_LABEL: Record<PriceStatus, string> = {
  none: '',
  quoted: 'quoted',
  accepted: 'accepted',
  declined: 'declined',
  invoiced: 'invoiced',
  paid: 'paid',
  waived: 'no charge',
}

/** The price and where it stands, for whoever does the charging. */
export function PriceTag({ price, currency }: { price: RowPrice; currency: string }) {
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
