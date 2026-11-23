'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  DeleteError,
  PolicyError,
  assertCan,
  createStorageAdapter,
  deleteModelFile,
  libraryLocationFromRow,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

/** Deletes one file of a model, on disk and in the index. No undo. */
export async function deleteFile(publicId: string, fileId: string): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'model:delete',
    )

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

    const { bytesFreed } = await deleteModelFile(
      db,
      createStorageAdapter(libraryLocationFromRow(found.library)),
      { model: found.model, file: found.file },
    )

    await audit(
      user,
      'model.file_deleted',
      { type: 'model', id: publicId, label: found.model.name },
      { file: found.file.filename, bytesFreed },
    )

    revalidatePath(`/models/${publicId}`)
    revalidatePath('/models')
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    if (error instanceof DeleteError) return { ok: false, error: error.message }
    console.error(`[delete-file] could not delete ${fileId} in ${publicId}: ${String(error)}`)
    return { ok: false, error: 'Could not delete that file.' }
  }
}
