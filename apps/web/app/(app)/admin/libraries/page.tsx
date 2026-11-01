import Link from 'next/link'
import { desc, sql } from 'drizzle-orm'
import { FolderPlus, HardDrive, Lock } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, listExclusions, nextRun } from '@pb/core'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LocalTime } from '@/components/ui/local-time'
import { UrlSortControl } from '@/components/ui/sort-control'
import { formatBytes } from '@/lib/format'
import { compareDesc, compareText, pickSort, type SortOption } from '@/lib/sort'
import { LibraryActions } from './library-actions'
import { SchedulePicker } from './schedule-picker'
import { RemovedModels } from './removed-models'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Libraries' }

const NUMBER = new Intl.NumberFormat('en-GB')

type LibrarySort = 'newest' | 'name' | 'models' | 'size' | 'scanned'
const SORTS: readonly SortOption<LibrarySort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'models', label: 'Most models' },
  { value: 'size', label: 'Largest' },
  { value: 'scanned', label: 'Last scanned' },
]

export default async function LibrariesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'library:manage')) {
    return <NotPermitted what="library management" />
  }

  const sort = pickSort((await searchParams).sort, SORTS, 'newest')
  const db = getDb()

  const removed = await listExclusions(db)

  const libraries = await db
    .select({
      id: schema.libraries.id,
      name: schema.libraries.name,
      path: schema.libraries.path,
      kind: schema.libraries.kind,
      backend: schema.libraries.backend,
      groupingMode: schema.libraries.groupingMode,
      scanEnabled: schema.libraries.scanEnabled,
      scanCron: schema.libraries.scanCron,
      watchEnabled: schema.libraries.watchEnabled,
      writeSidecar: schema.libraries.writeSidecar,
      createdAt: schema.libraries.createdAt,
    })
    .from(schema.libraries)
    .orderBy(desc(schema.libraries.createdAt))
  type Library = (typeof libraries)[number]

  // One aggregate for all libraries rather than a query per row.
  const stats = await db.execute<{
    library_id: string
    models: number
    files: number
    total_size: string
  }>(sql`
    SELECT library_id,
           count(*)::int AS models,
           coalesce(sum(file_count), 0)::int AS files,
           coalesce(sum(total_size), 0)::bigint AS total_size
    FROM models WHERE missing_at IS NULL
    GROUP BY library_id
  `)
  const statsById = new Map(stats.rows.map((row) => [row.library_id, row]))

  const runs = await db.execute<{
    library_id: string
    status: string
    mode: string
    abort_reason: string | null
    finished_at: string | null
    models_created: number
    models_missing: number
  }>(sql`
    SELECT DISTINCT ON (library_id)
      library_id, status, mode, abort_reason, finished_at, models_created, models_missing
    FROM scan_runs ORDER BY library_id, created_at DESC
  `)
  const runById = new Map(runs.rows.map((row) => [row.library_id, row]))

  /*
   * Sorted here rather than in SQL: the counts and the last scan come from the
   * two aggregates above, and an admin has a handful of libraries at most.
   */
  if (sort !== 'newest') {
    const by: Record<Exclude<LibrarySort, 'newest'>, (a: Library, b: Library) => number> = {
      name: (a, b) => compareText(a.name, b.name),
      models: (a, b) =>
        compareDesc(statsById.get(a.id)?.models ?? 0, statsById.get(b.id)?.models ?? 0),
      size: (a, b) =>
        compareDesc(
          Number(statsById.get(a.id)?.total_size ?? 0),
          Number(statsById.get(b.id)?.total_size ?? 0),
        ),
      scanned: (a, b) =>
        compareDesc(runById.get(a.id)?.finished_at, runById.get(b.id)?.finished_at),
    }
    libraries.sort(by[sort])
  }

  return (
    <>
      <PageHeader
        title="Libraries"
        description="Folders PrintBench indexes. Your files are never moved or renamed."
        actions={
          // The empty state below offers the same thing, more prominently.
          libraries.length > 0 && (
            <Button asChild>
              <Link href="/admin/libraries/new">
                <FolderPlus />
                Add library
              </Link>
            </Button>
          )
        }
      />

      {libraries.length === 0 ? (
        <EmptyState
          icon={<HardDrive />}
          title="No libraries yet"
          description="Point PrintBench at a folder of STL and 3MF files. It indexes them where they already live. Nothing is moved, renamed or deleted."
          action={
            <Button asChild>
              <Link href="/admin/libraries/new">
                <FolderPlus />
                Add your first library
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={SORTS}
                value={sort}
                defaultValue="newest"
                count={libraries.length}
              />
            }
          />
          <div className="space-y-3">
            {libraries.map((library) => {
              const stat = statsById.get(library.id)
              const run = runById.get(library.id)
              const aborted = run?.status === 'aborted'

              return (
                <Card key={library.id}>
                  <CardContent className="flex flex-wrap items-start gap-4 p-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
                      <HardDrive className="size-5" />
                    </span>

                    {/* basis-60: on a phone the actions wrap below the details
                        instead of squeezing them into a narrow column. */}
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{library.name}</h2>
                        {library.kind === 'in_place' && (
                          <Badge tone="neutral">
                            <Lock className="size-3" />
                            Read-only
                          </Badge>
                        )}
                        {!library.scanEnabled && <Badge tone="neutral">Scanning off</Badge>}
                      </div>

                      <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                        {library.path}
                      </p>

                      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                        {/*
                        A count is the obvious thing to click when you want to
                        see what it counted. Search already filters by library,
                        so this needs no new page — just the link nobody had
                        put on it.
                      */}
                        {(stat?.models ?? 0) > 0 ? (
                          <Link
                            href={`/models?library=${library.id}`}
                            className="font-medium text-[var(--color-accent)] hover:underline"
                          >
                            {NUMBER.format(stat!.models)} models
                          </Link>
                        ) : (
                          <>0 models</>
                        )}{' '}
                        · {NUMBER.format(stat?.files ?? 0)} files ·{' '}
                        {formatBytes(Number(stat?.total_size ?? 0))}
                      </p>

                      <div className="mt-2">
                        <SchedulePicker
                          libraryId={library.id}
                          cron={library.scanCron ?? ''}
                          enabled={library.scanEnabled}
                          watchable={library.backend === 'local'}
                          watching={library.watchEnabled}
                          nextRunLabel={
                            /*
                             * Formatted on the server so the label and the
                             * schedule agree about the timezone — cron is read in
                             * the server's local time, not the browser's.
                             */
                            library.scanEnabled
                              ? (nextRun(library.scanCron)?.toLocaleString('en-GB', {
                                  weekday: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }) ?? null)
                              : null
                          }
                        />
                      </div>

                      {run && (
                        <p
                          className={
                            aborted
                              ? 'mt-2 text-sm text-[var(--color-danger)]'
                              : 'mt-2 text-xs text-[var(--color-ink-faint)]'
                          }
                        >
                          {aborted ? (
                            <>
                              Last scan was stopped for safety (
                              {run.abort_reason?.replace(/_/g, ' ')}
                              ). Nothing was removed from the index.
                            </>
                          ) : (
                            <>
                              Last {run.mode} scan{' '}
                              {run.finished_at ? (
                                <LocalTime value={new Date(run.finished_at).toISOString()} />
                              ) : (
                                'in progress'
                              )}
                              {run.models_created > 0 && ` · ${run.models_created} added`}
                              {run.models_missing > 0 && ` · ${run.models_missing} missing`}
                            </>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="ml-auto flex flex-col items-end gap-1.5">
                      <LibraryActions
                        libraryId={library.id}
                        name={library.name}
                        modelCount={stat?.models ?? 0}
                        writesSidecars={library.writeSidecar}
                        needsConfirmation={aborted}
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      <RemovedModels
        removed={removed.map((entry) => ({
          libraryId: entry.libraryId,
          libraryName: entry.libraryName,
          path: entry.path,
          name: entry.name,
          excludedAt: entry.excludedAt.toISOString(),
        }))}
      />
    </>
  )
}
