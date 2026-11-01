import Link from 'next/link'
import type { FilamentUsage, PrintStatus } from '@pb/core'
import { NOZZLE_TYPE_LABELS, type NozzleType } from '@pb/core/prints'
import { cn } from '@/lib/cn'
import { Facts } from '@/components/ui/facts'
import { formatDate, formatDuration, formatGrams } from '@/lib/format'
import { PRINT_OUTCOME } from '@/lib/print-outcome'
import { usageLabel, usageTotal } from '@/lib/filament-usage'
import { Swatch } from '@/components/ui/swatch'

/**
 * The library-wide print log.
 *
 * A server component: nothing here is interactive. Editing a print happens on
 * the model page, where the rest of its context is — a global list is for
 * seeing what has been coming off the plate, not for correcting it.
 */

export interface TimelinePrint {
  filamentUsage: FilamentUsage[]
  id: string
  modelName: string
  modelPublicId: string
  filename: string | null
  userName: string | null
  printerName: string | null
  material: string | null
  colorHex: string | null
  layerHeightMm: number | null
  nozzleMm: number | null
  nozzleType: NozzleType | null
  filamentBrand: string | null
  infillPercent: number | null
  slicerProfile: string | null
  status: PrintStatus
  durationMin: number | null
  filamentUsedG: number | null
  rating: number | null
  notes: string | null
  hasPhoto: boolean
  at: string
}

export function PrintTimeline({ prints }: { prints: TimelinePrint[] }) {
  return (
    <ol className="divide-y divide-[var(--color-border)]">
      {prints.map((print) => {
        const meta = PRINT_OUTCOME[print.status]
        const Icon = meta.icon

        // Same shape as the per-model row, so the two lists read alike.
        const nozzle = [
          print.nozzleMm != null && `${print.nozzleMm} mm`,
          print.nozzleType && NOZZLE_TYPE_LABELS[print.nozzleType].toLowerCase(),
        ]
          .filter(Boolean)
          .join(' ')

        const settings = [
          print.printerName,
          print.filamentUsage.length
            ? print.filamentUsage
                .map((row) => `${usageLabel(row.snapshot)}: ${formatGrams(row.grams)}`)
                .join(' · ')
            : [print.filamentBrand, print.material].filter(Boolean).join(' '),
          print.layerHeightMm != null && `${print.layerHeightMm} mm layers`,
          nozzle && `${nozzle} nozzle`,
          print.infillPercent != null && `${print.infillPercent}% infill`,
          print.slicerProfile,
          print.durationMin != null && formatDuration(print.durationMin),
          // The per-spool grams above already add up to it.
          print.filamentUsedG != null &&
            print.filamentUsedG !== usageTotal(print.filamentUsage) &&
            formatGrams(print.filamentUsedG),
        ].filter(Boolean) as string[]

        return (
          <li key={print.id} className="flex gap-3 px-4 py-3">
            <Icon
              aria-hidden
              className={cn(
                'mt-0.5 size-4 shrink-0',
                meta.textClass,
                print.status === 'in_progress' && 'animate-spin',
              )}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link
                  href={`/models/${print.modelPublicId}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {print.modelName}
                </Link>
                <span className="text-xs text-[var(--color-ink-faint)]">{meta.label}</span>
                {print.rating != null && (
                  <span
                    className="text-xs text-[var(--color-warning)]"
                    aria-label={`Rated ${print.rating} out of 5`}
                  >
                    {'★'.repeat(print.rating)}
                  </span>
                )}
                {print.colorHex && <Swatch color={print.colorHex} title={print.colorHex} />}
              </div>

              {settings.length > 0 && (
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                  <Facts items={settings} />
                </p>
              )}
              {print.notes && (
                <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                  {print.notes}
                </p>
              )}
            </div>

            {print.hasPhoto && (
              <a href={`/api/prints/${print.id}/photo`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/prints/${print.id}/photo`}
                  alt={`Photo of ${print.modelName}`}
                  loading="lazy"
                  className="size-14 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] object-cover"
                />
              </a>
            )}

            <div className="shrink-0 text-right">
              <p className="text-xs text-[var(--color-ink-faint)]">{formatDate(print.at)}</p>
              {print.userName && (
                <p className="text-xs text-[var(--color-ink-faint)]">{print.userName}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
