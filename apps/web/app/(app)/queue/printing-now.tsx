'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check } from 'lucide-react'
import type { FilamentSlot } from '@pb/core'
import { formatEstimate } from '@pb/core/requests'
import { ClockTime } from '@/components/ui/clock-time'
import { cn } from '@/lib/cn'
import { partNameFromFile } from './grouping'
import {
  FilamentLine,
  PriceTag,
  RequestActions,
  RequestThumb,
  SlotDot,
  type QueueRow,
  type RowContext,
} from './request-row'

/** What the page knows about the printer a print is on, for the card's footer. */
export interface PrinterFooter {
  /** What the printer has loaded, from the worker's last reading. */
  slots: FilamentSlot[]
  /** The first waiting part that matches what is loaded, to start once this is done. */
  upNext: string | null
  /** Waiting parts that match what is loaded. */
  matching: number
  waiting: number
}

/**
 * What is on a printer right now, at the top of the queue: big enough to read
 * from across the room, with its progress, when it is done and the one thing
 * to do with it next. Its footer says what the printer has loaded, which every
 * waiting row would otherwise repeat.
 */
export function PrintingNow({
  request,
  context,
  part,
  printer,
  showRequester,
}: {
  request: QueueRow
  context: RowContext
  /** Where it falls among its model's parts, when there are several. */
  part: { index: number; of: number } | null
  printer: PrinterFooter | null
  showRequester: boolean
}) {
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

  const live = request.live
  const progress = live?.progress != null ? Math.round(live.progress * 100) : null
  const left = Math.max(1, request.quantity - request.printsDone)
  const remaining = live?.remainingMin ?? null
  // Without a live reading: from when it was started and the estimate.
  const doneAt =
    request.liveDoneAt ??
    (request.startedAt && request.estimatedMin != null
      ? new Date(
          new Date(request.startedAt).getTime() + request.estimatedMin * left * 60_000,
        ).toISOString()
      : null)
  const partLabel = partNameFromFile(request.filename)
  const where = live ? `Printing on ${live.printerName}` : 'On the printer'
  const details = [
    showRequester && request.requestedBy && `for ${request.requestedBy}`,
    request.filamentG != null && `~${Math.round(request.filamentG * left)} g`,
    part && `part ${part.index} of ${part.of}`,
    left > 1 && `${left} to print`,
  ].filter(Boolean) as string[]

  return (
    <section
      aria-label={`${where}: ${request.title}`}
      className="overflow-hidden rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--color-accent)_45%,var(--color-border))] bg-[var(--color-surface)]"
    >
      <div className="flex flex-wrap items-center gap-4 bg-[linear-gradient(90deg,var(--color-accent-soft),transparent_65%)] px-4 py-3.5">
        <RequestThumb request={request} className="size-14" />
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full bg-[var(--color-accent)]',
                live && !live.paused && 'animate-pulse',
              )}
            />
            {live?.paused ? `Paused on ${live.printerName}` : where}
          </p>
          <p className="mt-0.5 text-[0.95rem] font-semibold">
            {request.modelPublicId ? (
              <Link href={`/models/${request.modelPublicId}`} className="hover:underline">
                {request.modelName ?? request.title}
              </Link>
            ) : (
              request.title
            )}
            {partLabel && (
              <span className="font-normal text-[var(--color-ink-muted)]"> — {partLabel}</span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-ink-muted)]">
            <FilamentLine request={request} />
            {details.length > 0 && <span>· {details.join(' · ')}</span>}
            {request.price && context.billing && (
              <PriceTag price={request.price} currency={context.billing.currency} />
            )}
          </p>
          {progress != null && (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress"
              className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-[var(--color-surface-2)]"
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
                style={{ width: `${Math.max(1.5, progress)}%` }}
              />
            </div>
          )}
          {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
        </div>
        <div className="text-right">
          {progress != null && (
            <p className="text-2xl font-semibold tabular-nums leading-tight">{progress}%</p>
          )}
          <p className="text-xs text-[var(--color-ink-muted)]">
            {remaining != null && `${formatEstimate(remaining)} left · `}
            {doneAt ? (
              <>
                done around <ClockTime value={doneAt} />
              </>
            ) : (
              request.startedAt && (
                <>
                  since <ClockTime value={request.startedAt} />
                </>
              )
            )}
          </p>
        </div>
        <RequestActions
          request={request}
          context={context}
          primary="printed"
          pending={pending}
          run={run}
          onError={setError}
        />
      </div>

      {printer && (printer.slots.length > 0 || printer.upNext) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-ink-muted)]">
          {printer.slots.length > 0 && (
            <>
              <span className="text-[var(--color-ink-faint)]">Loaded</span>
              {printer.slots.map((slot) => (
                <span key={slot.index} className="inline-flex items-center gap-1">
                  <SlotDot slot={slot} />
                  <span className="font-medium text-[var(--color-ink)]">{slot.index + 1}</span>
                  {slot.loaded
                    ? [slot.material, slot.name].filter(Boolean).join(' ') || '—'
                    : 'empty'}
                </span>
              ))}
            </>
          )}
          {printer.waiting > 0 && (
            <span className="ml-auto text-[var(--color-ink-faint)]">
              {printer.upNext && <>Up next here: {printer.upNext} · </>}
              {printer.matching === printer.waiting
                ? `all ${printer.waiting} waiting match what is loaded`
                : `${printer.matching} of ${printer.waiting} waiting match what is loaded`}
              {printer.matching === printer.waiting && (
                <Check aria-hidden className="ml-1 inline size-3.5 text-[var(--color-success)]" />
              )}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
