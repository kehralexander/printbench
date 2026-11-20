import { and, eq, ne, sql } from 'drizzle-orm'
import type { Database } from '@pb/db'
import { schema } from '@pb/db'
import { extensionOf } from '../library/media-types'
import {
  basename,
  dirname,
  isIgnoredName,
  isPrintBenchMetadataFilename,
  joinPath,
} from '../library/paths'
import { refreshModelSearchVectors } from '../search/refresh'
import type { StorageAdapter } from '../storage/types'
import { syncSidecar } from './model-service'

/**
 * Renaming one file inside a model.
 *
 * The same reasoning as turning a file into a folder: renaming on disk alone
 * would look, to the next scan, like one file vanishing and another appearing —
 * a fresh row that loses its print history, request lines and the model's
 * preview choice, all of which point at the file's id. So the row is updated
 * in the same step, and the scan afterwards finds a file it already knows.
 *
 * Only the last segment changes. The file stays in its folder, and keeps its
 * extension: the extension decides the file's category, its parser and its
 * thumbnail, and a rename that quietly turned an STL into "other" is a change
 * nobody asking to fix a typo expects.
 */

export class FileRenameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileRenameError'
  }
}

const MAX_NAME_BYTES = 255

/** Why a new name cannot be used, or null when it can. */
export function fileNameProblem(current: string, next: string): string | null {
  if (next === '') return 'A file needs a name.'
  if (/[/\\]/.test(next)) return 'A file name cannot contain slashes.'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(next)) return 'A file name cannot contain control characters.'
  if (next === '.' || next === '..') return 'That is not a usable file name.'
  if (Buffer.byteLength(next) > MAX_NAME_BYTES) return 'That file name is too long.'
  // Names the scan skips would make the file disappear from its model.
  if (isPrintBenchMetadataFilename(next) || isIgnoredName(next)) {
    return 'Files with that name are ignored by library scans.'
  }
  if (extensionOf(next) !== extensionOf(current)) {
    const extension = extensionOf(current)
    return extension
      ? `The name has to keep the .${extension} extension.`
      : 'The name cannot add an extension.'
  }
  return null
}

export interface FileRenameTarget {
  model: { id: string; libraryId: string; path: string; isFileModel: boolean }
  file: { id: string; modelId: string; filename: string; missingAt: Date | null }
}

/** Renames a file on storage and in the database together. Returns its new filename. */
export async function renameModelFile(
  db: Database,
  storage: StorageAdapter,
  target: FileRenameTarget,
  newName: string,
): Promise<{ filename: string }> {
  const { model, file } = target
  if (file.modelId !== model.id) throw new FileRenameError('That file is not part of this model.')
  if (file.missingAt) throw new FileRenameError('This file is missing from disk.')

  const name = newName.trim().normalize('NFC')
  const current = basename(file.filename)
  const problem = fileNameProblem(current, name)
  if (problem) throw new FileRenameError(problem)
  if (name === current) return { filename: file.filename }

  /*
   * A loose-file model's path IS its file, and its one file row carries just
   * the basename. Both move together, and the model path has to stay free of
   * other models and of the removed-models list.
   */
  const from = model.isFileModel ? model.path : joinPath(model.path, file.filename)
  const to = joinPath(dirname(from), name)
  const filename = model.isFileModel ? name : joinPath(dirname(file.filename), name)

  // Changing only the case of a name finds the file itself on a
  // case-insensitive volume, so there is nothing to collide with.
  const caseOnly = name.toLowerCase() === current.toLowerCase()
  if (!caseOnly) {
    const sibling = await db
      .select({ id: schema.modelFiles.id })
      .from(schema.modelFiles)
      .where(
        and(
          eq(schema.modelFiles.modelId, model.id),
          ne(schema.modelFiles.id, file.id),
          sql`lower(${schema.modelFiles.filename}) = lower(${filename})`,
        ),
      )
      .limit(1)
    if (sibling[0] || (await storage.stat(to))) {
      throw new FileRenameError(`Something called "${name}" is already there.`)
    }
  }

  if (model.isFileModel) {
    const [taken, excluded] = await Promise.all([
      db
        .select({ id: schema.models.id })
        .from(schema.models)
        .where(
          and(
            eq(schema.models.libraryId, model.libraryId),
            eq(schema.models.path, to),
            ne(schema.models.id, model.id),
          ),
        )
        .limit(1),
      db
        .select({ path: schema.modelExclusions.path })
        .from(schema.modelExclusions)
        .where(
          and(
            eq(schema.modelExclusions.libraryId, model.libraryId),
            eq(schema.modelExclusions.path, to),
          ),
        )
        .limit(1),
    ])
    if (taken[0]) throw new FileRenameError(`Another model is already called "${name}".`)
    if (excluded[0]) {
      throw new FileRenameError(
        `"${name}" is on the removed-models list, so the next scan would skip it.`,
      )
    }
  }

  await storage.move(from, to)
  try {
    await db.transaction(async (tx) => {
      const now = new Date()
      await tx
        .update(schema.modelFiles)
        .set({ filename, updatedAt: now })
        .where(eq(schema.modelFiles.id, file.id))
      await tx
        .update(schema.models)
        .set(model.isFileModel ? { path: to, updatedAt: now } : { updatedAt: now })
        .where(eq(schema.models.id, model.id))
    })
  } catch (error) {
    // The rows still say the file is where it was; put it back there.
    await storage.move(to, from).catch(() => undefined)
    throw error
  }

  // Filenames are searchable, and the sidecar names the preview file. Both
  // best effort: the rename itself already succeeded.
  await refreshModelSearchVectors(db, [model.id]).catch(() => undefined)
  await syncSidecar(db, model.id).catch(() => false)

  return { filename }
}
