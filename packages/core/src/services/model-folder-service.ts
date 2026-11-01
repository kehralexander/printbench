import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@pb/db'
import { schema } from '@pb/db'
import { isCommonSubfolder } from '../library/grouping'
import { basename, dirname, isIgnoredName, joinPath, segments, stemOf } from '../library/paths'
import type { StorageAdapter } from '../storage/types'
import { syncSidecar } from './model-service'

/**
 * Turning a single-file model into a folder model, so files can be added to it.
 *
 * A loose "dragon.stl" has nowhere to put a second file: its path IS the file.
 * Moving it into "dragon/dragon.stl" on disk alone would look, to the next
 * scan, like one model vanishing and an unrelated one appearing — losing the
 * tags, notes, print history, collections and share link hanging off the old
 * row. So the row is re-pointed at the new folder in the same step, and the
 * scan afterwards finds a folder model that already exists.
 *
 * The file row keeps its id and its filename: a loose file's filename is its
 * basename, which is exactly its name inside the new folder.
 */

export class FolderConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FolderConversionError'
  }
}

export interface FolderConversionTarget {
  model: {
    id: string
    libraryId: string
    path: string
    isFileModel: boolean
    missingAt: Date | null
  }
  library: { groupingMode: 'deepest' | 'top_level' | 'flat'; groupingDepth: number | null }
}

/**
 * The folder name a loose file moves into: its own name without the extension.
 *
 * A name the grouping step reads as part of its parent ("stl", "parts" …) or
 * ignores outright would not come back as a model, so those get a suffix.
 */
export function folderNameFor(filePath: string): string {
  const stem = stemOf(filePath).trim()
  if (!stem || isIgnoredName(stem) || isCommonSubfolder(stem)) return `${stem || 'model'} model`
  return stem
}

export async function convertFileModelToFolder(
  db: Database,
  storage: StorageAdapter,
  target: FolderConversionTarget,
): Promise<{ path: string }> {
  const { model, library } = target
  if (!model.isFileModel) return { path: model.path }
  if (model.missingAt) throw new FolderConversionError('This model is missing from disk.')

  const parent = dirname(model.path)

  // `flat` only treats folders at one exact depth as models. Anywhere else the
  // new folder would be a container, and its file a loose model again.
  if (
    library.groupingMode === 'flat' &&
    segments(parent).length + 1 !== (library.groupingDepth ?? 1)
  ) {
    throw new FolderConversionError(
      'This library only groups folders at a fixed depth into models, so this file cannot get a folder of its own here.',
    )
  }

  const folder = await freeFolder(db, storage, model.libraryId, parent, folderNameFor(model.path))
  const from = model.path
  const to = joinPath(folder, basename(model.path))

  await storage.move(from, to)
  try {
    await db
      .update(schema.models)
      .set({ path: folder, isFileModel: false, updatedAt: new Date() })
      .where(and(eq(schema.models.id, model.id), eq(schema.models.isFileModel, true)))
  } catch (error) {
    // The row still says the file is where it was; put it back there.
    await storage.move(to, from).catch(() => undefined)
    throw error
  }

  // A folder can hold the sidecar a loose file never could. Best effort: the
  // conversion itself already succeeded.
  await syncSidecar(db, model.id).catch(() => false)

  return { path: folder }
}

/**
 * A folder path nothing occupies — on disk, in another model row (a missing one
 * still owns its path for its grace period), or in the removed-models list,
 * which would make the next scan skip the folder entirely.
 */
async function freeFolder(
  db: Database,
  storage: StorageAdapter,
  libraryId: string,
  parent: string,
  name: string,
): Promise<string> {
  const onDisk = new Set(
    (await storage.list(parent)).map((entry) => basename(entry.path).toLowerCase()),
  )
  const candidates = [name, ...Array.from({ length: 99 }, (_, i) => `${name} (${i + 1})`)]
    .filter((candidate) => !onDisk.has(candidate.toLowerCase()))
    .map((candidate) => joinPath(parent, candidate))
  if (candidates.length === 0) throw new FolderConversionError('No free folder name was found.')

  const [models, exclusions] = await Promise.all([
    db
      .select({ path: schema.models.path })
      .from(schema.models)
      .where(and(eq(schema.models.libraryId, libraryId), inArray(schema.models.path, candidates))),
    db
      .select({ path: schema.modelExclusions.path })
      .from(schema.modelExclusions)
      .where(
        and(
          eq(schema.modelExclusions.libraryId, libraryId),
          inArray(schema.modelExclusions.path, candidates),
        ),
      ),
  ])
  const taken = new Set([...models, ...exclusions].map((row) => row.path))
  const free = candidates.find((candidate) => !taken.has(candidate))
  if (!free) throw new FolderConversionError('No free folder name was found.')
  return free
}
