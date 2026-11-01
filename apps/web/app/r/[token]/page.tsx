import { notFound } from 'next/navigation'
import { Box, Check, CircleSlash, PackageCheck, Printer, Hourglass } from 'lucide-react'
import { formatEstimate, getSettings, requestProgressByToken, type PrintRequest } from '@pb/core'
import { getDb } from '@pb/db'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { Card } from '@/components/ui/card'
import { ClockTime } from '@/components/ui/clock-time'
import { Swatch } from '@/components/ui/swatch'
import { PageHeader } from '@/components/shell/page-header'
import { LiveProgressBar } from '@/components/printer/live-progress'
import { cn } from '@/lib/cn'
import { ModelPicture } from './model-picture'

export const dynamic = 'force-dynamic'

/**
 * How one print request is going, for whoever asked for it — no account
 * needed, nothing to keep up to date by hand: it reads the queue and the
 * worker's view of the printers, like the queue page does.
 *
 * Shows that one request and nothing else; no navigation, no notes (they are
 * the printer's notes, not the asker's), no link into the library.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const progress = await requestProgressByToken(getDb(), token)
  return {
    title: progress
      ? `${STATUS_PREFIX[progress.request.status]}${progress.request.title} · Print status`
      : 'Not available',
    robots: { index: false, follow: false },
  }
}

const REFRESH_MS = 30_000

/** Leads the tab's title, so the state shows in a background tab; a running print's percentage replaces it in the browser. */
const STATUS_PREFIX: Record<PrintRequest['status'], string> = {
  requested: 'Waiting · ',
  printing: 'Printing · ',
  done: 'Ready · ',
  cancelled: 'Cancelled · ',
}

/** More than this many copies read better as a number than a row of icons. */
const MAX_COPY_ICONS = 12

export default async function RequestStatusPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const db = getDb()
  const [progress, { siteName }] = await Promise.all([
    requestProgressByToken(db, token),
    getSettings(db),
  ])
  if (!progress) notFound()

  const { request, ahead, readyInMin } = progress
  const readyAt = readyInMin != null ? readyTime(readyInMin) : null

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      {request.status !== 'done' && request.status !== 'cancelled' && (
        <AutoRefresh intervalMs={REFRESH_MS} />
      )}
      {/* The model's own picture says what is being made faster than its name. */}
      <ModelPicture
        src={request.thumbFileId ? `/r/${token}/thumb/${request.thumbFileId}` : null}
        title={request.title}
        live={
          request.status === 'printing' && request.live?.progress != null
            ? {
                progress: request.live.progress,
                remainingSec:
                  request.live.remainingMin != null ? request.live.remainingMin * 60 : null,
                ageSec: request.live.ageSec ?? 0,
                ticking: !request.live.paused,
              }
            : null
        }
      />
      <PageHeader
        eyebrow={`Print request · ${siteName}`}
        title={request.title}
        description={<Description request={request} />}
      />

      {request.status !== 'cancelled' && <Steps request={request} />}

      <Card className="space-y-3 p-5">
        {request.status === 'requested' && (
          <>
            <Headline icon={<Hourglass />} text="Waiting to be printed" />
            <p className="text-sm text-[var(--color-ink-muted)]">
              {ahead === 0
                ? 'It is next in line.'
                : `${ahead} ${ahead === 1 ? 'request is' : 'requests are'} ahead of it.`}
            </p>
            {readyAt && (
              <p className="text-sm">
                Likely ready around <ClockTime value={readyAt} />
                <span className="text-[var(--color-ink-muted)]">
                  {' '}
                  (in about {formatEstimate(readyInMin!)}, if the printer keeps going)
                </span>
              </p>
            )}
          </>
        )}

        {request.status === 'printing' && (
          <>
            <Headline
              icon={<Printer />}
              text={request.live ? `Printing on ${request.live.printerName}` : 'On the printer'}
            />
            {request.live?.progress != null && (
              <LiveProgressBar
                progress={request.live.progress}
                remainingSec={
                  request.live.remainingMin != null ? request.live.remainingMin * 60 : null
                }
                ageSec={request.live.ageSec ?? 0}
                ticking={!request.live.paused}
                label="Progress"
              />
            )}
            {readyAt ? (
              <p className="text-sm">
                Ready around <ClockTime value={readyAt} />
              </p>
            ) : (
              request.startedAt && (
                <p className="text-sm text-[var(--color-ink-muted)]">
                  Started <ClockTime value={request.startedAt.toISOString()} />
                </p>
              )
            )}
          </>
        )}

        {request.status === 'done' && (
          <>
            <Headline icon={<PackageCheck />} text="Printed — ready to collect" tone="success" />
            {request.closedAt && (
              <p className="text-sm text-[var(--color-ink-muted)]">
                Finished <ClockTime value={request.closedAt.toISOString()} />
              </p>
            )}
          </>
        )}

        {request.status === 'cancelled' && (
          <Headline icon={<CircleSlash />} text="This request was cancelled" />
        )}
        {request.quantity > 1 && request.status !== 'cancelled' && <Copies request={request} />}
      </Card>

      <p className="mt-6 text-xs text-[var(--color-ink-faint)]">
        This page updates by itself. Times are estimates from the slicer and the printer.
      </p>
    </main>
  )
}

function readyTime(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function Headline({ icon, text, tone }: { icon: React.ReactNode; text: string; tone?: 'success' }) {
  return (
    <p
      className={
        tone === 'success'
          ? 'flex items-center gap-2 text-base font-semibold text-[var(--color-success)] [&_svg]:size-5'
          : 'flex items-center gap-2 text-base font-semibold [&_svg]:size-5 [&_svg]:text-[var(--color-accent)]'
      }
    >
      {icon}
      {text}
    </p>
  )
}

function Description({ request }: { request: PrintRequest }) {
  const filament = [request.material, request.colorName].filter(Boolean).join(' · ')
  if (!request.requestedBy && !filament) return null
  return (
    <>
      {request.requestedBy && `For ${request.requestedBy}`}
      {request.requestedBy && filament && ' · '}
      {filament && (
        <span className="inline-flex items-center gap-1.5 align-middle">
          {request.colorHex && <Swatch color={request.colorHex} />}
          {filament}
        </span>
      )}
    </>
  )
}

/** Requested, printing, ready: how far along the way it is, and when each step happened. */
function Steps({ request }: { request: PrintRequest }) {
  const reached = request.status === 'done' ? 2 : request.status === 'printing' ? 1 : 0
  const steps = [
    { label: 'Requested', at: request.createdAt },
    { label: 'Printing', at: request.startedAt },
    { label: 'Ready', at: request.closedAt },
  ]
  return (
    <ol className="mb-5 grid grid-cols-3" aria-label="Progress of the request">
      {steps.map((step, index) => {
        // Asking is done the moment it is asked; printing is done once it is ready.
        const done = index === 0 || reached === 2
        const current = index === 1 && reached === 1
        return (
          <li
            key={step.label}
            aria-current={current ? 'step' : undefined}
            className="relative flex flex-col items-center text-center"
          >
            {/* The line to the previous step, coloured once this step is reached. */}
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-3 right-1/2 h-0.5 w-full -translate-y-1/2',
                  index <= reached ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]',
                )}
              />
            )}
            <span
              className={cn(
                'relative flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                done
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                  : current
                    ? 'bg-[var(--color-surface)] text-[var(--color-accent)] ring-2 ring-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              {current && (
                <span className="absolute inset-0 animate-ping rounded-full ring-2 ring-[var(--color-accent)] opacity-40 motion-reduce:hidden" />
              )}
            </span>
            <span
              className={cn(
                'mt-1.5 text-xs font-medium',
                index > reached && 'text-[var(--color-ink-faint)]',
              )}
            >
              {step.label}
            </span>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {step.at && index <= reached ? <ClockTime value={step.at.toISOString()} /> : '\u00a0'}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** One icon per copy: printed, on the printer now, still to come. */
function Copies({ request }: { request: PrintRequest }) {
  const printed = Math.min(request.printsDone, request.quantity)
  const text = `${printed} of ${request.quantity} printed`
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--color-border)] pt-3">
      {request.quantity <= MAX_COPY_ICONS && (
        <span className="flex flex-wrap gap-1" role="img" aria-label={text}>
          {Array.from({ length: request.quantity }, (_, index) => (
            <Box
              key={index}
              aria-hidden
              className={cn(
                'size-5',
                index < printed
                  ? 'text-[var(--color-success)]'
                  : index === printed && request.status === 'printing'
                    ? 'animate-pulse text-[var(--color-accent)] motion-reduce:animate-none'
                    : 'text-[var(--color-ink-faint)] opacity-50',
              )}
            />
          ))}
        </span>
      )}
      <span
        className="text-sm text-[var(--color-ink-muted)]"
        aria-hidden={request.quantity <= MAX_COPY_ICONS}
      >
        {text}
      </span>
    </div>
  )
}
