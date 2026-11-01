'use client'

import { useEffect, useState } from 'react'
import { formatEstimate } from '@pb/core/requests'
import { ClockTime } from '@/components/ui/clock-time'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/cn'
import { projectReading, type Reading } from './project-reading'

/**
 * A print's progress that keeps moving between page refreshes. The page
 * re-renders every few seconds with a fresh reading; in between, this ticks
 * once a second from that reading (see project-reading.ts).
 *
 * `ageSec` is how old the reading already was when the server rendered it,
 * measured on the server's clock, so a browser with the wrong time does not
 * skew it. `ticking` is false for a paused print, which stays where it is.
 */
function useProjection(reading: Reading, ageSec: number, ticking: boolean): Reading {
  // Every render of the page brings a new ageSec; counting restarts from it.
  const [counter, setCounter] = useState({ ageSec, ticks: 0 })
  if (counter.ageSec !== ageSec) setCounter({ ageSec, ticks: 0 })

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setCounter((c) => ({ ...c, ticks: c.ticks + 1 })), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  const ticks = counter.ageSec === ageSec ? counter.ticks : 0
  return projectReading(reading, ticking ? ageSec + ticks : 0)
}

/** The bar on its own, for where nothing else about the print is shown. */
export function LiveProgressBar({
  progress,
  remainingSec,
  ageSec,
  ticking,
  label,
  compact = false,
}: {
  progress: number
  remainingSec: number | null
  ageSec: number
  ticking: boolean
  label: string
  /** The dashboard's smaller bar, in whole percent. */
  compact?: boolean
}) {
  const projected = useProjection({ progress, remainingSec, elapsedSec: null }, ageSec, ticking)
  return (
    <ProgressBar progress={projected.progress!} label={label} compact={compact} paused={!ticking} />
  )
}

/** The printer status card's bar plus elapsed, remaining and finish time. */
export function PrintProgress({
  progress,
  elapsedSec,
  remainingSec,
  extrapolated,
  doneAt,
  ageSec,
  ticking,
  label,
}: {
  progress: number | null
  elapsedSec: number | null
  remainingSec: number | null
  /** Remaining was worked out from progress, not reported by the printer. */
  extrapolated: boolean
  /** ISO; when the print should finish, if the printer says how long. */
  doneAt: string | null
  ageSec: number
  ticking: boolean
  label: string
}) {
  const projected = useProjection({ progress, elapsedSec, remainingSec }, ageSec, ticking)
  return (
    <div className="space-y-2">
      {projected.progress != null && (
        <ProgressBar progress={projected.progress} label={label} paused={!ticking} />
      )}
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Fact label="Elapsed">
          {projected.elapsedSec != null ? formatEstimate(projected.elapsedSec / 60) : '—'}
        </Fact>
        <Fact
          label="Remaining"
          title={extrapolated ? 'Extrapolated from progress so far' : undefined}
        >
          {projected.remainingSec != null
            ? `${extrapolated ? '~' : ''}${formatEstimate(projected.remainingSec / 60)}`
            : '—'}
        </Fact>
        <Fact label="Done around">{doneAt ? <ClockTime value={doneAt} /> : '—'}</Fact>
      </dl>
    </div>
  )
}

function ProgressBar({
  progress,
  label,
  compact = false,
  paused = false,
}: {
  progress: number
  label: string
  compact?: boolean
  /** Drawn in the warning colour, matching the printer's "Paused" badge. */
  paused?: boolean
}) {
  const percent = compact ? Math.round(progress * 100) : Math.round(progress * 1000) / 10
  return (
    <div className={cn('flex items-center', compact ? 'gap-2' : 'gap-3')}>
      {/* Animated over the one-second tick, so the bar creeps rather than steps. */}
      <Progress
        value={progress}
        label={label}
        size={compact ? 'sm' : 'md'}
        tone={paused ? 'warning' : 'accent'}
        animated
        className="flex-1"
      />
      <span
        className={cn(
          'text-right tabular-nums',
          compact ? 'text-xs font-medium' : 'w-14 text-sm font-semibold',
        )}
      >
        {compact ? percent : percent.toFixed(percent < 10 ? 1 : 0)}%
      </span>
    </div>
  )
}

function Fact({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div title={title}>
      <dt className="text-xs text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  )
}
