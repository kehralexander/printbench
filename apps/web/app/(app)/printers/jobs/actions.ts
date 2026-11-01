'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  PolicyError,
  assertCan,
  createStorageAdapter,
  decryptSecret,
  dismissJob,
  downloadFromPrinter,
  libraryLocationFromRow,
  linkJobToModel,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { getStartedQueue, JOB } from '@pb/jobs'
import { audit } from '@/lib/audit'

type Result = { ok: true; message?: string } | { ok: false; error: string }

async function actor(permission: 'print:log' | 'file:upload') {
  const user = await requireUser()
  assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, permission)
  return user
}

async function jobRow(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null
  const [row] = await getDb()
    .select({ job: schema.printerJobs, host: schema.printHosts })
    .from(schema.printerJobs)
    .innerJoin(schema.printHosts, eq(schema.printHosts.id, schema.printerJobs.hostId))
    .where(eq(schema.printerJobs.id, jobId))
    .limit(1)
  return row ?? null
}

function revalidate() {
  revalidatePath('/printers/jobs')
  revalidatePath('/printers')
  revalidatePath('/prints')
  revalidatePath('/')
}

/** Files the job (and any others for the same file) under a model, with history. */
export async function linkPrinterJob(jobId: string, modelId: string): Promise<Result> {
  try {
    const user = await actor('print:log')
    const row = await jobRow(jobId)
    if (!row) return { ok: false, error: 'That job is gone.' }
    const [model] = await getDb()
      .select({ id: schema.models.id, name: schema.models.name, publicId: schema.models.publicId })
      .from(schema.models)
      .where(eq(schema.models.id, modelId))
      .limit(1)
    if (!model) return { ok: false, error: 'That model no longer exists.' }

    const linked = await linkJobToModel(getDb(), jobId, model.id)
    await audit(
      user,
      'print.job_linked',
      { type: 'model', id: model.publicId, label: model.name },
      { filename: row.job.filename, printer: row.host.name, jobs: linked },
    )
    revalidate()
    revalidatePath(`/models/${model.publicId}`)
    return {
      ok: true,
      message:
        linked > 1
          ? `Linked ${linked} prints of this file to ${model.name}.`
          : `Linked to ${model.name}.`,
    }
  } catch (error) {
    return failure(error, 'Could not link that job.')
  }
}

export async function dismissPrinterJob(jobId: string): Promise<Result> {
  try {
    await actor('print:log')
    await dismissJob(getDb(), jobId)
    revalidate()
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not dismiss that job.')
  }
}

/**
 * Fetches the job's file back from the printer into a model's folder, files
 * the job (and any other of the same file) under that model with its history,
 * and queues a scan so the file shows up on the model and later prints of it
 * match by themselves.
 *
 * Into an existing model, not a new one: a folder holding only G-code is not a
 * model to the scanner, which wants a mesh to call something a model.
 */
export async function addJobFileToModel(jobId: string, modelId: string): Promise<Result> {
  try {
    const user = await actor('file:upload')
    await actor('print:log')
    const row = await jobRow(jobId)
    if (!row) return { ok: false, error: 'That job is gone.' }

    const [found] = await getDb()
      .select({ model: schema.models, library: schema.libraries })
      .from(schema.models)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.models.libraryId))
      .where(eq(schema.models.id, modelId))
      .limit(1)
    if (!found || found.model.missingAt) return { ok: false, error: 'That model no longer exists.' }
    const { model, library } = found
    if (library.kind !== 'managed' && !library.allowWrites) {
      return { ok: false, error: `${library.name} is read-only. Link the print instead.` }
    }
    if (model.isFileModel) {
      return {
        ok: false,
        error: `${model.name} is a single file. Use Add files on the model once to give it a folder, then try again.`,
      }
    }

    const download = await downloadFromPrinter(
      {
        id: row.host.id,
        name: row.host.name,
        protocol: row.host.protocol,
        endpoint: row.host.endpoint,
        apiKey: decryptSecret(row.host.credentials),
      },
      row.job.filename,
    )
    if (!download.ok) return download

    const storage = createStorageAdapter(libraryLocationFromRow(library))
    const target = `${model.path}/${download.filename}`
    const existing = await storage.stat(target)
    if (!existing) await storage.write(target, download.data)

    const queue = await getStartedQueue()
    await queue.send(
      JOB.libraryScan,
      { libraryId: library.id, mode: 'fast', force: false },
      { singletonKey: `scan:${library.id}` },
    )
    const linked = await linkJobToModel(getDb(), jobId, model.id)
    await audit(
      user,
      'print.job_linked',
      { type: 'model', id: model.publicId, label: model.name },
      { filename: download.filename, printer: row.host.name, jobs: linked, fetched: !existing },
    )
    revalidate()
    revalidatePath(`/models/${model.publicId}`)
    return {
      ok: true,
      message: existing
        ? `${model.name} already had ${download.filename}; the print is filed under it.`
        : `Added ${download.filename} to ${model.name} and filed the print under it.`,
    }
  } catch (error) {
    return failure(error, 'Could not add that file to the model.')
  }
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
  console.error('[printer-jobs]', error)
  return { ok: false, error: fallback }
}
