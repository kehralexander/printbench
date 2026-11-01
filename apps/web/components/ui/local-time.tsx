'use client'

import { formatDate } from '@/lib/format'

/**
 * A timestamp in the reader's own time zone.
 *
 * Rendered in the browser because the server usually runs in UTC inside
 * Docker, and "03:20" in a log is only useful if it is your 03:20. The server
 * render and the first client render can differ, hence the suppression.
 */
export function LocalTime({
  value,
  seconds = false,
  className,
}: {
  value: string
  seconds?: boolean
  className?: string
}) {
  const date = new Date(value)
  return (
    <time dateTime={value} title={value} className={className} suppressHydrationWarning>
      {/* The date written as formatDate writes it everywhere else ("1 Nov
          2026"); the time in the reader's own 12- or 24-hour clock. */}
      {formatDate(date)},{' '}
      {date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
      })}
    </time>
  )
}
