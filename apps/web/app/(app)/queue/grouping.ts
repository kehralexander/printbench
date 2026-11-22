/**
 * How the queue groups its rows: every request for the same model, for the
 * same person, becomes one card with a line per part. Pure, so the page and
 * the drag-to-reorder list agree on it and it can be tested without React.
 */

/** What grouping needs to know about a row. */
export interface GroupableRow {
  id: string
  title: string
  modelId: string | null
  modelName: string | null
  customerId: string | null
  requestedBy: string | null
  filename: string | null
}

export interface RowGroup<T extends GroupableRow> {
  /** Stable while its rows are: the model and requester, or the lone row's id. */
  key: string
  rows: T[]
}

const EXTENSIONS = /\.(?:bgcode|gcode|gco|g|3mf|stl|obj|ply|step|stp)$/i
/** "5h18m25s", "52m58s", "1d2h": the print time a slicer puts last. */
const TIME = /^(?=\d)(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?$/
/** "0.16", "0.2mm": the layer height before it. */
const LAYER = /^\d+(?:\.\d+)?(?:mm)?$/
/** "PLA", "PETG", "PLA-CF": the material, in capitals as slicers write it. */
const MATERIAL = /^[A-Z][A-Z0-9+-]*$/

/**
 * The name of the part a request prints, from its file: the folder, the
 * extension and the slicer's suffix (`_PLA_0.16_5h18m25s`, as OrcaSlicer and
 * its relatives write by default) dropped, underscores read as spaces. Null
 * when nothing is left but the suffix (`PLA_0.2_2h7m21s.gcode`).
 */
export function partNameFromFile(filename: string | null): string | null {
  if (!filename) return null
  const tokens = filename.split('/').pop()!.replace(EXTENSIONS, '').split('_')
  // Only a real slicer suffix, which always ends in the print time.
  if (tokens.length > 1 && TIME.test(tokens.at(-1)!)) {
    tokens.pop()
    // At most one layer height and one material, in either order, so a part
    // called "Cup_XL" keeps its "XL".
    for (const kind of [LAYER, MATERIAL]) {
      const at = tokens.findLastIndex(
        (token, index) => index >= tokens.length - 2 && kind.test(token),
      )
      if (at >= 0) tokens.splice(at, 1)
    }
  }
  const name = tokens.join(' ').replace(/\s+/g, ' ').trim()
  return name.length > 0 ? name : null
}

/**
 * What to call a row inside its group: the part from the file, else the
 * request's own title when it says more than the model name, else the file.
 */
export function partName(row: GroupableRow): string {
  const fromFile = partNameFromFile(row.filename)
  if (fromFile) return fromFile
  if (row.modelName == null || !sameName(row.title, row.modelName)) return row.title
  return row.filename?.split('/').pop() ?? row.title
}

/** The heading of a group: the model, or the request when it has none. */
export function groupTitle(group: RowGroup<GroupableRow>): string {
  const first = group.rows[0]!
  return first.modelName ?? first.title
}

/** Which group a row belongs in. Rows with no model stand alone. */
export function groupKey(row: GroupableRow): string {
  if (!row.modelId) return `request:${row.id}`
  const who = row.customerId ?? row.requestedBy?.trim().toLowerCase() ?? ''
  return `model:${row.modelId}:${who}`
}

/**
 * Rows into groups, in the order each group's first row comes. Within a group
 * the rows keep their own order. With grouping off every row is its own group.
 */
export function groupRows<T extends GroupableRow>(rows: T[], enabled = true): RowGroup<T>[] {
  const groups = new Map<string, RowGroup<T>>()
  for (const row of rows) {
    const key = enabled ? groupKey(row) : `request:${row.id}`
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, rows: [row] })
  }
  return [...groups.values()]
}

/** The queue order a set of groups stands for: each group's rows together. */
export function flattenGroups<T extends GroupableRow>(groups: RowGroup<T>[]): string[] {
  return groups.flatMap((group) => group.rows.map((row) => row.id))
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
