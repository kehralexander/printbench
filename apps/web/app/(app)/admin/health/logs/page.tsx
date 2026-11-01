import { Download, Terminal } from 'lucide-react'
import { isLogLevel, listLogs, type LogEntry, type LogLevel } from '@pb/core'
import { getDb } from '@pb/db'
import { diagnosticsUser } from '@/lib/diagnostics'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LocalTime } from '@/components/ui/local-time'
import { FilterBar, Pager } from '../filter-bar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'
import { LiveRefresh } from './live-refresh'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Logs' }

const PAGE_SIZE = 200

interface Params {
  level?: string
  source?: string
  q?: string
  before?: string
  after?: string
  sort?: string
}

const SORTS: SortOption<'newest' | 'oldest'>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-[var(--color-ink-faint)]',
  info: 'text-[var(--color-ink-muted)]',
  warn: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-danger)]',
}

export default async function LogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await diagnosticsUser())) return <NotPermitted what="the application logs" />

  const params = await searchParams
  const minLevel = isLogLevel(params.level) ? params.level : undefined
  const source = params.source === 'web' || params.source === 'worker' ? params.source : undefined
  const query = params.q?.trim().slice(0, 200) || undefined
  const sort = pickSort(params.sort, SORTS, 'newest')
  const newestFirst = sort === 'newest'
  // One cursor per direction: "before" pages back from the newest line,
  // "after" pages forward from the first.
  const cursor = Math.floor(Number(newestFirst ? params.before : params.after)) || undefined

  const entries = await listLogs(getDb(), {
    minLevel,
    source,
    query,
    order: sort,
    ...(newestFirst ? { beforeId: cursor } : { afterId: cursor }),
    limit: PAGE_SIZE,
  })

  const filters = {
    ...(minLevel ? { level: minLevel } : {}),
    ...(source ? { source } : {}),
    ...(query ? { q: query } : {}),
    ...(newestFirst ? {} : { sort }),
  }
  const filtered = Object.keys(filters).some((key) => key !== 'sort')
  const last = entries.at(-1)

  return (
    <>
      <PageHeader
        title="Logs"
        description="What the web app and the worker have written to their logs. The same lines docker logs shows."
        actions={
          <>
            {/* Paging back through history and jumping to the top do not mix. */}
            {newestFirst && !cursor && <LiveRefresh />}
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/admin/logs/download?${new URLSearchParams(filters)}`} download>
                <Download />
                Download
              </a>
            </Button>
          </>
        }
      />

      <ListToolbar
        sort={
          <UrlSortControl
            options={SORTS}
            value={sort}
            defaultValue="newest"
            count={entries.length}
          />
        }
      >
        <FilterBar
          keep={newestFirst ? {} : { sort }}
          clearHref={
            filtered ? `/admin/health/logs${newestFirst ? '' : `?sort=${sort}`}` : undefined
          }
          selects={[
            {
              name: 'level',
              label: 'Level',
              value: minLevel ?? '',
              options: [
                { value: '', label: 'All levels' },
                { value: 'warn', label: 'Warnings and errors' },
                { value: 'error', label: 'Errors only' },
              ],
            },
            {
              name: 'source',
              label: 'Process',
              value: source ?? '',
              options: [
                { value: '', label: 'Web and worker' },
                { value: 'web', label: 'Web' },
                { value: 'worker', label: 'Worker' },
              ],
            },
          ]}
          search={{
            label: 'Search the logs',
            placeholder: 'Search log text, e.g. scan or a model name',
            value: query ?? '',
          }}
        />
      </ListToolbar>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Terminal />}
          title={filtered || cursor ? 'Nothing matches' : 'No log lines yet'}
          description={
            filtered || cursor
              ? 'No log lines match this filter.'
              : 'Lines appear here a couple of seconds after they are written. If the worker stays silent, check that its container is running.'
          }
        />
      ) : (
        <Card className="py-2">
          <ol className="font-mono text-xs leading-5">
            {entries.map((entry) => (
              <LogLine key={entry.id} entry={entry} />
            ))}
          </ol>
        </Card>
      )}

      <Pager
        previous={
          cursor
            ? {
                href: `/admin/health/logs?${new URLSearchParams(filters)}`,
                label: newestFirst ? 'Back to latest' : 'Back to first',
              }
            : undefined
        }
        next={
          entries.length === PAGE_SIZE && last
            ? {
                href: `/admin/health/logs?${new URLSearchParams({ ...filters, [newestFirst ? 'before' : 'after']: String(last.id) })}`,
                label: newestFirst ? 'Older' : 'Newer',
              }
            : undefined
        }
      />
    </>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const level = isLogLevel(entry.level) ? entry.level : 'info'
  return (
    // Wraps rather than scrolls: a long error is the line most worth reading.
    // On a phone the message drops below its time, level and source.
    <li className="flex flex-wrap gap-x-3 px-4 py-0.5 hover:bg-[var(--color-surface-2)]">
      <LocalTime
        value={entry.at.toISOString()}
        seconds
        className="shrink-0 text-[var(--color-ink-faint)]"
      />
      <span className={cn('w-10 shrink-0 font-semibold uppercase', LEVEL_CLASS[level])}>
        {level}
      </span>
      <span className="w-12 shrink-0 text-[var(--color-ink-faint)]">{entry.source}</span>
      <span
        className={cn(
          'min-w-0 basis-full whitespace-pre-wrap break-words sm:flex-1 sm:basis-0',
          level === 'error' && LEVEL_CLASS.error,
        )}
      >
        {entry.scope && <span className="text-[var(--color-accent)]">[{entry.scope}] </span>}
        {withoutEcho(entry.message)}
      </span>
    </li>
  )
}

/**
 * Libraries that format their own lines ("2026-11-01T16:04:50Z ERROR …") would
 * show the time and level twice; the columns already say both.
 */
function withoutEcho(message: string): string {
  return message.replace(
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+/i,
    '',
  )
}
