import { sql } from 'drizzle-orm'
import { getDb } from '@pb/db'
import {
  PARSABLE_SLICER_EXTENSIONS,
  SLICER_META_VERSION,
  SYSTEM_ACTOR,
  derivedWorkFileSql,
  getSettings,
  prune,
  pruneAuditEvents,
  pruneLogs,
  recordAudit,
} from '@pb/core'
import { JOB, getQueue } from '@pb/jobs'

/**
 * The two maintenance sweeps.
 *
 * `reconcile` re-enqueues derived work that was lost — a worker killed
 * mid-render leaves a file pending forever otherwise, and the symptom is a
 * thumbnail that simply never appears.
 *
 * `archive` is the only scheduled job that deletes anything. It defers the
 * policy to prune(), which refuses to touch a library where every model is
 * missing, because that is an unmounted drive rather than a deletion.
 */

/** Enough to make progress each pass without flooding the queue. */
const RECONCILE_BATCH = 500

export async function handleMaintReconcile(): Promise<void> {
  await requeueSlicerMeta()

  const db = getDb()
  const queue = getQueue()

  /*
   * Files stuck pending with nothing queued for them. The age filter matters:
   * without it this would re-enqueue work that was handed out seconds ago and
   * is still running.
   */
  const stale = await db.execute<{ id: string; needs_analysis: boolean; needs_thumb: boolean }>(sql`
    SELECT f.id,
           (f.analysis_state = 'pending') AS needs_analysis,
           (f.thumb_state = 'pending')    AS needs_thumb
    FROM model_files f
    WHERE f.missing_at IS NULL AND ${derivedWorkFileSql('f')}
      AND (f.analysis_state = 'pending' OR f.thumb_state = 'pending')
      AND f.created_at < now() - '15 minutes'::interval
    ORDER BY f.created_at
    LIMIT ${RECONCILE_BATCH}`)

  if (stale.rows.length === 0) return

  const analyse = stale.rows.filter((row) => row.needs_analysis).map((row) => ({ fileId: row.id }))
  const thumbs = stale.rows.filter((row) => row.needs_thumb).map((row) => ({ fileId: row.id }))

  if (analyse.length > 0) await queue.sendMany(JOB.fileAnalyze, analyse)
  if (thumbs.length > 0) await queue.sendMany(JOB.fileThumbnail, thumbs)

  console.log(
    `[maint] re-enqueued ${analyse.length} analyses and ${thumbs.length} thumbnails ` +
      'that were left pending',
  )
}

/**
 * Sliced files whose stored read is missing or from an older reader.
 *
 * This is the backfill: files sliced before the reader existed, and every file
 * again whenever SLICER_META_VERSION is bumped. Files still waiting on analysis
 * are left out — analysis queues their read itself. The queue is keyed by
 * file, so resending one that is already queued is a no-op, and a batch per
 * pass works through a large library without flooding the queue.
 */
async function requeueSlicerMeta(): Promise<void> {
  const extensions = sql.join(
    PARSABLE_SLICER_EXTENSIONS.map((extension) => sql`${extension}`),
    sql`, `,
  )
  const due = await getDb().execute<{ id: string }>(sql`
    SELECT f.id
    FROM model_files f
    WHERE f.missing_at IS NULL
      AND f.extension IN (${extensions})
      AND f.slicer_meta_version IS DISTINCT FROM ${SLICER_META_VERSION}
      AND f.analysis_state <> 'pending'
    ORDER BY f.created_at
    LIMIT ${RECONCILE_BATCH}`)

  if (due.rows.length === 0) return

  await getQueue().sendMany(
    JOB.fileSlicerMeta,
    due.rows.map((row) => ({ fileId: row.id })),
    { singletonKey: (payload) => payload.fileId },
  )
  console.log(`[maint] queued ${due.rows.length} sliced files to read`)
}

export async function handleMaintArchive(): Promise<void> {
  const db = getDb()

  // The grace period is a setting, so an operator who wants a shorter or longer
  // one gets it without a redeploy.
  const { missingGraceDays, auditRetentionDays, logRetentionDays } = await getSettings(db)
  const result = await prune(db, { graceDays: missingGraceDays })

  if (result.librariesSkipped.length > 0) {
    console.warn(
      `[maint] skipped ${result.librariesSkipped.join(', ')} — every model missing, ` +
        'which looks like an unmounted drive rather than a deletion',
    )
  }

  if (result.modelsDeleted + result.filesDeleted > 0) {
    console.log(
      `[maint] removed ${result.modelsDeleted} models and ${result.filesDeleted} files ` +
        `missing for more than ${missingGraceDays} days`,
    )
    await recordAudit(db, {
      action: 'maintenance.pruned',
      actor: SYSTEM_ACTOR,
      detail: {
        modelsDeleted: result.modelsDeleted,
        filesDeleted: result.filesDeleted,
        graceDays: missingGraceDays,
      },
    })
  }

  if (result.scanRunsDeleted + result.problemsDeleted > 0) {
    console.log(
      `[maint] archived ${result.scanRunsDeleted} scan runs and ` +
        `${result.problemsDeleted} resolved problems`,
    )
  }

  // Diagnostics are bounded here too, so neither table grows for ever.
  const auditPruned = await pruneAuditEvents(db, auditRetentionDays)
  const logsPruned = await pruneLogs(db, logRetentionDays)
  if (auditPruned + logsPruned > 0) {
    console.log(`[maint] trimmed ${auditPruned} audit events and ${logsPruned} log lines`)
  }
}
