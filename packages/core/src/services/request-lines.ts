/**
 * The parts of the print queue that both sides need.
 *
 * Kept free of any database import so it can be reached from a client
 * component: the add form previews how a pasted message will be split before
 * it is saved, and it has to do that with the same parser the server uses. Two
 * implementations of these rules would drift, and the drift would show up as
 * the preview quietly lying about what was about to happen.
 *
 * Reachable as `@pb/core/requests`; the server-side service re-exports it, so
 * server callers still have a single import.
 */

export type PrintRequestStatus = 'requested' | 'printing' | 'done' | 'cancelled'
export type PrintRequestPriority = 'low' | 'normal' | 'high'

export const REQUEST_STATUSES: readonly PrintRequestStatus[] = [
  'requested',
  'printing',
  'done',
  'cancelled',
]
export const REQUEST_PRIORITIES: readonly PrintRequestPriority[] = ['low', 'normal', 'high']

export const MAX_TITLE = 200
export const MAX_NOTES = 5000
export const MAX_NAME = 120
export const MAX_QUANTITY = 999

/**
 * How many requests one submission may create.
 *
 * The bulk box exists for a message with a handful of things in it. A cap
 * keeps a stray paste of an entire document from becoming a thousand rows that
 * then have to be deleted one at a time.
 */
export const MAX_BULK_REQUESTS = 50

export interface ParsedRequestLine {
  title: string
  quantity: number
}

/*
 * Both spellings of a quantity, because both turn up: "cable clip x4" and
 * "4x cable clip".
 *
 * Whitespace is required on the side facing the title, which is what stops
 * "Gridfinity 2x2" being read as two of a bin called "Gridfinity 2". A
 * quantity is only ever a multiplier hanging off an end, never a dimension
 * inside the name.
 */
const TRAILING_QUANTITY = /\s+[x×]\s*(\d{1,3})$/i
const LEADING_QUANTITY = /^(\d{1,3})\s*[x×]\s+/i

/**
 * Turns a pasted message into requests, one per line.
 *
 * Blank lines are dropped, and so is the list punctuation that comes along
 * with the text — a leading "-", "*" or "1." is formatting, not part of what
 * someone wants printed.
 */
export function parseRequestLines(text: string): ParsedRequestLine[] {
  const lines: ParsedRequestLine[] = []

  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.trim().replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '')
    if (stripped.length === 0) continue

    let title = stripped
    let quantity = 1

    const trailing = title.match(TRAILING_QUANTITY)
    if (trailing) {
      quantity = Number(trailing[1])
      title = title.slice(0, trailing.index).trim()
    } else {
      const leading = title.match(LEADING_QUANTITY)
      if (leading) {
        quantity = Number(leading[1])
        title = title.slice(leading[0].length).trim()
      }
    }

    /*
     * A backstop, not a case seen in practice: the whitespace rules above
     * cannot strip a whole line. It is here so a blank title can never reach
     * the insert and trip the check constraint from inside a batch.
     */
    if (title.length === 0) continue

    lines.push({ title: title.slice(0, MAX_TITLE), quantity: clampQuantity(quantity) })
    if (lines.length >= MAX_BULK_REQUESTS) break
  }

  return lines
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.trunc(value), 1), MAX_QUANTITY)
}

/** A month of printing. Anything longer is a typo, not an estimate. */
export const MAX_ESTIMATE_MIN = 30 * 24 * 60

/**
 * Reads a typed print time into minutes, or null when it is not one.
 *
 * Accepts what people actually type: "2h 10m", "2h", "45m", "1.5h", "2:10"
 * (hours and minutes, as slicers display it), "1d 2h", and a bare number,
 * which is minutes. Blank means "no estimate", which is also null — callers
 * tell the two apart by whether the input was empty.
 */
export function parseEstimate(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (text.length === 0) return null

  let minutes: number
  const clock = text.match(/^(\d{1,4}):([0-5]\d)$/)
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2])
  } else if (/^\d+(?:\.\d+)?$/.test(text)) {
    minutes = Number(text)
  } else {
    const units: Record<string, number> = { d: 1440, h: 60, m: 1 }
    const pattern = /(\d+(?:[.,]\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\s*/gy
    minutes = 0
    let consumed = 0
    for (const match of text.matchAll(pattern)) {
      if (match.index !== consumed) return null
      minutes += Number(match[1]!.replace(',', '.')) * units[match[2]![0]!]!
      consumed = match.index + match[0].length
    }
    if (consumed !== text.length || consumed === 0) return null
  }

  const rounded = Math.round(minutes)
  return rounded >= 1 && rounded <= MAX_ESTIMATE_MIN ? rounded : null
}

/** "2h 10m", "45m", "1d 3h" — the same shape parseEstimate reads back. */
export function formatEstimate(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}
