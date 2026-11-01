import type { PrinterStatus } from '@pb/core'
import type { SortOption } from '@/lib/sort'

/**
 * How a printer's state reads wherever it is shown — the dashboard and the
 * printer status page — so a paused printer is the same word and the same
 * colour on both.
 */

export type PrinterStateTone = 'accent' | 'warning' | 'danger' | 'neutral'

const STATE: Record<PrinterStatus['state'], { label: string; tone: PrinterStateTone }> = {
  printing: { label: 'Printing', tone: 'accent' },
  // Waiting on someone, which is worth catching the eye.
  paused: { label: 'Paused', tone: 'warning' },
  idle: { label: 'Idle', tone: 'neutral' },
  complete: { label: 'Finished', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
  offline: { label: 'Offline', tone: 'danger' },
}

export function printerState(state: PrinterStatus['state']): {
  label: string
  tone: PrinterStateTone
} {
  return STATE[state]
}

/**
 * When the job should finish, from a reading taken at `readAt` (epoch ms).
 * A paused job has no finish time; it ends whenever someone resumes it.
 */
export function printDoneAt(status: PrinterStatus, readAt: number): string | null {
  if (status.state !== 'printing' || status.remainingSec == null) return null
  return new Date(readAt + status.remainingSec * 1000).toISOString()
}

/** Busy printers first, then the ones free to use, then the ones in trouble. */
const STATE_RANK: Record<PrinterStatus['state'], number> = {
  printing: 0,
  paused: 1,
  complete: 2,
  cancelled: 2,
  idle: 2,
  error: 3,
  offline: 4,
}

export function compareState(a: PrinterStatus['state'], b: PrinterStatus['state']): number {
  return STATE_RANK[a] - STATE_RANK[b]
}

export type PrinterSort = 'name' | 'status'

export const PRINTER_SORTS: readonly SortOption<PrinterSort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
]
