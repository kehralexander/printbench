import { notFound } from 'next/navigation'
import { CircleSlash, PackageCheck, Printer, Hourglass } from 'lucide-react'
import { formatEstimate, getSettings, requestProgressByToken } from '@pb/core'
import { getDb } from '@pb/db'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { Card } from '@/components/ui/card'
import { ClockTime } from '@/components/ui/clock-time'
import { PageHeader } from '@/components/shell/page-header'
import { LiveProgressBar } from '@/components/printer/live-progress'

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
    title: progress ? `${progress.request.title} · Print status` : 'Not available',
    robots: { index: false, follow: false },
  }
}

const REFRESH_MS = 30_000

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
  const left = Math.max(1, request.quantity - request.printsDone)
  const readyAt = readyInMin != null ? readyTime(readyInMin) : null

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      {request.status !== 'done' && request.status !== 'cancelled' && (
        <AutoRefresh intervalMs={REFRESH_MS} />
      )}
      <PageHeader
        eyebrow={`Print request · ${siteName}`}
        title={request.title}
        description={[
          request.requestedBy && `For ${request.requestedBy}`,
          request.quantity > 1 && `${request.printsDone} of ${request.quantity} printed`,
          [request.material, request.colorName].filter(Boolean).join(' · '),
        ]
          .filter(Boolean)
          .join(' · ')}
      />

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
            {left > 1 && (
              <p className="text-sm text-[var(--color-ink-muted)]">
                Print {request.printsDone + 1} of {request.quantity}.
              </p>
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
