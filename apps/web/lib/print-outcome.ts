import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

/**
 * How a print came out, worded and coloured the same everywhere: the print
 * history, the "how did it go?" list and the printer jobs the library did not
 * know. Covers both a logged print's status and a printer job's outcome.
 */

export type PrintOutcome = 'success' | 'failed' | 'partial' | 'in_progress' | 'cancelled'

export type OutcomeTone = 'success' | 'danger' | 'warning' | 'accent' | 'neutral'

export interface OutcomeMeta {
  label: string
  /** Matches a Badge tone. */
  tone: OutcomeTone
  icon: LucideIcon
  /** Text colour for the icon, when shown without a Badge. */
  textClass: string
}

export const PRINT_OUTCOME: Record<PrintOutcome, OutcomeMeta> = {
  success: {
    label: 'Printed',
    tone: 'success',
    icon: CheckCircle2,
    textClass: 'text-[var(--color-success)]',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    icon: XCircle,
    textClass: 'text-[var(--color-danger)]',
  },
  partial: {
    label: 'Partial',
    tone: 'warning',
    icon: CircleDashed,
    textClass: 'text-[var(--color-warning)]',
  },
  in_progress: {
    label: 'Printing',
    tone: 'accent',
    icon: Loader2,
    textClass: 'text-[var(--color-accent)]',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    icon: CircleSlash,
    textClass: 'text-[var(--color-ink-faint)]',
  },
}
