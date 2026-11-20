/**
 * The rest of what a slicer writes into the two ends of a G-code file.
 *
 * gcode-metadata reads the settings a print profile records. This reads the
 * summary figures and machine details around them: how many layers, how much
 * filament by length and volume, the time in each mode, and what printer and
 * bed the file was sliced for. Same inputs — the head and tail of the file,
 * never the middle — and the same timidity: a value that does not parse is
 * left out rather than guessed at.
 *
 * Where the dialects write it:
 *
 *   PrusaSlicer   `; filament used [mm] = 1234.5`, `; bed_shape = 0x0,250x0,…`,
 *                 `; estimated printing time (silent mode) = 1h 2m`, at the end
 *   Orca / Bambu  `; total layer number: 66`, `; max_z_height: 13.20` and
 *                 `; model printing time: 22m; total estimated time: 28m` in a
 *                 header block, the config at the end
 *   Cura          `;LAYER_COUNT:66`, `;MINX:12.3`, `;Filament used: 1.2m` and
 *                 `;FLAVOR:Marlin` in the header
 */

import { collectGcodeConfig, parseDuration } from './gcode-metadata'

/** An axis-aligned box in printer coordinates, millimetres. */
export interface GcodeExtents {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/** The printable rectangle of a bed, from its outline. Millimetres. */
export interface GcodeBed {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface GcodeDetails {
  layerCount?: number
  /** Height of the top layer. */
  maxZMm?: number
  /** All tools together. */
  filamentLengthMm?: number
  /** One per tool, when the slicer wrote a list. */
  filamentLengthsMm?: number[]
  filamentVolumeCm3?: number
  /** One per tool. */
  filamentDiametersMm?: number[]
  /** g/cm³, one per tool. */
  filamentDensities?: number[]
  /** Prusa's stealth-mode estimate. */
  silentDurationMin?: number
  /** Orca and Bambu: the printing alone, without heating and calibration. */
  modelDurationMin?: number
  /** Orca and Bambu: everything, heating and calibration included. */
  totalDurationMin?: number
  firstLayerDurationMin?: number
  /** The printer the profile is for, e.g. "MK4S" — what to compare printers against. */
  printerModel?: string
  /** The printer preset's own name, e.g. "Original Prusa MK4S 0.4 nozzle". */
  printerPreset?: string
  bed?: GcodeBed
  printableHeightMm?: number
  /** Lowercased: "marlin2", "klipper", "reprapfirmware", … */
  gcodeFlavor?: string
  /** Cura's own bounding box of the print. */
  extents?: GcodeExtents
  /** Prusa: grams that go into the wipe tower. */
  wipeTowerG?: number
}

export function parseGcodeDetails(head: string, tail: string): GcodeDetails {
  // Binary G-code; see gcode-metadata.
  if (head.startsWith('GCDE')) return {}

  const config = collectGcodeConfig(head, tail)
  const out: GcodeDetails = {}

  // --- layers ---------------------------------------------------------------
  const layers = integer(config.get('total layer number') ?? config.get('layer_count'))
  if (layers != null && layers > 0 && layers < 100_000) out.layerCount = layers

  const maxZ = number(config.get('max_z_height') ?? config.get('max_layer_z') ?? config.get('maxz'))
  if (maxZ != null && maxZ > 0 && maxZ < 10_000) out.maxZMm = maxZ

  // --- filament amounts -------------------------------------------------------
  const lengths = numbers(config.get('filament used [mm]'))
  const curaMetres = numbers(config.get('filament used'))
  const perTool = lengths ?? curaMetres?.map((metres) => metres * 1000)
  if (perTool && perTool.length > 0) {
    out.filamentLengthMm = round(sum(perTool), 2)
    if (perTool.length > 1) out.filamentLengthsMm = perTool.map((mm) => round(mm, 2))
  } else {
    const total = number(config.get('total filament length [mm]'))
    if (total != null && total >= 0) out.filamentLengthMm = total
  }

  const volumes = numbers(config.get('filament used [cm3]'))
  const volume = volumes ? sum(volumes) : number(config.get('total filament volume [cm^3]'))
  if (volume != null && volume >= 0) out.filamentVolumeCm3 = round(volume, 3)

  const diameters = numbers(config.get('filament_diameter'))
  if (diameters?.every((value) => value > 0 && value < 10)) out.filamentDiametersMm = diameters

  const densities = numbers(config.get('filament_density'))
  if (densities?.every((value) => value > 0 && value < 25)) out.filamentDensities = densities

  const wipeTower = number(config.get('total filament used for wipe tower [g]'))
  if (wipeTower != null && wipeTower >= 0) out.wipeTowerG = wipeTower

  // --- time -------------------------------------------------------------------
  const silent = duration(config.get('estimated printing time (silent mode)'))
  if (silent != null) out.silentDurationMin = silent

  const model = duration(config.get('model printing time'))
  if (model != null) out.modelDurationMin = model

  /*
   * Orca writes "; model printing time: 22m 25s; total estimated time: 28m 23s"
   * on one line, which the config reader files entirely under the first key.
   */
  const total =
    duration(config.get('total estimated time')) ??
    duration(/total estimated time\s*[:=]\s*([^;\r\n]+)/i.exec(head)?.[1])
  if (total != null) out.totalDurationMin = total

  const firstLayer = duration(
    config.get('estimated first layer printing time (normal mode)') ??
      config.get('estimated first layer printing time'),
  )
  if (firstLayer != null) out.firstLayerDurationMin = firstLayer

  // --- machine ----------------------------------------------------------------
  const printerModel = config.get('printer_model')
  if (printerModel && !isPlaceholder(printerModel)) out.printerModel = printerModel

  const preset = config.get('printer_settings_id') ?? config.get('target_machine.name')
  if (preset && !isPlaceholder(preset)) out.printerPreset = preset

  const bed = parseBed(config.get('bed_shape') ?? config.get('printable_area'))
  if (bed) out.bed = bed

  const height = number(config.get('max_print_height') ?? config.get('printable_height'))
  if (height != null && height > 0 && height < 10_000) out.printableHeightMm = height

  const flavor = config.get('gcode_flavor') ?? config.get('flavor')
  if (flavor && !isPlaceholder(flavor)) out.gcodeFlavor = flavor.trim().toLowerCase()

  const extents = readCuraExtents(config)
  if (extents) out.extents = extents

  return out
}

/** "0x0,250x0,250x210,0x210" — the bed outline as points — to its bounding rectangle. */
function parseBed(value: string | undefined): GcodeBed | undefined {
  if (!value) return undefined
  const points = value.split(',').map((point) => {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(point)
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null
  })
  if (points.length < 3 || points.some((point) => point == null)) return undefined
  const xs = points.map((point) => point!.x)
  const ys = points.map((point) => point!.y)
  const bed = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
  // A bed with no area is a misread, not a bed.
  return bed.maxX > bed.minX && bed.maxY > bed.minY ? bed : undefined
}

function readCuraExtents(config: Map<string, string>): GcodeExtents | undefined {
  const keys = ['minx', 'miny', 'minz', 'maxx', 'maxy', 'maxz'] as const
  const values = keys.map((key) => number(config.get(key)))
  if (values.some((value) => value == null)) return undefined
  const [minX, minY, minZ, maxX, maxY, maxZ] = values as number[]
  if (maxX! < minX! || maxY! < minY! || maxZ! < minZ!) return undefined
  return { minX: minX!, minY: minY!, minZ: minZ!, maxX: maxX!, maxY: maxY!, maxZ: maxZ! }
}

function duration(text: string | undefined): number | null {
  return text ? parseDuration(text) : null
}

function number(value: string | undefined): number | null {
  if (value == null) return null
  const match = /^-?\d+(?:\.\d+)?/.exec(value.trim())
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function integer(value: string | undefined): number | null {
  const parsed = number(value)
  return parsed == null ? null : Math.round(parsed)
}

/** "1.2, 3.4" or "1.2;3.4" or "1.2m, 0.5m". Null unless every entry reads. */
function numbers(value: string | undefined): number[] | null {
  if (value == null) return null
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const parsed = parts.map((part) => number(part))
  if (parsed.some((entry) => entry == null || entry < 0)) return null
  return parsed as number[]
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function isPlaceholder(value: string): boolean {
  const text = value.trim().toLowerCase()
  return text === '' || text === 'undefine' || text === 'undefined' || text === 'unknown'
}
