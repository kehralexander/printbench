import type { GcodePauseKind, SlicerFileMeta } from '@pb/core'

/** A point where the print stops and waits for someone. */
export interface PlateStop {
  kind: GcodePauseKind
  elapsedMin: number | null
  layer: number | null
  colorHex: string | null
}

/** How many stops a row names in its tooltip; the rest are counted. */
const STOPS_LISTED = 5

/**
 * What a sliced file's row in the plates table shows: how long it takes, what
 * it prints with, how it is built and whether it needs someone at the printer.
 *
 * Picked from the stored read (model_files.slicer_meta) rather than passed
 * whole: the full read carries tool-change timelines and object lists that
 * the row has no use for, and everything passed here is sent to the browser.
 */
export type SlicerSummary = Pick<
  SlicerFileMeta,
  | 'durationMin'
  | 'filamentUsedG'
  | 'layerHeightMm'
  | 'layerCount'
  | 'maxZMm'
  | 'nozzleMm'
  | 'material'
  | 'colorHex'
  | 'printerName'
  | 'filaments'
  | 'purgeG'
> & {
  objectCount: number | null
  /** Null when the body was not read, so the count is unknown rather than zero. */
  toolChanges: number | null
  stopCount: number | null
  stops: PlateStop[]
}

export function slicerSummary(meta: SlicerFileMeta | null): SlicerSummary | null {
  if (!meta) return null
  const body = meta.body
  return {
    durationMin: meta.durationMin,
    filamentUsedG: meta.filamentUsedG,
    layerHeightMm: meta.layerHeightMm,
    layerCount: meta.layerCount,
    maxZMm: meta.maxZMm,
    nozzleMm: meta.nozzleMm,
    material: meta.material,
    colorHex: meta.colorHex,
    printerName: meta.printerName,
    filaments: meta.filaments,
    purgeG: meta.purgeG,
    objectCount: body?.objectCount ?? null,
    toolChanges: body ? body.toolChanges : null,
    stopCount: body ? body.pauses.length : null,
    stops: (body?.pauses ?? []).slice(0, STOPS_LISTED).map((pause) => ({
      kind: pause.kind,
      elapsedMin: pause.elapsedMin,
      layer: pause.layer,
      colorHex: pause.colorHex,
    })),
  }
}

/** How many object names the panel lists; the rest are counted. */
const OBJECTS_LISTED = 50

/** Where on the print's timeline something happens, from 0 (start) to 1 (end). */
type TimelinePosition = { at: number | null }

export type TimelineStop = PlateStop &
  TimelinePosition & { zMm: number | null; command: string; tool: number | null }

export type TimelineToolChange = TimelinePosition & {
  from: number
  to: number
  layer: number | null
  elapsedMin: number | null
}

export interface PlateFilament {
  tool: number
  material: string | null
  colorHex: string | null
  grams: number | null
  lengthMm: number | null
  purgeG: number | null
  used: boolean
}

/**
 * Everything the plate panel shows about one sliced file. Fetched when the
 * panel opens rather than sent with the page: the timelines and object lists
 * can run to hundreds of entries per file.
 */
export interface PlateDetails {
  time: {
    durationMin: number | null
    modelDurationMin: number | null
    totalDurationMin: number | null
    firstLayerDurationMin: number | null
    silentDurationMin: number | null
  }
  filaments: PlateFilament[]
  filamentUsedG: number | null
  filamentLengthMm: number | null
  filamentVolumeCm3: number | null
  purgeG: number | null
  /** Purged grams as a share of all grams, in percent. */
  wastePercent: number | null
  geometry: {
    layerCount: number | null
    layerHeightMm: number | null
    maxZMm: number | null
    extents: SlicerFileMeta['extents'] | null
    bed: SlicerFileMeta['bed'] | null
    printableHeightMm: number | null
  }
  objects: string[]
  objectCount: number | null
  machine: {
    printerName: string | null
    printerModel: string | null
    printerPreset: string | null
    nozzleMm: number | null
    nozzleType: string | null
    gcodeFlavor: string | null
  }
  settings: {
    infillPercent: number | null
    wallCount: number | null
    supports: boolean | null
    adhesion: string | null
    nozzleTempC: number | null
    bedTempC: number | null
    slicerProfile: string | null
    slicerName: string | null
    slicerVersion: string | null
  }
  timeline: {
    /** False when only the ends of the file were read: no stops or changes are known. */
    bodyRead: boolean
    totalMin: number | null
    stops: TimelineStop[]
    stopCount: number
    toolChanges: TimelineToolChange[]
    toolChangeCount: number
  }
}

export function plateDetails(meta: SlicerFileMeta): PlateDetails {
  const body = meta.body
  const layerCount = meta.layerCount ?? null
  const totalMin = body?.progressTotalMin ?? meta.totalDurationMin ?? meta.durationMin ?? null

  /*
   * The slicer's own clock first, then its percentage, then the layer: each
   * is less exact than the one before, but all are better than leaving a stop
   * off the bar.
   */
  const position = (when: {
    elapsedMin: number | null
    progressPercent: number | null
    layer: number | null
  }): number | null => {
    const at =
      when.elapsedMin != null && totalMin
        ? when.elapsedMin / totalMin
        : when.progressPercent != null
          ? when.progressPercent / 100
          : when.layer != null && layerCount
            ? // At the start of its layer: layer 1 is the beginning.
              (when.layer - 1) / layerCount
            : null
    return at == null ? null : Math.min(1, Math.max(0, at))
  }

  const purgeByTool = new Map((meta.purge ?? []).map((entry) => [entry.tool, entry.grams]))
  const filaments = (meta.filaments ?? []).map((filament) => ({
    tool: filament.tool,
    material: filament.material,
    colorHex: filament.colorHex,
    grams: filament.grams,
    lengthMm: meta.filamentLengthsMm?.[filament.tool] ?? null,
    purgeG: purgeByTool.get(filament.tool) ?? null,
    used: filament.used,
  }))

  const used = meta.filamentUsedG ?? null
  const purgeG = meta.purgeG ?? null

  return {
    time: {
      durationMin: meta.durationMin ?? null,
      modelDurationMin: meta.modelDurationMin ?? null,
      totalDurationMin: meta.totalDurationMin ?? null,
      firstLayerDurationMin: meta.firstLayerDurationMin ?? null,
      silentDurationMin: meta.silentDurationMin ?? null,
    },
    filaments,
    filamentUsedG: used,
    filamentLengthMm: meta.filamentLengthMm ?? null,
    filamentVolumeCm3: meta.filamentVolumeCm3 ?? null,
    purgeG,
    wastePercent: used && purgeG != null ? Math.round((purgeG / used) * 1000) / 10 : null,
    geometry: {
      layerCount,
      layerHeightMm: meta.layerHeightMm ?? null,
      maxZMm: meta.maxZMm ?? null,
      extents: meta.extents ?? null,
      bed: meta.bed ?? null,
      printableHeightMm: meta.printableHeightMm ?? null,
    },
    objects: (body?.objects ?? []).slice(0, OBJECTS_LISTED),
    objectCount: body?.objectCount ?? null,
    machine: {
      printerName: meta.printerName ?? null,
      printerModel: meta.printerModel ?? null,
      printerPreset: meta.printerPreset ?? null,
      nozzleMm: meta.nozzleMm ?? null,
      nozzleType: meta.nozzleType ?? null,
      gcodeFlavor: meta.gcodeFlavor ?? null,
    },
    settings: {
      infillPercent: meta.infillPercent ?? null,
      wallCount: meta.wallCount ?? null,
      supports: meta.supports ?? null,
      adhesion: meta.adhesion ?? null,
      nozzleTempC: meta.nozzleTempC ?? null,
      bedTempC: meta.bedTempC ?? null,
      slicerProfile: meta.slicerProfile ?? null,
      slicerName: meta.slicerName ?? null,
      slicerVersion: meta.slicerVersion ?? null,
    },
    timeline: {
      bodyRead: body != null,
      totalMin,
      stops: (body?.pauses ?? []).map((pause) => ({
        kind: pause.kind,
        command: pause.command,
        elapsedMin: pause.elapsedMin,
        layer: pause.layer,
        zMm: pause.zMm,
        colorHex: pause.colorHex,
        tool: pause.tool,
        at: position(pause),
      })),
      stopCount: body?.pauses.length ?? 0,
      toolChanges: (body?.toolChangeTimeline ?? []).map((change) => ({
        from: change.from,
        to: change.to,
        layer: change.layer,
        elapsedMin: change.elapsedMin,
        at: position(change),
      })),
      toolChangeCount: body?.toolChanges ?? 0,
    },
  }
}
