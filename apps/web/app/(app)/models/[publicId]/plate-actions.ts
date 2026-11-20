'use server'

import { eq } from 'drizzle-orm'
import { storedSlicerMeta } from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { plateDetails, type PlateDetails } from './slicer-summaries'

type PlateDetailsResult = { ok: true; details: PlateDetails } | { ok: false; error: string }

/**
 * The plate panel's figures for one sliced file, from its stored read.
 *
 * Never reads the file itself: the panel opens on a click and should open at
 * once, and the background job keeps the stored read current. Scoped to the
 * model in the URL, as every action here is, since the file id comes from the
 * client.
 */
export async function readPlateDetails(
  publicId: string,
  fileId: string,
): Promise<PlateDetailsResult> {
  try {
    await requireUser()

    const rows = await getDb()
      .select({
        slicerMeta: schema.modelFiles.slicerMeta,
        slicerMetaVersion: schema.modelFiles.slicerMetaVersion,
        slicerMetaError: schema.modelFiles.slicerMetaError,
        publicId: schema.models.publicId,
      })
      .from(schema.modelFiles)
      .innerJoin(schema.models, eq(schema.models.id, schema.modelFiles.modelId))
      .where(eq(schema.modelFiles.id, fileId))
      .limit(1)

    const row = rows[0]
    if (!row || row.publicId !== publicId) {
      return { ok: false, error: 'That file does not belong to this model.' }
    }

    const meta = storedSlicerMeta(row)
    if (!meta) {
      return {
        ok: false,
        error: row.slicerMetaError
          ? 'This file could not be read.'
          : row.slicerMeta != null
            ? // An older reader's shape; the sweep reads it again.
              'This file is being read again. Check back in a few minutes.'
            : 'This file has not been read yet. Check back in a few minutes.',
      }
    }
    return { ok: true, details: plateDetails(meta) }
  } catch {
    return { ok: false, error: 'Could not load the details of this file.' }
  }
}
