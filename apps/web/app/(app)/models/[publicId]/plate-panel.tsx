'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Hand, Loader2 } from 'lucide-react'
import { Callout } from '@/components/ui/callout'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Swatch } from '@/components/ui/swatch'
import { formatDuration, formatGrams } from '@/lib/format'
import { FileDownloadLink } from './file-download-link'
import { OpenInSlicer } from './open-in-slicer'
import { SendToPrinter } from './send-to-printer'
import { readPlateDetails } from './plate-actions'
import type { Plate } from './plate-strip'
import type { PlateDetails, PlateFilament, TimelineStop } from './slicer-summaries'

type Loaded = { ok: true; details: PlateDetails } | { ok: false; error: string }

/**
 * Everything one sliced file says about itself, beside the plates table.
 *
 * The figures are fetched when the panel opens, not sent with the page, and
 * kept for as long as the page is: reopening a plate is instant.
 */
export function PlatePanel({
  publicId,
  plate,
  onClose,
}: {
  publicId: string
  plate: Plate | null
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const current = plate ? loaded[plate.id] : undefined

  useEffect(() => {
    if (!plate || loaded[plate.id]) return
    let cancelled = false
    void readPlateDetails(publicId, plate.id).then((result) => {
      if (!cancelled) setLoaded((all) => ({ ...all, [plate.id]: result }))
    })
    return () => {
      cancelled = true
    }
  }, [publicId, plate, loaded])

  const name = plate ? (plate.filename.split('/').pop() ?? plate.filename) : ''

  return (
    <Sheet open={plate != null} onOpenChange={(open) => !open && onClose()}>
      {plate && (
        <SheetContent
          title={<span title={plate.filename}>{name}</span>}
          description={plate.slicer?.printerName ?? undefined}
        >
          <div className="space-y-6">
            {plate.thumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={plate.thumbUrl}
                alt=""
                className="mx-auto max-h-64 w-full rounded bg-[var(--color-surface-2)] object-contain"
              />
            )}

            <div className="flex flex-wrap items-center gap-1">
              {plate.canSendToPrinter && (
                <SendToPrinter fileId={plate.id} filename={plate.filename} />
              )}
              {plate.canOpenInSlicer && (
                <OpenInSlicer fileId={plate.id} filename={plate.filename} />
              )}
              <FileDownloadLink fileId={plate.id} filename={plate.filename} />
            </div>

            {!current ? (
              <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                <Loader2 className="size-4 animate-spin" /> Loading details…
              </p>
            ) : current.ok ? (
              <Details details={current.details} />
            ) : (
              <Callout>{current.error}</Callout>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  )
}

function Details({ details }: { details: PlateDetails }) {
  const { time, geometry, machine, settings, timeline } = details
  const firstStop = timeline.stops[0]

  return (
    <>
      {timeline.stopCount > 0 && (
        <Callout tone="warning" icon={<Hand />}>
          Stops {timeline.stopCount === 1 ? 'once' : `${timeline.stopCount} times`} for someone at
          the printer
          {firstStop?.elapsedMin != null
            ? `, first after ${formatDuration(firstStop.elapsedMin)}`
            : ''}
          .
        </Callout>
      )}

      <Section title="Time">
        <Facts
          rows={[
            ['Estimated', minutes(time.durationMin ?? time.totalDurationMin)],
            [
              'Printing alone',
              time.modelDurationMin != null && time.modelDurationMin !== time.durationMin
                ? formatDuration(time.modelDurationMin)
                : null,
            ],
            [
              'Preparation',
              time.modelDurationMin != null && time.totalDurationMin != null
                ? overhead(time.totalDurationMin - time.modelDurationMin)
                : null,
            ],
            ['First layer', minutes(time.firstLayerDurationMin)],
            ['Silent mode', minutes(time.silentDurationMin)],
          ]}
        />
      </Section>

      <Section title="Filament">
        <FilamentTable details={details} />
      </Section>

      <Section title="Timeline">
        <Timeline details={details} />
      </Section>

      <Section title="Size">
        <Facts
          rows={[
            [
              'Layers',
              joined(
                [
                  geometry.layerCount != null ? String(geometry.layerCount) : null,
                  geometry.layerHeightMm != null ? `${geometry.layerHeightMm} mm` : null,
                ],
                ' × ',
              ),
            ],
            ['Height', geometry.maxZMm != null ? `${mm(geometry.maxZMm)} mm` : null],
            [
              'Footprint',
              geometry.extents
                ? `${mm(geometry.extents.maxX - geometry.extents.minX)} × ${mm(
                    geometry.extents.maxY - geometry.extents.minY,
                  )} mm`
                : null,
            ],
          ]}
        />
        <BedDiagram details={details} />
      </Section>

      {(details.objects.length > 0 || details.objectCount != null) && (
        <Section title={`Objects${details.objectCount != null ? ` · ${details.objectCount}` : ''}`}>
          {details.objects.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {details.objects.map((object) => (
                <li key={object} className="truncate" title={object}>
                  {object}
                </li>
              ))}
              {details.objectCount != null && details.objectCount > details.objects.length && (
                <li className="text-[var(--color-ink-muted)]">
                  and {details.objectCount - details.objects.length} more
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">The file does not name them.</p>
          )}
        </Section>
      )}

      <Section title="Settings">
        <Facts
          rows={[
            ['Infill', settings.infillPercent != null ? `${settings.infillPercent} %` : null],
            ['Walls', settings.wallCount != null ? String(settings.wallCount) : null],
            ['Supports', settings.supports == null ? null : settings.supports ? 'Yes' : 'No'],
            ['Adhesion', settings.adhesion ? capitalise(settings.adhesion) : null],
            [
              'Nozzle temperature',
              settings.nozzleTempC != null ? `${settings.nozzleTempC} °C` : null,
            ],
            ['Bed temperature', settings.bedTempC != null ? `${settings.bedTempC} °C` : null],
            ['Profile', settings.slicerProfile],
          ]}
        />
      </Section>

      <Section title="Machine">
        <Facts
          rows={[
            ['Printer', machine.printerModel ?? machine.printerName],
            [
              'Preset',
              machine.printerPreset !== machine.printerModel ? machine.printerPreset : null,
            ],
            [
              'Nozzle',
              joined([
                machine.nozzleMm != null ? `${machine.nozzleMm} mm` : null,
                machine.nozzleType ? capitalise(machine.nozzleType.replace(/_/g, ' ')) : null,
              ]),
            ],
            [
              'Build volume',
              geometry.bed
                ? `${mm(geometry.bed.maxX - geometry.bed.minX)} × ${mm(
                    geometry.bed.maxY - geometry.bed.minY,
                  )}${geometry.printableHeightMm != null ? ` × ${mm(geometry.printableHeightMm)}` : ''} mm`
                : null,
            ],
            ['G-code flavour', machine.gcodeFlavor],
            ['Sliced with', joined([settings.slicerName, settings.slicerVersion], ' ')],
          ]}
        />
      </Section>
    </>
  )
}

/** One row per slot, with what it prints and what it purges, then the totals. */
function FilamentTable({ details }: { details: PlateDetails }) {
  const anyUsedFlag = details.filaments.some((filament) => filament.used)
  const filaments = anyUsedFlag
    ? details.filaments.filter((filament) => filament.used)
    : details.filaments
  const unused = details.filaments.length - filaments.length

  const totals = [
    details.filamentUsedG != null ? formatGrams(details.filamentUsedG) : null,
    details.filamentLengthMm != null ? metres(details.filamentLengthMm) : null,
    details.filamentVolumeCm3 != null ? `${mm(details.filamentVolumeCm3)} cm³` : null,
  ].filter((part): part is string => part != null)

  if (filaments.length === 0 && totals.length === 0) return <Nothing />

  return (
    <div className="space-y-2 text-sm">
      {filaments.length > 0 && (
        <table className="w-full tabular-nums">
          <thead className="text-left text-xs text-[var(--color-ink-faint)]">
            <tr>
              <th className="pb-1 font-normal">Slot</th>
              <th className="pb-1 text-right font-normal">Printed</th>
              <th className="pb-1 text-right font-normal">Length</th>
              <th className="pb-1 text-right font-normal">Purged</th>
            </tr>
          </thead>
          <tbody>
            {filaments.map((filament) => (
              <tr key={filament.tool}>
                <td className="py-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={filament.colorHex} title={filament.colorHex ?? undefined} />
                    {joined([`T${filament.tool}`, filament.material], ' ')}
                  </span>
                </td>
                <td className="py-0.5 text-right">
                  {filament.grams != null ? formatGrams(filament.grams) : '—'}
                </td>
                <td className="py-0.5 text-right">
                  {filament.lengthMm != null ? metres(filament.lengthMm) : '—'}
                </td>
                <td className="py-0.5 text-right">{purged(filament)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totals.length > 0 && (
        <p className="text-[var(--color-ink-muted)]">Total {totals.join(' · ')}</p>
      )}
      {details.purgeG != null && details.purgeG > 0 && (
        <p className="text-[var(--color-ink-muted)]">
          {formatGrams(details.purgeG)} purged
          {details.wastePercent != null ? ` (${details.wastePercent} % of the filament)` : ''}
        </p>
      )}
      {unused > 0 && (
        <p className="text-xs text-[var(--color-ink-faint)]">
          {unused} more {unused === 1 ? 'slot is' : 'slots are'} set up but not used.
        </p>
      )}
    </div>
  )
}

function purged(filament: PlateFilament): string {
  if (filament.purgeG == null) return '—'
  return filament.purgeG < 1 && filament.purgeG > 0 ? '< 1 g' : formatGrams(filament.purgeG)
}

/**
 * The print from start (top) to end (bottom): a numbered dot for every stop,
 * a thin tick in the new colour for every tool change, and the stops listed
 * beside it.
 */
function Timeline({ details }: { details: PlateDetails }) {
  const { timeline } = details
  if (!timeline.bodyRead) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Stops and tool changes are known once the whole file has been read.
      </p>
    )
  }
  if (timeline.stopCount === 0 && timeline.toolChangeCount === 0) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Runs from start to finish without stopping or changing tools.
      </p>
    )
  }

  const colourOf = new Map(details.filaments.map((filament) => [filament.tool, filament.colorHex]))
  const placedChanges = timeline.toolChanges.filter((change) => change.at != null)
  const placedStops = timeline.stops
    .map((stop, index) => ({ stop, number: index + 1 }))
    .filter(({ stop }) => stop.at != null)

  return (
    <div className="flex gap-5">
      <div className="flex shrink-0 flex-col items-center text-xs text-[var(--color-ink-faint)]">
        <span>Start</span>
        <div className="relative my-1 h-72 w-6">
          <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-surface-2)]" />
          {placedChanges.map((change, index) => (
            <span
              key={`change-${index}`}
              className="absolute left-1/2 h-px w-4 -translate-x-1/2"
              style={{
                top: `${change.at! * 100}%`,
                background: colourOf.get(change.to) ?? 'var(--color-ink-faint)',
              }}
              title={`T${change.from} → T${change.to}${
                change.layer != null ? ` · layer ${change.layer}` : ''
              }`}
            />
          ))}
          {placedStops.map(({ stop, number }) => (
            <span
              key={`stop-${number}`}
              className="absolute left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--color-surface)] text-[10px] font-semibold text-white"
              style={{
                top: `${stop.at! * 100}%`,
                background: stop.colorHex ?? 'var(--color-warning)',
              }}
              title={describeStop(stop)}
            >
              {number}
            </span>
          ))}
        </div>
        <span>{timeline.totalMin != null ? formatDuration(timeline.totalMin) : 'End'}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-3 text-sm">
        {timeline.stops.length > 0 && (
          <ol className="space-y-1.5">
            {timeline.stops.map((stop, index) => (
              <li key={index} className="flex gap-2">
                <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-[var(--color-ink-muted)]">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">
                    {stop.kind === 'filament_change' ? 'Filament change' : 'Pause'}
                  </span>{' '}
                  <span className="text-[var(--color-ink-muted)]">
                    {joined([
                      stop.elapsedMin != null ? `after ${formatDuration(stop.elapsedMin)}` : null,
                      stop.layer != null ? `layer ${stop.layer}` : null,
                      stop.zMm != null ? `${mm(stop.zMm)} mm` : null,
                    ])}
                  </span>
                  {stop.colorHex && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-ink-muted)]">
                      <Swatch color={stop.colorHex} /> load {stop.colorHex}
                    </span>
                  )}
                </span>
              </li>
            ))}
            {timeline.stopCount > timeline.stops.length && (
              <li className="text-[var(--color-ink-muted)]">
                and {timeline.stopCount - timeline.stops.length} more
              </li>
            )}
          </ol>
        )}
        {timeline.toolChangeCount > 0 && (
          <p className="text-[var(--color-ink-muted)]">
            {timeline.toolChangeCount} tool {timeline.toolChangeCount === 1 ? 'change' : 'changes'}
            {placedChanges.length > 0
              ? ', marked on the bar in the colour changed to.'
              : '; the file does not say when.'}
          </p>
        )}
      </div>
    </div>
  )
}

function describeStop(stop: TimelineStop): string {
  return joined([
    stop.kind === 'filament_change' ? 'Filament change' : 'Pause',
    stop.elapsedMin != null ? `after ${formatDuration(stop.elapsedMin)}` : null,
    stop.layer != null ? `layer ${stop.layer}` : null,
    stop.colorHex ? `load ${stop.colorHex}` : null,
  ]) as string
}

/**
 * Where the print sits on the bed, drawn to scale. Two rectangles from the
 * stored extents and bed outline, not a render of the toolpath.
 */
function BedDiagram({ details }: { details: PlateDetails }) {
  const { bed, extents } = details.geometry
  if (!bed || !extents) return null

  const width = bed.maxX - bed.minX
  const depth = bed.maxY - bed.minY
  if (width <= 0 || depth <= 0) return null

  // Printer Y grows towards the back; SVG y grows downwards, so flip it.
  const x = extents.minX - bed.minX
  const y = bed.maxY - extents.maxY
  const w = extents.maxX - extents.minX
  const h = extents.maxY - extents.minY
  const outside =
    extents.minX < bed.minX ||
    extents.minY < bed.minY ||
    extents.maxX > bed.maxX ||
    extents.maxY > bed.maxY

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${depth}`}
        className="w-full max-w-72 overflow-visible"
        role="img"
        aria-label={`Print area on a ${mm(width)} × ${mm(depth)} mm bed`}
      >
        <rect
          width={width}
          height={depth}
          rx={Math.min(width, depth) * 0.02}
          fill="var(--color-surface-2)"
          stroke="var(--color-border-strong)"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={x}
          y={y}
          width={Math.max(w, 1)}
          height={Math.max(h, 1)}
          fill="color-mix(in oklch, var(--color-accent) 35%, transparent)"
          stroke="var(--color-accent)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 text-xs text-[var(--color-ink-faint)]">
        {outside ? 'Reaches past the bed outline the slicer was given.' : 'Print area on the bed.'}
      </figcaption>
    </figure>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Label and value pairs; rows without a value are left out. */
function Facts({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter((row): row is [string, string] => row[1] != null && row[1] !== '')
  if (shown.length === 0) return <Nothing />
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--color-ink-muted)]">{label}</dt>
          <dd className="min-w-0 break-words tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Nothing() {
  return <p className="text-sm text-[var(--color-ink-faint)]">The file does not say.</p>
}

function minutes(value: number | null): string | null {
  return value != null ? formatDuration(value) : null
}

/** Heating, homing and calibration; under a minute is not worth a row. */
function overhead(value: number): string | null {
  return value >= 1 ? formatDuration(value) : null
}

function mm(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function metres(lengthMm: number): string {
  return `${(lengthMm / 1000).toFixed(2)} m`
}

function joined(parts: (string | null | undefined)[], separator = ' · '): string | null {
  const present = parts.filter((part): part is string => !!part)
  return present.length > 0 ? present.join(separator) : null
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
