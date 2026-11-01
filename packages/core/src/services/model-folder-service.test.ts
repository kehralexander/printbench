import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '@pb/db'
import {
  FolderConversionError,
  convertFileModelToFolder,
  folderNameFor,
} from './model-folder-service'
import { LocalAdapter } from '../storage/local-adapter'
import { scanLibrary } from '../scan/scan-service'
import type { LibraryLocation } from '../storage/types'

describe('folderNameFor', () => {
  it('names the folder after the file', () => {
    expect(folderNameFor('benchy.stl')).toBe('benchy')
    expect(folderNameFor('Packs/Red Dragon.3mf')).toBe('Red Dragon')
  })

  it('avoids names the grouping step would not read as a model', () => {
    expect(folderNameFor('parts.stl')).toBe('parts model')
    expect(folderNameFor('STL.stl')).toBe('STL model')
  })
})

const LIBRARY = '4d000000-0000-4000-8000-000000000201'

/**
 * Run against a real database and filesystem: what matters is that the model
 * row and the disk agree afterwards, and that a scan does not undo either.
 */
describe('converting a single-file model into a folder', { tags: ['integration'] }, () => {
  let pool: ReturnType<typeof createDb>['pool']
  let db: ReturnType<typeof createDb>['db']
  let root = ''

  const where = (): LibraryLocation => ({
    id: LIBRARY,
    kind: 'managed',
    backend: 'local',
    allowWrites: true,
    path: root,
  })
  const adapter = () => new LocalAdapter(where())
  const scan = () => scanLibrary({ db, storage: adapter(), library: where() }, { mode: 'deep' })

  beforeAll(() => {
    ;({ pool, db } = createDb())
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM libraries WHERE id = ${LIBRARY}`)
    if (root) await rm(root, { recursive: true, force: true })
    await pool.end()
  })

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM libraries WHERE id = ${LIBRARY}`)
    if (root) await rm(root, { recursive: true, force: true })
    root = await mkdtemp(path.join(tmpdir(), 'pb-folder-svc-'))
    await writeFile(path.join(root, 'benchy.stl'), stl())
    await db.execute(sql`
      INSERT INTO libraries (id, name, kind, backend, path, allow_writes, write_sidecar)
      VALUES (${LIBRARY}, 'Library', 'managed', 'local', ${root}, true, false)`)
    await scan()
  })

  function stl(): Buffer {
    const buffer = Buffer.alloc(84 + 50)
    buffer.writeUInt32LE(1, 80)
    return buffer
  }

  async function target() {
    const rows = await db.execute<{
      id: string
      path: string
      is_file_model: boolean
      missing_at: Date | null
    }>(sql`SELECT id, path, is_file_model, missing_at FROM models WHERE library_id = ${LIBRARY}`)
    const row = rows.rows[0]!
    return {
      model: {
        id: row.id,
        libraryId: LIBRARY,
        path: row.path,
        isFileModel: row.is_file_model,
        missingAt: row.missing_at,
      },
      library: { groupingMode: 'deepest' as const, groupingDepth: null },
    }
  }

  it('moves the file and keeps the same model and file rows through a rescan', async () => {
    const before = await target()
    expect(before.model).toMatchObject({ path: 'benchy.stl', isFileModel: true })
    await db.execute(sql`UPDATE models SET notes = 'keep me' WHERE id = ${before.model.id}`)
    const fileBefore = await db.execute<{ id: string }>(
      sql`SELECT id FROM model_files WHERE model_id = ${before.model.id}`,
    )

    const result = await convertFileModelToFolder(db, adapter(), before)
    expect(result.path).toBe('benchy')
    expect(await readdir(path.join(root, 'benchy'))).toEqual(['benchy.stl'])

    // A file added next to it, then the scan an upload would trigger.
    await writeFile(path.join(root, 'benchy', 'plate.gcode'), 'G28\n')
    await scan()

    const models = await db.execute<{
      id: string
      path: string
      is_file_model: boolean
      notes: string | null
      missing_at: string | null
    }>(
      sql`SELECT id, path, is_file_model, notes, missing_at FROM models WHERE library_id = ${LIBRARY}`,
    )
    expect(models.rows).toEqual([
      {
        id: before.model.id,
        path: 'benchy',
        is_file_model: false,
        notes: 'keep me',
        missing_at: null,
      },
    ])

    const files = await db.execute<{ id: string; filename: string }>(
      sql`SELECT id, filename FROM model_files
          WHERE model_id = ${before.model.id} AND missing_at IS NULL ORDER BY filename`,
    )
    expect(files.rows.map((row) => row.filename)).toEqual(['benchy.stl', 'plate.gcode'])
    expect(files.rows[0]!.id).toBe(fileBefore.rows[0]!.id)
  })

  it('picks a free folder name when one is taken', async () => {
    await mkdir(path.join(root, 'benchy'))
    await writeFile(path.join(root, 'benchy', 'notes.txt'), 'not a model')
    const result = await convertFileModelToFolder(db, adapter(), await target())
    expect(result.path).toBe('benchy (1)')
  })

  it('refuses where flat grouping would not make the folder a model', async () => {
    const t = await target()
    await expect(
      convertFileModelToFolder(db, adapter(), {
        ...t,
        library: { groupingMode: 'flat', groupingDepth: 2 },
      }),
    ).rejects.toThrow(FolderConversionError)
    expect(await readdir(root)).toContain('benchy.stl')
  })
})
