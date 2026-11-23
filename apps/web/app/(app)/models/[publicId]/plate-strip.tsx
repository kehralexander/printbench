'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { Hand, PanelRightOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SectionHeader } from '@/components/ui/section-header'
import { Swatch } from '@/components/ui/swatch'
import { formatDuration, formatGrams } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FileDownloadLink } from './file-download-link'
import { OpenInSlicer } from './open-in-slicer'
import { PlatePanel } from './plate-panel'
import { QueueButton } from './queue-button'
import { SendToPrinter } from './send-to-printer'
import type { PlateStop, SlicerSummary } from './slicer-summaries'

export type Plate = {
  id: string
  filename: string
  thumbUrl: string | null
  canOpenInSlicer: boolean
  canSendToPrinter: boolean
  /** Null until the background read has reached the file, or when it failed. */
  slicer: SlicerSummary | null
  readFailed: boolean
  /** Logged prints of this file. */
  printed: number
}

type QueueProps = Omit<ComponentProps<typeof QueueButton>, 'fileId' | 'label'>

/** "BottleBody_PLA_0.16_1h13m36s.gcode" reads better without the extension. */
function plateName(plate: Plate): string {
  const base = plate.filename.split('/').pop() ?? plate.filename
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * A model's sliced files as prints, ready to go: a strip of plates to pick
 * from, and the picked one's figures and actions beneath it. The slicer's
 * full read of a plate opens in a side panel from there.
 */
export function PlateStrip({
  publicId,
  plates,
  queue,
}: {
  publicId: string
  plates: Plate[]
  /** Present when this viewer may queue prints. */
  queue: QueueProps | null
}) {
  const [selectedId, setSelectedId] = useState(plates[0]?.id ?? null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const plate = plates.find((p) => p.id === selectedId) ?? plates[0]
  if (!plate) return null

  const known = plates.filter((p) => p.slicer?.durationMin != null)
  const totalMin = known.reduce((sum, p) => sum + (p.slicer?.durationMin ?? 0), 0)
  const totalG = plates.reduce((sum, p) => sum + (p.slicer?.filamentUsedG ?? 0), 0)
  const meta = [
    `${plates.length} ${plates.length === 1 ? 'plate' : 'plates'}`,
    known.length > 0 ? formatDuration(totalMin) : null,
    totalG > 0 ? formatGrams(totalG) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section>
      <SectionHeader title="Ready to print" meta={meta} />
      <Card className="overflow-hidden">
        {plates.length > 1 && (
          <div
            role="listbox"
            aria-label="Plates"
            className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
          >
            {plates.map((p, index) => {
              const active = p.id === plate.id
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedId(p.id)}
                  title={p.filename}
                  className={cn(
                    'overflow-hidden rounded-[var(--radius-control)] bg-[var(--color-surface)] text-left ring-1 ring-[var(--color-border)] transition',
                    active ? 'ring-2 ring-[var(--color-accent)]' : 'opacity-75 hover:opacity-100',
                  )}
                >
                  <span className="relative block aspect-[4/3] bg-[var(--color-surface-2)]">
                    {p.thumbUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-contain"
                      />
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 text-[11px] font-medium text-white">
                      {index + 1}
                    </span>
                    {p.printed > 0 && (
                      <span
                        title={`Printed ${p.printed}×`}
                        className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-[var(--color-success)] ring-2 ring-white"
                      />
                    )}
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs font-medium">
                    {plateName(p)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex gap-4 p-4">
          {plates.length === 1 && plate.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={plate.thumbUrl}
              alt=""
              className="size-24 shrink-0 rounded bg-[var(--color-surface-2)] object-contain"
            />
          )}
          {/* Name and actions on one line, the figures beneath at full width:
              beside the buttons they had too little room and wrapped. */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="min-w-0 break-words text-base font-semibold" title={plate.filename}>
                  {plateName(plate)}
                </h3>
                {plate.printed > 0 && <Badge tone="success">Printed {plate.printed}×</Badge>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {plate.canSendToPrinter && (
                  <SendToPrinter fileId={plate.id} filename={plate.filename} primary />
                )}
                {queue && <QueueButton key={plate.id} {...queue} fileId={plate.id} label="Queue" />}
                {plate.canOpenInSlicer && (
                  <OpenInSlicer fileId={plate.id} filename={plate.filename} iconOnly />
                )}
                <FileDownloadLink fileId={plate.id} filename={plate.filename} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  title="Everything the slicer says about this plate"
                  aria-label={`Details of ${plateName(plate)}`}
                  onClick={() => setPanelId(plate.id)}
                >
                  <PanelRightOpen />
                </Button>
              </div>
            </div>
            {plate.slicer ? (
              <PlateFigures summary={plate.slicer} />
            ) : (
              <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
                {plate.readFailed ? 'This file could not be read.' : 'Not read yet.'}
              </p>
            )}
          </div>
        </div>
      </Card>
      <PlatePanel
        publicId={publicId}
        plate={plates.find((p) => p.id === panelId) ?? null}
        onClose={() => setPanelId(null)}
      />
    </section>
  )
}

/** The figures people choose a plate by, as a row of small labelled values. */
function PlateFigures({ summary }: { summary: SlicerSummary }) {
  const machine = [
    summary.printerName,
    summary.nozzleMm != null ? `${summary.nozzleMm} mm nozzle` : null,
  ].filter(Boolean)
  const layers = [
    summary.layerCount != null ? `${summary.layerCount} layers` : null,
    summary.layerHeightMm != null ? `${summary.layerHeightMm} mm` : null,
  ].filter(Boolean)

  return (
    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
      {summary.durationMin != null && (
        <Figure label="Time">{formatDuration(summary.durationMin)}</Figure>
      )}
      <FilamentFigure summary={summary} />
      {(summary.maxZMm != null || layers.length > 0) && (
        <Figure label="Height" sub={layers.length > 0 ? layers.join(' × ') : undefined}>
          {summary.maxZMm != null ? `${Math.round(summary.maxZMm * 10) / 10} mm` : '—'}
        </Figure>
      )}
      {machine.length > 0 && (
        <Figure
          label="Printer"
          sub={
            summary.objectCount != null && summary.objectCount > 1
              ? `${summary.objectCount} objects`
              : undefined
          }
        >
          <span className="block max-w-56 truncate" title={machine.join(' · ')}>
            {machine.join(' · ')}
          </span>
        </Figure>
      )}
      {summary.stopCount != null && summary.stopCount > 0 && <StopsFigure summary={summary} />}
    </dl>
  )
}

function Figure({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{children}</dd>
      {sub && <dd className="text-xs text-[var(--color-ink-muted)]">{sub}</dd>}
    </div>
  )
}

/** Each slot it prints with, then the total and what goes into purging. */
function FilamentFigure({ summary }: { summary: SlicerSummary }) {
  const listed = summary.filaments ?? []
  const used = listed.filter((filament) => filament.used)
  // Without a figure per tool the header cannot say which are used; show them all.
  const filaments = used.length > 0 ? used : listed
  const multi = filaments.length > 1

  const slots: ReactNode[] = filaments.map((filament) => (
    <span key={filament.tool} className="inline-flex items-center gap-1 whitespace-nowrap">
      <Swatch color={filament.colorHex} title={filament.colorHex ?? undefined} />
      {[multi ? `T${filament.tool}` : null, filament.material].filter(Boolean).join(' ') ||
        `T${filament.tool}`}
    </span>
  ))
  if (slots.length === 0 && (summary.material || summary.colorHex)) {
    slots.push(
      <span key="material" className="inline-flex items-center gap-1 whitespace-nowrap">
        <Swatch color={summary.colorHex} title={summary.colorHex ?? undefined} />
        {summary.material}
      </span>,
    )
  }

  const notes = [
    summary.purgeG != null && summary.purgeG > 0 ? `${formatGrams(summary.purgeG)} purge` : null,
    summary.toolChanges
      ? `${summary.toolChanges} swap${summary.toolChanges === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)

  if (slots.length === 0 && summary.filamentUsedG == null) return null

  return (
    <Figure label="Filament" sub={notes.length > 0 ? notes.join(' · ') : undefined}>
      <span className="flex flex-wrap items-center gap-x-3">
        {summary.filamentUsedG != null && <span>{formatGrams(summary.filamentUsedG)}</span>}
        {slots.length > 0 && (
          <span className="flex flex-wrap gap-x-2 font-normal text-[var(--color-ink-muted)]">
            {slots}
          </span>
        )}
      </span>
    </Figure>
  )
}

/** A print that needs someone at the printer partway through says so. */
function StopsFigure({ summary }: { summary: SlicerSummary }) {
  const listed = summary.stops.map(describeStop)
  const rest = (summary.stopCount ?? 0) - summary.stops.length
  if (rest > 0) listed.push(`and ${rest} more`)
  const first = summary.stops[0]

  return (
    <div title={listed.join('\n')}>
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">Stops</dt>
      <dd className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-warning)]">
        <Hand className="size-3.5" />
        {summary.stopCount}
      </dd>
      {first?.elapsedMin != null && (
        <dd className="text-xs text-[var(--color-ink-muted)]">
          first at {formatDuration(first.elapsedMin)}
        </dd>
      )}
    </div>
  )
}

function describeStop(stop: PlateStop): string {
  const what = stop.kind === 'filament_change' ? 'Filament change' : 'Pause'
  const when = [
    stop.elapsedMin != null ? `at ${formatDuration(stop.elapsedMin)}` : null,
    stop.layer != null ? `layer ${stop.layer}` : null,
    stop.colorHex,
  ].filter(Boolean)
  return when.length > 0 ? `${what} ${when.join(' · ')}` : what
}
