import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '@pb/db'
import { FileRenameError, fileNameProblem, renameModelFile } from './file-rename-service'
import { LocalAdapter } from '../storage/local-adapter'
import { scanLibrary } from '../scan/scan-service'
import type { LibraryLocation } from '../storage/types'

describe('fileNameProblem', () => {
  it('accepts a new name with the same extension', () => {
    expect(fileNameProblem('benchy.stl', 'Benchy v2.STL')).toBeNull()
    expect(fileNameProblem('README', 'notes')).toBeNull()
  })

  it('refuses names that would move, hide or retype the file', () => {
    expect(fileNameProblem('benchy.stl', '')).not.toBeNull()
    expect(fileNameProblem('benchy.stl', 'parts/benchy.stl')).not.toBeNull()
    expect(fileNameProblem('benchy.stl', '..')).not.toBeNull()
    expect(fileNameProblem('benchy.stl', '.benchy.stl')).not.toBeNull()
    expect(fileNameProblem('benchy.stl', 'benchy.3mf')).not.toBeNull()
    expect(fileNameProblem('README', 'README.md')).not.toBeNull()
    expect(fileNameProblem('a.json', '.printbench.json')).not.toBeNull()
  })
})

const LIBRARY = '4d000000-0000-4000-8000-000000000202'

/** A real database and filesystem: the row and the disk have to agree afterwards. */
describe('renaming a file in a model', { tags: ['integration'] }, () => {
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
    root = await mkdtemp(path.join(tmpdir(), 'pb-rename-svc-'))
    await mkdir(path.join(root, 'dragon', 'parts'), { recursive: true })
    await writeFile(path.join(root, 'dragon', 'parts', 'wing.stl'), stl())
    await writeFile(path.join(root, 'dragon', 'body.stl'), stl())
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

  async function target(modelPath: string, filename: string) {
    const rows = await db.execute<{
      model_id: string
      path: string
      is_file_model: boolean
      file_id: string
      filename: string
      missing_at: Date | null
    }>(sql`
      SELECT m.id AS model_id, m.path, m.is_file_model,
             f.id AS file_id, f.filename, f.missing_at
      FROM models m JOIN model_files f ON f.model_id = m.id
      WHERE m.library_id = ${LIBRARY} AND m.path = ${modelPath} AND f.filename = ${filename}`)
    const row = rows.rows[0]!
    return {
      model: {
        id: row.model_id,
        libraryId: LIBRARY,
        path: row.path,
        isFileModel: row.is_file_model,
      },
      file: {
        id: row.file_id,
        modelId: row.model_id,
        filename: row.filename,
        missingAt: row.missing_at,
      },
    }
  }

  async function liveFiles(modelId: string) {
    const rows = await db.execute<{ id: string; filename: string }>(
      sql`SELECT id, filename FROM model_files
          WHERE model_id = ${modelId} AND missing_at IS NULL ORDER BY filename`,
    )
    return rows.rows
  }

  it('renames a file in a subfolder and keeps its row through a rescan', async () => {
    const t = await target('dragon', 'parts/wing.stl')
    const result = await renameModelFile(db, adapter(), t, 'left wing.stl')
    expect(result.filename).toBe('parts/left wing.stl')
    expect(await readdir(path.join(root, 'dragon', 'parts'))).toEqual(['left wing.stl'])

    await scan()
    const files = await liveFiles(t.model.id)
    expect(files.map((row) => row.filename)).toEqual(['body.stl', 'parts/left wing.stl'])
    expect(files.find((row) => row.filename === 'parts/left wing.stl')!.id).toBe(t.file.id)
  })

  it('moves a single-file model’s path along with its file', async () => {
    const t = await target('benchy.stl', 'benchy.stl')
    await renameModelFile(db, adapter(), t, 'tugboat.stl')
    await scan()

    const models = await db.execute<{ id: string; path: string }>(
      sql`SELECT id, path FROM models WHERE library_id = ${LIBRARY} AND missing_at IS NULL
          AND is_file_model ORDER BY path`,
    )
    expect(models.rows).toEqual([{ id: t.model.id, path: 'tugboat.stl' }])
    expect((await liveFiles(t.model.id)).map((row) => row.id)).toEqual([t.file.id])
  })

  it('refuses a name already taken in the folder, and leaves the disk alone', async () => {
    const t = await target('dragon', 'body.stl')
    await writeFile(path.join(root, 'dragon', 'tail.stl'), 'not scanned yet')
    await expect(renameModelFile(db, adapter(), t, 'tail.stl')).rejects.toThrow(FileRenameError)
    expect((await readdir(path.join(root, 'dragon'))).sort()).toEqual([
      'body.stl',
      'parts',
      'tail.stl',
    ])
  })

  it('refuses a name another single-file model already uses', async () => {
    await writeFile(path.join(root, 'tugboat.stl'), stl())
    await scan()
    const t = await target('benchy.stl', 'benchy.stl')
    await rm(path.join(root, 'tugboat.stl'))
    await expect(renameModelFile(db, adapter(), t, 'tugboat.stl')).rejects.toThrow(FileRenameError)
  })
})
