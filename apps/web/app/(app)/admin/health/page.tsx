import { Stethoscope } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
  PROBLEM_META,
  can,
  listProblems,
  problemSummary,
  type ProblemKind,
  type ProblemSort,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'
import { ProblemList } from './problem-list'
import { RecheckButton } from './recheck-button'
import { StatTile } from '@/components/ui/stat-tile'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Library health' }

const PAGE_SIZE = 100

const SORTS: readonly SortOption<ProblemSort>[] = [
  { value: 'severity', label: 'Severity' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Model name' },
]

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; library?: string; ignored?: string; sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'library:manage')) {
    return <NotPermitted what="library health" />
  }

  const params = await searchParams
  const db = getDb()

  const kind = (Object.keys(PROBLEM_META).includes(params.kind ?? '') ? params.kind : undefined) as
    ProblemKind | undefined
  const showIgnored = params.ignored === '1'
  const sort = pickSort(params.sort, SORTS, 'severity')

  /** This page with some filters changed and the rest — sort included — kept. */
  function href(change: { kind?: string | null; library?: string | null; ignored?: boolean }) {
    const next = {
      kind: change.kind === undefined ? kind : change.kind,
      library: change.library === undefined ? params.library : change.library,
      ignored: change.ignored ?? showIgnored,
    }
    const query = new URLSearchParams({
      ...(next.kind ? { kind: next.kind } : {}),
      ...(next.library ? { library: next.library } : {}),
      ...(next.ignored ? { ignored: '1' } : {}),
      ...(sort !== 'severity' ? { sort } : {}),
    }).toString()
    return query ? `/admin/health?${query}` : '/admin/health'
  }

  const [summary, problems, libraries] = await Promise.all([
    problemSummary(db, params.library),
    listProblems(db, {
      kind,
      libraryId: params.library,
      includeIgnored: showIgnored,
      limit: PAGE_SIZE,
      sort,
    }),
    db
      .select({ id: schema.libraries.id, name: schema.libraries.name })
      .from(schema.libraries)
      .orderBy(schema.libraries.name),
  ])

  const totals = summary.reduce(
    (acc, row) => {
      acc.open += row.open
      acc.ignored += row.ignored
      if (row.severity === 'danger') acc.danger += row.open
      return acc
    },
    { open: 0, ignored: 0, danger: 0 },
  )

  return (
    <>
      <PageHeader
        title="Library health"
        // A sentence like every Diagnostics page, then what the tiles below
        // cannot say: how many are urgent or ignored.
        description={[
          'Models and files that need attention.',
          totals.danger > 0 ? `${totals.danger} urgent` : null,
          totals.ignored > 0 ? `${totals.ignored} ignored` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={<RecheckButton />}
      />

      {/*
       * Ordered by severity, so a missing drive is the first thing on the page
       * and four hundred untagged models are the last.
       */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary
          .filter((row) => row.open > 0)
          .map((row) => (
            <StatTile
              key={row.kind}
              value={row.open}
              label={PROBLEM_META[row.kind].label}
              hint={PROBLEM_META[row.kind].hint}
              tone={row.severity === 'info' ? 'neutral' : row.severity}
              href={href({ kind: row.kind })}
              active={row.kind === kind}
            />
          ))}
      </div>

      <ListToolbar
        sort={
          problems.length > 1 && (
            <UrlSortControl options={SORTS} value={sort} defaultValue="severity" />
          )
        }
      >
        <nav aria-label="Filter" className="flex flex-wrap items-center gap-1.5 text-sm">
          <FilterLink href={href({ kind: null })} active={!kind}>
            All kinds
          </FilterLink>

          {libraries.length > 1 && (
            <>
              <span className="mx-1 text-[var(--color-ink-faint)]">·</span>
              <FilterLink href={href({ library: null })} active={!params.library}>
                All libraries
              </FilterLink>
              {libraries.map((library) => (
                <FilterLink
                  key={library.id}
                  href={href({ library: library.id })}
                  active={params.library === library.id}
                >
                  {library.name}
                </FilterLink>
              ))}
            </>
          )}

          <span className="mx-1 text-[var(--color-ink-faint)]">·</span>
          <FilterLink href={href({ ignored: !showIgnored })} active={showIgnored}>
            {showIgnored ? 'Hiding nothing' : 'Show ignored'}
          </FilterLink>
        </nav>
      </ListToolbar>

      {problems.length === 0 ? (
        <EmptyState
          icon={<Stethoscope className="size-6" />}
          title={totals.open === 0 ? 'The library looks healthy' : 'Nothing here'}
          description={
            totals.open === 0
              ? 'No missing files, no duplicates, nothing unreadable. Health is re-examined after every scan and again overnight.'
              : 'Nothing matches this filter.'
          }
        />
      ) : (
        <ProblemList
          problems={problems.map((problem) => ({
            id: problem.id,
            kind: problem.kind,
            severity: problem.severity,
            modelName: problem.modelName,
            modelPublicId: problem.modelPublicId,
            filename: problem.filename,
            libraryName: problem.libraryName,
            detail: problem.detail,
            ignored: problem.ignoredAt != null,
          }))}
          truncated={problems.length === PAGE_SIZE}
          kind={kind}
        />
      )}
    </>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-full bg-[var(--color-accent-soft)] px-3 py-1 font-medium text-[var(--color-accent)]'
          : 'rounded-full px-3 py-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
      }
    >
      {children}
    </Link>
  )
}
