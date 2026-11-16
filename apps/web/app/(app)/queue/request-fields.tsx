'use client'

import { useId, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import {
  MAX_FILAMENTS,
  formatEstimate,
  mergeFilaments,
  parseEstimate,
  type RequestFilament,
  type RequestFilamentInput,
} from '@pb/core/requests'
import type { GcodeTool } from '@pb/core'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { FilamentOption } from '@/lib/filament-options'

/**
 * Form pieces shared by every place a request is written: the bulk box, the
 * model page's "Queue" and the edit dialog on a queue row.
 */

export interface MaterialValue {
  material: string
  colorName: string
  /** Lowercase "#rrggbb", or empty for "any colour". */
  colorHex: string
  /** The Spoolman spool picked, when the choice was one. */
  spoolmanSpoolId: number | null
  /** PrintBench's own spool picked, when the choice was one. */
  spoolId: string | null
}

export const NO_MATERIAL: MaterialValue = {
  material: '',
  colorName: '',
  colorHex: '',
  spoolmanSpoolId: null,
  spoolId: null,
}

/**
 * One filament row in a form: what to print it in, plus what the G-code said
 * about it — its tool and grams — carried through untouched.
 */
export interface FilamentValue extends MaterialValue {
  /** Stable across edits, for React and for remounting a row's picker. */
  key: string
  tool: number | null
  grams: number | null
}

let nextKey = 0
const newKey = () => `filament-${++nextKey}`

export function filamentValue(row: Partial<RequestFilament> = {}): FilamentValue {
  return {
    key: newKey(),
    tool: row.tool ?? null,
    grams: row.grams ?? null,
    material: row.material ?? '',
    colorName: row.colorName ?? '',
    colorHex: row.colorHex ?? '',
    spoolmanSpoolId: row.spoolmanSpoolId ?? null,
    spoolId: row.spoolId ?? null,
  }
}

/** The rows for a request as stored; one blank row when it names nothing. */
export function filamentsFrom(rows: readonly RequestFilament[]): FilamentValue[] {
  return rows.length > 0 ? rows.map(filamentValue) : [filamentValue()]
}

/** The shape the server actions take: blanks become nulls. */
export function filamentsInput(rows: readonly FilamentValue[]): RequestFilamentInput[] {
  return rows.map((row) => ({
    tool: row.tool,
    grams: row.grams,
    material: row.material.trim() || null,
    colorName: row.colorName.trim() || null,
    colorHex: row.colorHex || null,
    spoolmanSpoolId: row.spoolmanSpoolId,
    spoolId: row.spoolId,
  }))
}

/**
 * The rows once a file is chosen, by the same rules the server applies on
 * saving: one per tool the file uses, keeping what was asked for. Null tools
 * — a mesh, or no file — turn the rows back into wishes.
 */
export function withFileTools(
  rows: readonly FilamentValue[],
  tools: readonly GcodeTool[] | null,
): FilamentValue[] {
  const current: RequestFilament[] = filamentsInput(rows).map((row) => ({
    tool: row.tool ?? null,
    material: row.material ?? null,
    colorHex: row.colorHex ?? null,
    colorName: row.colorName ?? null,
    spoolmanSpoolId: row.spoolmanSpoolId ?? null,
    spoolId: row.spoolId ?? null,
    grams: row.grams ?? null,
  }))
  // Blank rows say nothing to carry over; keep at least the one picker.
  const named = current.filter(
    (row) => row.material || row.colorHex || row.colorName || row.spoolmanSpoolId || row.spoolId,
  )
  return filamentsFrom(mergeFilaments(named, tools ?? []))
}

const CUSTOM = '__custom'

function matchOption(value: MaterialValue, options: FilamentOption[]): string {
  if (
    !value.material &&
    !value.colorName &&
    !value.colorHex &&
    !value.spoolmanSpoolId &&
    !value.spoolId
  ) {
    return ''
  }
  if (value.spoolmanSpoolId != null) {
    const spool = options.find((option) => option.spoolmanSpoolId === value.spoolmanSpoolId)
    if (spool) return spool.id
  }
  if (value.spoolId != null) {
    const spool = options.find((option) => option.spoolId === value.spoolId)
    if (spool) return spool.id
  }
  const match = options.find(
    (option) =>
      option.spoolId == null &&
      option.material.toLowerCase() === value.material.trim().toLowerCase() &&
      (option.colorName ?? '').toLowerCase() === value.colorName.trim().toLowerCase() &&
      (option.colorHex ?? '') === value.colorHex,
  )
  return match?.id ?? CUSTOM
}

/**
 * Material and colour: one of the filaments on hand, or anything typed in.
 *
 * The inventory comes first because "in the red PLA" usually means a spool
 * that exists. "Other…" covers the rest — a colour you would have to buy, or a
 * request written before the inventory was.
 */
export function MaterialPicker<T extends MaterialValue>({
  value,
  onChange,
  options,
  label = 'Material and colour',
}: {
  value: T
  onChange: (value: T) => void
  options: FilamentOption[]
  label?: ReactNode
}) {
  const id = useId()
  const [mode, setMode] = useState(() => matchOption(value, options))
  const materials = [...new Set(options.map((option) => option.material))]

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-filament`} className="block text-sm font-medium">
        {label}
      </label>
      <Select
        id={`${id}-filament`}
        value={mode}
        onChange={(event) => {
          const next = event.target.value
          setMode(next)
          if (next === '') onChange({ ...value, ...NO_MATERIAL })
          const option = options.find((candidate) => candidate.id === next)
          if (option) {
            onChange({
              ...value,
              material: option.material,
              colorName: option.colorName ?? '',
              colorHex: option.colorHex ?? '',
              spoolmanSpoolId: option.spoolmanSpoolId ?? null,
              spoolId: option.spoolId ?? null,
            })
          }
        }}
      >
        <option value="">Any — no preference</option>
        {[...new Set(options.map((option) => option.group))].map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((option) => option.group === group)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>Other…</option>
      </Select>

      {mode === CUSTOM && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input
            aria-label="Material"
            list={`${id}-materials`}
            placeholder="Material, e.g. PETG"
            value={value.material}
            onChange={(event) =>
              onChange({
                ...value,
                material: event.target.value,
                spoolmanSpoolId: null,
                spoolId: null,
              })
            }
          />
          <datalist id={`${id}-materials`}>
            {materials.map((material) => (
              <option key={material} value={material} />
            ))}
          </datalist>
          <Input
            aria-label="Colour name"
            placeholder="Colour, e.g. Galaxy Black"
            value={value.colorName}
            onChange={(event) =>
              onChange({
                ...value,
                colorName: event.target.value,
                spoolmanSpoolId: null,
                spoolId: null,
              })
            }
          />
          <span className="flex items-center gap-1">
            <input
              type="color"
              aria-label="Colour"
              value={value.colorHex || '#808080'}
              onChange={(event) =>
                onChange({
                  ...value,
                  colorHex: event.target.value.toLowerCase(),
                  spoolmanSpoolId: null,
                  spoolId: null,
                })
              }
              className={
                value.colorHex
                  ? 'size-9 cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-border)] bg-transparent'
                  : 'size-9 cursor-pointer rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] bg-transparent opacity-50'
              }
            />
            {value.colorHex && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="No specific colour"
                title="No specific colour"
                onClick={() =>
                  onChange({ ...value, colorHex: '', spoolmanSpoolId: null, spoolId: null })
                }
              >
                <X />
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Every filament a request prints in.
 *
 * A single-filament request looks as it always did: one picker. More rows
 * appear for a multi-colour file — one per tool, labelled with the tool and
 * its grams, and not removable, since the file decides how many there are —
 * or when someone asks for another colour before there is a file.
 */
export function FilamentRows({
  rows,
  onChange,
  options,
}: {
  rows: FilamentValue[]
  onChange: (rows: FilamentValue[]) => void
  options: FilamentOption[]
}) {
  const fromFile = rows.some((row) => row.tool != null)
  const single = rows.length <= 1
  const update = (key: string, next: FilamentValue) =>
    onChange(rows.map((row) => (row.key === key ? next : row)))

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.key} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <MaterialPicker
              value={row}
              onChange={(next) => update(row.key, next)}
              options={options}
              label={
                single && row.tool == null ? undefined : (
                  <>
                    {row.tool != null ? `Tool T${row.tool}` : `Colour ${index + 1}`}
                    {row.grams != null && (
                      <span className="font-normal text-[var(--color-ink-faint)]">
                        {' '}
                        · {Math.round(row.grams * 10) / 10} g a print
                      </span>
                    )}
                  </>
                )
              }
            />
          </div>
          {!fromFile && rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6"
              aria-label={`Remove colour ${index + 1}`}
              onClick={() => onChange(rows.filter((candidate) => candidate.key !== row.key))}
            >
              <X />
            </Button>
          )}
        </div>
      ))}
      {!fromFile && rows.length < MAX_FILAMENTS && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([...(rows.length > 0 ? rows : [filamentValue()]), filamentValue()])
          }
        >
          <Plus />
          Add another colour
        </Button>
      )}
    </div>
  )
}

/**
 * Print time for ONE print, typed the way slicers show it ("2h 10m", "2:10").
 *
 * `hint` says where a pre-filled value came from, so a suggestion is never
 * mistaken for a measurement.
 */
export function EstimateInput({
  id,
  value,
  onChange,
  hint,
  quantity,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  hint?: string | null
  quantity: number
}) {
  const parsed = parseEstimate(value)
  const invalid = value.trim().length > 0 && parsed == null

  return (
    <Field
      label={
        <>
          Print time <span className="font-normal text-[var(--color-ink-faint)]">(one print)</span>
        </>
      }
      htmlFor={id}
      hint={
        invalid
          ? undefined
          : parsed != null && quantity > 1
            ? `${formatEstimate(parsed * quantity)} for all ${quantity}`
            : (hint ?? 'Optional')
      }
      error={invalid ? 'Try "2h 10m", "2:10" or a number of minutes.' : undefined}
    >
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. 2h 10m"
      />
    </Field>
  )
}

/** The text field's value for a stored estimate. */
export function estimateText(minutes: number | null | undefined): string {
  return minutes != null ? formatEstimate(minutes) : ''
}

/** What to send: null for blank, undefined when the text does not parse (caller refuses). */
export function estimateValue(text: string): number | null | undefined {
  if (text.trim().length === 0) return null
  return parseEstimate(text) ?? undefined
}

export function suggestionHint(source: 'gcode' | 'history'): string {
  return source === 'gcode' ? "From the slicer's estimate in the G-code" : 'From earlier prints'
}
