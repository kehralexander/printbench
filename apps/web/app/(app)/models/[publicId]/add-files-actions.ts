'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  FolderConversionError,
  PolicyError,
  assertCan,
  convertFileModelToFolder,
  createStorageAdapter,
  libraryLocationFromRow,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Gives a single-file model a folder, so files can be added to it.
 *
 * Its own step, confirmed in the dialog, rather than done silently on the
 * first upload: it moves a file the user can see on disk, and several uploads
 * starting at once would otherwise race to do it.
 */
export async function convertToFolder(publicId: string): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'file:upload')

    const db = getDb()
    const rows = await db
      .select({ model: schema.models, library: schema.libraries })
      .from(schema.models)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.models.libraryId))
      .where(eq(schema.models.publicId, publicId))
      .limit(1)

    const found = rows[0]
    if (!found) return { ok: false, error: 'That model no longer exists.' }
    if (found.library.kind !== 'managed' && !found.library.allowWrites) {
      return { ok: false, error: 'That library is read-only.' }
    }
    if (!found.model.isFileModel) return { ok: true }

    const { path } = await convertFileModelToFolder(
      db,
      createStorageAdapter(libraryLocationFromRow(found.library)),
      { model: found.model, library: found.library },
    )

    await audit(
      user,
      'model.folder_created',
      { type: 'model', id: publicId, label: found.model.name },
      { from: found.model.path, to: path },
    )

    revalidatePath(`/models/${publicId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    if (error instanceof FolderConversionError) return { ok: false, error: error.message }
    console.error(`[add-files] could not convert ${publicId}: ${String(error)}`)
    return { ok: false, error: 'Could not move the file into a folder.' }
  }
}
