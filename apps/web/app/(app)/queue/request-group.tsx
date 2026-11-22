'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatEstimate } from '@pb/core/requests'
import { formatMoney } from '@pb/core/pricing'
import { Badge } from '@/components/ui/badge'
import { Swatch } from '@/components/ui/swatch'
import { cn } from '@/lib/cn'
import { groupTitle, type RowGroup } from './grouping'
import {
  DragHandle,
  PRICE_LABEL,
  RequestPart,
  RequestThumb,
  describeRequest,
  dragProps,
  type QueueRow,
  type RowContext,
  type RowDrag,
} from './request-row'
import { SendButton } from './send-button'

/**
 * Every request for one model, for one person, as one card: the model, who it
 * is for and what it all comes to said once, then a line per part. One button
 * sends the next part that can be sent.
 */
export function RequestGroup({
  group,
  context,
  onPrinterCard,
  showRequester,
  drag,
  partDrag,
}: {
  group: RowGroup<QueueRow>
  context: RowContext
  /** Requests with a card of their own at the top of the page. */
  onPrinterCard: Set<string>
  showRequester: boolean
  drag?: RowDrag
  partDrag: (id: string) => RowDrag | undefined
}) {
  const [error, setError] = useState<string | null>(null)
  const rows = group.rows
  const first = rows[0]!
  const title = groupTitle(group)
  const thumb = rows.find((row) => row.thumbFileId) ?? first
  const waiting = rows.filter((row) => row.status === 'requested')
  const printing = rows.filter((row) => row.status === 'printing').length
  const done = rows.filter((row) => row.status === 'done').length

  const counts =
    printing + done === 0
      ? `${rows.length} parts`
      : [
          printing > 0 && `${printing} of ${rows.length} printing`,
          done > 0 && `${done} of ${rows.length} printed`,
          waiting.length > 0 && `${waiting.length} waiting`,
        ]
          .filter(Boolean)
          .join(' · ')
  // What is still to print: the waiting parts, which is what the time is for.
  const described = waiting.map(describeRequest)
  const minutes = described.reduce((sum, row) => sum + (row.totalMin ?? 0), 0)
  const grams = described.reduce((sum, row) => sum + (row.neededG ?? 0), 0)
  const colours = [
    ...new Map(
      rows
        .flatMap((row) => row.filaments)
        .filter((filament) => filament.colorHex)
        .map((filament) => [filament.colorHex!.toLowerCase(), filament]),
    ).values(),
  ]
  const meta = [
    showRequester && first.requestedBy && `for ${first.requestedBy}`,
    counts,
    minutes > 0 && `~${formatEstimate(minutes)}`,
    grams > 0 && `${grams} g`,
  ].filter(Boolean) as string[]

  const priced = context.billing ? rows.filter((row) => row.price?.quoted != null) : []
  const total = priced.reduce((sum, row) => sum + row.price!.quoted!, 0)
  const statuses = new Set(priced.map((row) => row.price!.status))
  const status = statuses.size === 1 ? [...statuses][0]! : null
  const held = rows.some((row) => row.held === 'quote' && row.status === 'requested')

  const next = waiting.find((row) => row.sendable && row.filename)
  const canSend = context.canRun && next != null && context.sendTargets.length > 0

  return (
    <section
      aria-label={title}
      className={cn(
        'overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        drag?.dragging && 'opacity-70',
      )}
      {...dragProps(drag)}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        {drag && <DragHandle drag={drag} label={title} />}
        <RequestThumb request={thumb} />
        <div className="min-w-0 flex-1 basis-56">
          {first.modelPublicId ? (
            <Link
              href={`/models/${first.modelPublicId}`}
              className="text-sm font-semibold hover:underline"
            >
              {title}
            </Link>
          ) : (
            <span className="text-sm font-semibold">{title}</span>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-ink-muted)]">
            {meta.join(' · ')}
            {colours.length > 0 && (
              <span className="flex items-center gap-0.5">
                {colours.map((filament) => {
                  const label = [filament.material, filament.colorName].filter(Boolean).join(' ')
                  return (
                    <Swatch
                      key={filament.colorHex}
                      color={filament.colorHex}
                      title={label}
                      label={label}
                    />
                  )
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {priced.length > 0 && context.billing && (
            <Badge
              tone={status === 'paid' ? 'success' : status === 'declined' ? 'danger' : 'neutral'}
              title={`${priced.length} of ${rows.length} parts priced`}
            >
              {formatMoney(total, context.billing.currency)}
              {status && status !== 'none' && ` · ${PRICE_LABEL[status]}`}
            </Badge>
          )}
          {held && <Badge tone="warning">Awaiting answer</Badge>}
          {canSend && (
            <SendButton
              requestId={next.id}
              title={next.title}
              filename={next.filename!}
              targets={context.sendTargets}
              disabled={false}
              onError={setError}
              variant="secondary"
              label="Send next"
            />
          )}
        </div>
        {error && <p className="basis-full text-xs text-[var(--color-danger)]">{error}</p>}
      </header>
      <ul className="divide-y divide-[color-mix(in_oklch,var(--color-border)_60%,transparent)]">
        {rows.map((row) => (
          <RequestPart
            key={row.id}
            request={row}
            context={context}
            drag={partDrag(row.id)}
            onPrinterCard={onPrinterCard.has(row.id)}
          />
        ))}
      </ul>
    </section>
  )
}
