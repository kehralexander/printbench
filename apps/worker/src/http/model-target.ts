import {
  dirname,
  extensionOf,
  isCommonSubfolder,
  joinPath,
  normalizePath,
  stemOf,
  type StorageAdapter,
} from '@pb/core'

/**
 * Where a file added to an existing model lands, relative to its folder.
 *
 * Only folders the grouping step already treats as part of a model ("stl",
 * "presupported", "images" …) are kept. Any other folder would be a candidate
 * model of its own, and an upload meant to add a file to one model must not
 * split it into two — so those are flattened to the bare filename.
 */
export function pathWithinModel(relativePath: string): string {
  const parts = normalizePath(relativePath).split('/')
  const name = parts.pop() ?? ''
  return parts.every((part) => isCommonSubfolder(part)) ? joinPath(...parts, name) : name
}

/**
 * The first free variant of `desired`: "plate.gcode", then "plate (1).gcode".
 *
 * Adding a file never replaces one. A re-sliced plate under the same name is
 * common, and silently overwriting the old one is how print history ends up
 * pointing at a file that is no longer what was printed.
 */
export async function freePath(storage: StorageAdapter, desired: string): Promise<string> {
  if (!(await storage.stat(desired))) return desired

  const dir = dirname(desired)
  const extension = extensionOf(desired)
  const stem = stemOf(desired)
  for (let n = 1; n < 1000; n++) {
    const name = extension ? `${stem} (${n}).${extension}` : `${stem} (${n})`
    const candidate = joinPath(dir, name)
    if (!(await storage.stat(candidate))) return candidate
  }
  throw new Error(`No free name left for ${desired}`)
}
