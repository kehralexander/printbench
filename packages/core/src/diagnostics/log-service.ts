import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { schema, type Database } from '@pb/db'
import { LOG_LEVELS, type LogLevel } from './log-capture'
import type { ProcessRole } from './process-role'

export type LogEntry = typeof schema.appLogs.$inferSelect

export interface LogFilter {
  /** This level and anything more severe. */
  minLevel?: LogLevel
  source?: ProcessRole
  /** Matches the message and the scope. */
  query?: string
  /** Page backwards: only entries older than this id. */
  beforeId?: number
  /** Page forwards: only entries newer than this id. Used when reading oldest first. */
  afterId?: number
  /** Newest first by default; oldest first reads a run of events in the order they happened. */
  order?: 'newest' | 'oldest'
  limit?: number
}

/** Newest first, unless asked for oldest first. */
export async function listLogs(db: Database, filter: LogFilter = {}): Promise<LogEntry[]> {
  const t = schema.appLogs
  const conditions: (SQL | undefined)[] = []

  if (filter.minLevel && filter.minLevel !== 'debug') {
    conditions.push(inArray(t.level, LOG_LEVELS.slice(LOG_LEVELS.indexOf(filter.minLevel))))
  }
  if (filter.source) conditions.push(eq(t.source, filter.source))
  /*
   * Ordered by when each line was written, not by when it reached the table:
   * the web app and the worker flush in batches, so ids interleave the two
   * out of time order. A cursor is still an id; the line it names supplies
   * the time to continue from.
   */
  if (filter.beforeId) {
    conditions.push(
      sql`(${t.at}, ${t.id}) < (SELECT at, id FROM app_logs WHERE id = ${filter.beforeId})`,
    )
  }
  if (filter.afterId) {
    conditions.push(
      sql`(${t.at}, ${t.id}) > (SELECT at, id FROM app_logs WHERE id = ${filter.afterId})`,
    )
  }
  const query = filter.query?.trim()
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    conditions.push(or(ilike(t.message, pattern), ilike(t.scope, pattern)))
  }

  return db
    .select()
    .from(t)
    .where(and(...conditions))
    .orderBy(...(filter.order === 'oldest' ? [asc(t.at), asc(t.id)] : [desc(t.at), desc(t.id)]))
    .limit(Math.min(filter.limit ?? 200, 10_000))
}

/** One line per entry, oldest first, in the shape `docker logs` would give. */
export function formatLogLines(entries: LogEntry[]): string {
  return entries
    .slice()
    .reverse()
    .map(
      (entry) =>
        `${entry.at.toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(6)} ` +
        `${entry.scope ? `[${entry.scope}] ` : ''}${entry.message}`,
    )
    .join('\n')
}

/**
 * Bounds the log table by age and by size.
 *
 * Both, because a retention window alone does not protect a small disk from a
 * process that logs in a loop.
 */
export async function pruneLogs(
  db: Database,
  retentionDays: number,
  maxRows = 250_000,
): Promise<number> {
  const aged = await db.execute(sql`
    DELETE FROM app_logs WHERE at < now() - make_interval(days => ${Math.max(1, retentionDays)})`)
  const overflow = await db.execute(sql`
    DELETE FROM app_logs
    WHERE id <= (SELECT id FROM app_logs ORDER BY id DESC OFFSET ${maxRows} LIMIT 1)`)
  return (aged.rowCount ?? 0) + (overflow.rowCount ?? 0)
}
