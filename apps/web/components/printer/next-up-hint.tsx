import Link from 'next/link'
import { ListStart } from 'lucide-react'
import type { LoadNextHint } from '@pb/core'
import { Callout } from '@/components/ui/callout'

/**
 * What an idle printer could start next, and what to load for the most urgent
 * request when that is something else. The printer status page shows it on
 * the printer's card; the queue shows it only when no queue row already says
 * it (nothing matches, or a swap is advised) — so pass `showReady={false}`
 * and `printerName` there.
 */
export function NextUpHint({
  hint,
  printerName,
  showReady = true,
  className,
}: {
  hint: LoadNextHint
  /** Name the printer, for lists of hints not already on the printer's card. */
  printerName?: string
  showReady?: boolean
  className?: string
}) {
  const ready = showReady ? hint.ready : null
  if (!ready && hint.ready && !hint.swap) return null

  return (
    <Callout
      icon={<ListStart />}
      title={printerName ? `${printerName} is idle` : undefined}
      className={className}
    >
      {ready ? (
        <p>
          <span className="font-medium text-[var(--color-ink)]">Next up:</span>{' '}
          <Link href="/queue" className="text-[var(--color-accent)] hover:underline">
            {ready.request.title}
          </Link>
          {ready.slot && <> · loaded in slot {ready.slot.index + 1}</>}
        </p>
      ) : (
        !hint.ready && <p>Nothing queued matches what is loaded.</p>
      )}
      {hint.swap && (
        <p className="text-xs">
          Most urgent is {hint.swap.request.title}: load {hint.swap.filament}.
        </p>
      )}
    </Callout>
  )
}
