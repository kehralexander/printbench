import { sql } from 'drizzle-orm'
import type { Database } from '@pb/db'

/**
 * How often prints come out, and where the ones that do not give up.
 *
 * Built on the print history, with the printer's own progress for the prints
 * the tracker logged: a cancel at 40% is in `printer_jobs.progress`. A print
 * still running, or logged without an outcome, is left out — a rate is only
 * about prints that are over.
 */

export interface OutcomeRow {
  key: string
  label: string
  /** For the model and file groupings: where to link. */
  modelPublicId: string | null
  total: number
  successes: number
  failures: number
  /** Null with nothing settled; never a misleading 0%. */
  successRate: number | null
  /** Median progress (0–1) at which failed prints stopped, when the printer said. */
  typicalFailureAt: number | null
  /** Failed prints with a known stopping point, behind that median. */
  failuresWithProgress: number
}

export interface OutcomeStats {
  byModel: OutcomeRow[]
  byFile: OutcomeRow[]
  byMaterial: OutcomeRow[]
}

type Grouped = {
  key: string
  label: string
  model_public_id: string | null
  total: number
  successes: number
  failures: number
  typical_failure_at: number | null
  failures_with_progress: number
}

const SETTLED = sql`
  SELECT p.id, p.model_id, p.model_file_id, p.status,
         m.public_id AS model_public_id, m.name AS model_name, f.filename,
         -- "PLA Matte", "pla+", "PLA-CF" all count as PLA, as on the queue.
         nullif(regexp_replace(
           split_part(regexp_replace(upper(trim(coalesce(p.material, ''))), '[[:space:]_/-]+', ' ', 'g'), ' ', 1),
           '[^A-Z0-9]', '', 'g'), '') AS material,
         CASE WHEN p.status <> 'success' THEN j.progress::float END AS failed_at
  FROM print_runs p
  JOIN models m ON m.id = p.model_id
  LEFT JOIN model_files f ON f.id = p.model_file_id
  LEFT JOIN LATERAL (
    SELECT progress FROM printer_jobs WHERE print_run_id = p.id ORDER BY finished_at DESC LIMIT 1
  ) j ON true
  WHERE p.status IN ('success', 'failed', 'partial')`

const AGGREGATES = sql`
  count(*)::int AS total,
  count(*) FILTER (WHERE status = 'success')::int AS successes,
  count(*) FILTER (WHERE status <> 'success')::int AS failures,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY failed_at)
    FILTER (WHERE failed_at IS NOT NULL) AS typical_failure_at,
  count(failed_at)::int AS failures_with_progress`

/** Groups with a failure first, most failures first; then the busiest. */
const ORDER = sql`ORDER BY failures DESC, total DESC, label ASC`

export async function printOutcomeStats(db: Database, limit = 50): Promise<OutcomeStats> {
  const cap = Math.min(Math.max(limit, 1), 200)
  const [byModel, byFile, byMaterial] = await Promise.all([
    db.execute<Grouped>(sql`
      WITH settled AS (${SETTLED})
      SELECT model_id::text AS key, min(model_name) AS label,
             min(model_public_id) AS model_public_id, ${AGGREGATES}
      FROM settled GROUP BY model_id ${ORDER} LIMIT ${cap}`),
    db.execute<Grouped>(sql`
      WITH settled AS (${SETTLED})
      SELECT model_file_id::text AS key, min(filename) || ' · ' || min(model_name) AS label,
             min(model_public_id) AS model_public_id, ${AGGREGATES}
      FROM settled WHERE model_file_id IS NOT NULL AND filename IS NOT NULL
      GROUP BY model_file_id ${ORDER} LIMIT ${cap}`),
    db.execute<Grouped>(sql`
      WITH settled AS (${SETTLED})
      SELECT coalesce(material, '') AS key, coalesce(material, 'Not recorded') AS label,
             NULL AS model_public_id, ${AGGREGATES}
      FROM settled GROUP BY material ${ORDER} LIMIT ${cap}`),
  ])
  return {
    byModel: byModel.rows.map(toRow),
    byFile: byFile.rows.map(toRow),
    byMaterial: byMaterial.rows.map(toRow),
  }
}

function toRow(row: Grouped): OutcomeRow {
  return {
    key: row.key,
    label: row.label,
    modelPublicId: row.model_public_id,
    total: row.total,
    successes: row.successes,
    failures: row.failures,
    successRate: row.total > 0 ? row.successes / row.total : null,
    typicalFailureAt: row.typical_failure_at != null ? Number(row.typical_failure_at) : null,
    failuresWithProgress: row.failures_with_progress,
  }
}

/**
 * What a typical stopping point suggests, in the words someone at the printer
 * would use. Early failures are nearly always the first layers.
 */
export function failureHint(progress: number): string {
  if (progress < 0.1) return 'first layers — check bed adhesion and the first-layer height'
  if (progress > 0.85) return 'near the end — tall, thin parts, or the spool running out'
  return 'mid-print — supports, warping or a clog'
}
