import { formatEstimate } from '@pb/core/requests'

/**
 * Number and date formatting shared across screens, so a size, a weight or a
 * duration reads the same wherever it appears.
 */

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/** Filament weight: grams up to a kilo, then kilos. */
export function formatGrams(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
}

/** A print time: "45m", "3h", "3h 20m". */
export function formatDuration(minutes: number): string {
  // The queue's and the printers' style ("6h 52m"), so a print time reads the
  // same in the history as in the estimate it came from.
  return formatEstimate(minutes)
}

/** A calendar date: "3 Oct 2026". */
export function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
