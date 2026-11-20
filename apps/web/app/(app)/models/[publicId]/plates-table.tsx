'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight, Hand, Layers } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SectionHeader } from '@/components/ui/section-header'
import { Swatch } from '@/components/ui/swatch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { formatDuration, formatGrams } from '@/lib/format'
import { PlatePanel } from './plate-panel'
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
}

/**
 * A model's sliced G-code files side by side: one row per plate, with the
 * figures people choose between plates by in columns of their own.
 *
 * The files also stay in the file tree below, as files; this is the view of
 * them as prints. A row opens everything else the file says in a side panel.
 */
export function PlatesTable({
  publicId,
  title,
  plates,
}: {
  publicId: string
  title: ReactNode
  plates: Plate[]
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <section>
      <SectionHeader icon={<Layers />} title={title} />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Plate</TH>
              <TH>Time</TH>
              <TH>Filament</TH>
              <TH>Layers</TH>
              <TH>Stops</TH>
              <TH className="w-8">
                <span className="sr-only">Details</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {plates.map((plate) => (
              <PlateRow key={plate.id} plate={plate} onOpen={() => setOpenId(plate.id)} />
            ))}
          </TBody>
        </Table>
      </Card>
      <PlatePanel
        publicId={publicId}
        plate={plates.find((plate) => plate.id === openId) ?? null}
        onClose={() => setOpenId(null)}
      />
    </section>
  )
}

function PlateRow({ plate, onOpen }: { plate: Plate; onOpen: () => void }) {
  const summary = plate.slicer
  const name = plate.filename.split('/').pop() ?? plate.filename
  const machine = summary
    ? [
        summary.printerName,
        summary.nozzleMm != null ? `${summary.nozzleMm} mm nozzle` : null,
        summary.objectCount != null && summary.objectCount > 1
          ? `${summary.objectCount} objects`
          : null,
      ].filter(Boolean)
    : []

  return (
    <TR className="cursor-pointer hover:bg-[var(--color-surface-2)]" onClick={onOpen}>
      <TD>
        <div className="flex min-w-44 items-center gap-3">
          {plate.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={plate.thumbUrl}
              alt=""
              loading="lazy"
              className="size-14 shrink-0 rounded bg-[var(--color-surface-2)] object-contain"
            />
          ) : (
            <span className="size-14 shrink-0 rounded bg-[var(--color-surface-2)]" />
          )}
          <div className="min-w-0">
            {/* The row is clickable too; this is the way in from the keyboard. */}
            <button
              type="button"
              className="block max-w-56 truncate text-left hover:underline"
              title={plate.filename}
              onClick={(event) => {
                event.stopPropagation()
                onOpen()
              }}
            >
              {name}
            </button>
            {machine.length > 0 && (
              <div
                className="max-w-56 truncate text-xs text-[var(--color-ink-muted)]"
                title={machine.join(' · ')}
              >
                {machine.join(' · ')}
              </div>
            )}
            {!summary && (
              <div className="text-xs text-[var(--color-ink-faint)]">
                {plate.readFailed ? 'Could not be read' : 'Not read yet'}
              </div>
            )}
          </div>
        </div>
      </TD>

      <TD className="whitespace-nowrap">
        {summary?.durationMin != null ? formatDuration(summary.durationMin) : <Missing />}
      </TD>

      <TD>{summary ? <FilamentCell summary={summary} /> : <Missing />}</TD>

      <TD className="whitespace-nowrap">
        {summary ? <LayersCell summary={summary} /> : <Missing />}
      </TD>

      <TD className="whitespace-nowrap">
        {summary ? <StopsCell summary={summary} /> : <Missing />}
      </TD>

      {/* Sending, opening and downloading live in the panel, beside the stop warning. */}
      <TD className="pl-0 text-[var(--color-ink-faint)]">
        <ChevronRight className="size-4" />
      </TD>
    </TR>
  )
}

/** Each slot it prints with, then the total and what goes into purging. */
function FilamentCell({ summary }: { summary: SlicerSummary }) {
  const listed = summary.filaments ?? []
  const used = listed.filter((filament) => filament.used)
  // Without a figure per tool the header cannot say which are used; show them all.
  const filaments = used.length > 0 ? used : listed
  const multi = filaments.length > 1

  const slots: ReactNode[] = filaments.map((filament) => (
    <span key={filament.tool} className="inline-flex items-center gap-1 whitespace-nowrap">
      <Swatch color={filament.colorHex} title={filament.colorHex ?? undefined} />
      {[
        multi ? `T${filament.tool}` : null,
        filament.material,
        multi && filament.grams != null ? formatGrams(filament.grams) : null,
      ]
        .filter(Boolean)
        .join(' ') || `T${filament.tool}`}
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
    summary.filamentUsedG != null
      ? multi
        ? `${formatGrams(summary.filamentUsedG)} total`
        : formatGrams(summary.filamentUsedG)
      : null,
    summary.purgeG != null && summary.purgeG > 0 ? `${formatGrams(summary.purgeG)} purge` : null,
    summary.toolChanges ? plural(summary.toolChanges, 'swap') : null,
  ].filter(Boolean)

  if (slots.length === 0 && notes.length === 0) return <Missing />

  return (
    <div className="space-y-0.5">
      {slots.length > 0 && <div className="flex min-w-40 flex-wrap gap-x-3 gap-y-0.5">{slots}</div>}
      {notes.length > 0 && (
        <div className="whitespace-nowrap text-xs text-[var(--color-ink-muted)]">
          {notes.join(' · ')}
        </div>
      )}
    </div>
  )
}

function LayersCell({ summary }: { summary: SlicerSummary }) {
  const main = [
    summary.layerCount != null ? String(summary.layerCount) : null,
    summary.layerHeightMm != null ? `${summary.layerHeightMm} mm` : null,
  ].filter(Boolean)
  if (main.length === 0 && summary.maxZMm == null) return <Missing />

  return (
    <div className="space-y-0.5">
      {main.length > 0 && <div>{main.join(' × ')}</div>}
      {summary.maxZMm != null && (
        <div className="text-xs text-[var(--color-ink-muted)]">
          {Math.round(summary.maxZMm * 10) / 10} mm tall
        </div>
      )}
    </div>
  )
}

/**
 * Whether the print needs someone at the printer partway through. Unknown
 * until the whole file has been read; none is said plainly.
 */
function StopsCell({ summary }: { summary: SlicerSummary }) {
  if (summary.stopCount == null) return <Missing />
  if (summary.stopCount === 0) {
    return <span className="text-[var(--color-ink-faint)]">None</span>
  }

  const listed = summary.stops.map(describeStop)
  const rest = summary.stopCount - summary.stops.length
  if (rest > 0) listed.push(`and ${rest} more`)
  const first = summary.stops[0]

  return (
    <div className="space-y-0.5" title={listed.join('\n')}>
      <div className="inline-flex items-center gap-1 font-medium text-[var(--color-warning)]">
        <Hand className="size-3.5" />
        {summary.stopCount}
      </div>
      {first?.elapsedMin != null && (
        <div className="text-xs text-[var(--color-ink-muted)]">
          first at {formatDuration(first.elapsedMin)}
        </div>
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function Missing() {
  return <span className="text-[var(--color-ink-faint)]">—</span>
}
