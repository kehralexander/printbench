'use client'

import { useSyncExternalStore } from 'react'

/**
 * A time of day in the reader's own timezone: "14:35", or "Tue 09:10" when it
 * is not today.
 *
 * Formatted only in the browser. The server renders in its own timezone —
 * usually UTC in a container — and hydration keeps the server's text, so a
 * time formatted there would be hours off for everyone reading it.
 */
export function ClockTime({ value }: { value: string }) {
  const text = useSyncExternalStore(
    noSubscription,
    () => format(value),
    () => null,
  )
  return <time dateTime={value}>{text ?? '…'}</time>
}

function noSubscription() {
  return () => {}
}

function format(value: string): string {
  const date = new Date(value)
  const today = new Date().toDateString() === date.toDateString()
  return date.toLocaleString(undefined, {
    ...(today ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}
