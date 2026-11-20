'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  FileRenameError,
  PolicyError,
  assertCan,
  createStorageAdapter,
  libraryLocationFromRow,
  renameModelFile,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Renames one file of a model, on disk and in the database together.
 *
 * Only for libraries this application may write to — the same rule as adding
 * files. The storage adapter refuses an in-place library regardless.
 */
export async function renameFile(publicId: string, fileId: string, name: string): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'model:edit')

    const db = getDb()
    const rows = await db
      .select({ model: schema.models, library: schema.libraries, file: schema.modelFiles })
      .from(schema.modelFiles)
      .innerJoin(schema.models, eq(schema.models.id, schema.modelFiles.modelId))
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.models.libraryId))
      .where(and(eq(schema.models.publicId, publicId), eq(schema.modelFiles.id, fileId)))
      .limit(1)

    const found = rows[0]
    if (!found) return { ok: false, error: 'That file no longer exists.' }
    if (found.library.kind !== 'managed' && !found.library.allowWrites) {
      return { ok: false, error: 'That library is read-only.' }
    }

    const { filename } = await renameModelFile(
      db,
      createStorageAdapter(libraryLocationFromRow(found.library)),
      { model: found.model, file: found.file },
      name,
    )

    if (filename !== found.file.filename) {
      await audit(
        user,
        'model.file_renamed',
        { type: 'model', id: publicId, label: found.model.name },
        { from: found.file.filename, to: filename },
      )
    }

    revalidatePath(`/models/${publicId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    if (error instanceof FileRenameError) return { ok: false, error: error.message }
    console.error(`[rename-file] could not rename ${fileId} in ${publicId}: ${String(error)}`)
    return { ok: false, error: 'Could not rename that file.' }
  }
}
