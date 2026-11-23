/**
 * Collapses a model's mesh files into parts with variants, so a download of
 * forty STLs reads as six parts rather than forty rows.
 *
 * Creators name variants by putting a size, a count or a qualifier after the
 * part: "Detergent Dispenser - Dosing Mechanism 50ml.stl",
 * "Cup (up to 95ml).stl", "Tank 150mm no window.stl". Two steps undo that:
 *
 *   1. A prefix nearly every file shares ("Detergent Dispenser - ") is the
 *      model's name repeated, and is dropped.
 *   2. What remains is split where the variant starts: at the first bracket,
 *      or the first word with a digit in it.
 *
 * Only files that end up with the same folder, part and extension are merged;
 * anything the heuristic cannot split stays a row of its own. Presentation
 * only — every action still gets the file's real name.
 */

export type GroupableFile = {
  id: string
  filename: string
  extension: string
}

export type FileVariant<F extends GroupableFile> = {
  file: F
  /** What tells this file apart from its siblings; '' for a part with one file. */
  label: string
}

export type FileGroup<F extends GroupableFile> = {
  key: string
  /** The part's name, without the shared prefix and the variant. */
  part: string
  /** The folder inside the model, '' at its root. */
  folder: string
  extension: string
  variants: FileVariant<F>[]
}

/** Below this many files a shared prefix is as likely to be a coincidence. */
const PREFIX_MIN_FILES = 3
/** How many of the files must share a prefix for it to count as the model's name. */
const PREFIX_SHARE = 0.75

const SEPARATOR = /[\s_\-–—.,+]/
const TRAILING_SEPARATORS = /[\s_\-–—.,+([]+$/
const LEADING_SEPARATORS = /^[\s_\-–—.,+)\]]+/

const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function splitPath(filename: string): { folder: string; base: string } {
  const slash = filename.lastIndexOf('/')
  const name = slash >= 0 ? filename.slice(slash + 1) : filename
  const dot = name.lastIndexOf('.')
  return {
    folder: slash >= 0 ? filename.slice(0, slash) : '',
    base: dot > 0 ? name.slice(0, dot) : name,
  }
}

/**
 * The longest prefix, ending on a separator, that most of the names share.
 * Returned with its separators, so stripping it leaves a clean name.
 */
export function sharedPrefix(names: string[]): string {
  if (names.length < PREFIX_MIN_FILES) return ''
  const needed = Math.ceil(names.length * PREFIX_SHARE)

  const counts = new Map<string, number>()
  for (const name of new Set(names)) {
    // Every prefix that ends right after a run of separators is a candidate.
    for (let i = 1; i < name.length; i++) {
      if (SEPARATOR.test(name[i - 1]!) && !SEPARATOR.test(name[i]!)) {
        const candidate = name.slice(0, i)
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1)
      }
    }
  }
  // Duplicates were folded above; count them back in.
  const multiplicity = new Map<string, number>()
  for (const name of names) multiplicity.set(name, (multiplicity.get(name) ?? 0) + 1)
  for (const candidate of counts.keys()) {
    let total = 0
    for (const [name, times] of multiplicity) if (name.startsWith(candidate)) total += times
    counts.set(candidate, total)
  }

  let best = ''
  for (const [candidate, count] of counts) {
    if (count >= needed && candidate.length > best.length) best = candidate
  }
  return best
}

/** "Dosing Mechanism 50ml" → part "Dosing Mechanism", variant "50ml". */
export function splitVariant(name: string): { part: string; variant: string } {
  let at = name.length
  const bracket = name.search(/[([]/)
  if (bracket > 0) at = bracket

  // The first word with a digit in it, words being split on separators.
  const word = /(^|[\s_\-–—,+])([^\s_\-–—,+]*\d)/.exec(name)
  if (word) {
    const start = word.index + word[1]!.length
    if (start > 0 && start < at) at = start
  }

  const part = name.slice(0, at).replace(TRAILING_SEPARATORS, '')
  if (!part) return { part: name, variant: '' }

  const variant = name
    .slice(at)
    .replace(LEADING_SEPARATORS, '')
    .replace(/[([\])]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { part, variant }
}

export function groupFiles<F extends GroupableFile>(
  files: F[],
): { prefix: string; groups: FileGroup<F>[] } {
  const parsed = files.map((file) => ({ file, ...splitPath(file.filename) }))
  const prefix = sharedPrefix(parsed.map((entry) => entry.base))

  const groups = new Map<string, FileGroup<F>>()
  for (const entry of parsed) {
    const stripped =
      prefix && entry.base.startsWith(prefix) && entry.base.length > prefix.length
        ? entry.base.slice(prefix.length)
        : entry.base
    const { part, variant } = splitVariant(stripped)
    const extension = entry.file.extension.toLowerCase()
    const key = `${entry.folder}\u0000${part.toLowerCase()}\u0000${extension}`

    let group = groups.get(key)
    if (!group) {
      group = { key, part, folder: entry.folder, extension, variants: [] }
      groups.set(key, group)
    }
    group.variants.push({ file: entry.file, label: variant || stripped })
  }

  for (const group of groups.values()) {
    if (group.variants.length === 1) {
      // Nothing to choose between: show the whole name rather than half of it.
      const only = group.variants[0]!
      const { base } = splitPath(only.file.filename)
      group.part =
        prefix && base.startsWith(prefix) && base.length > prefix.length
          ? base.slice(prefix.length)
          : base
      only.label = ''
    } else {
      group.variants.sort((a, b) => NATURAL.compare(a.label, b.label))
    }
  }

  return { prefix, groups: [...groups.values()] }
}
