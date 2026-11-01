import Link from 'next/link'
import type { Route } from 'next'
import { BarChart3, History } from 'lucide-react'
import { listPrints, printStats, unratedPrints, type PrintSort, type PrintStatus } from '@pb/core'
import { getDb } from '@pb/db'
import { getSessionUser } from '@pb/auth'
import { can } from '@pb/core'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { UrlSortControl } from '@/components/ui/sort-control'
import { formatGrams } from '@/lib/format'
import { pickSort, type SortOption } from '@/lib/sort'
import { PrintTimeline } from './print-timeline'
import { UnratedPrints } from './unrated-prints'

export const dynamic = 'force-dynamic'

/** While a print on screen is still running; the worker closes it when the printer finishes. */
const RUNNING_REFRESH_MS = 30_000
export const metadata = { title: 'Print history' }

const PAGE_SIZE = 50

const FILTERS: { key: string; label: string; status?: PrintStatus[] }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'success', label: 'Successes', status: ['success'] },
  { key: 'failed', label: 'Failures', status: ['failed', 'partial'] },
  { key: 'running', label: 'Still printing', status: ['in_progress'] },
]

const SORTS: SortOption<PrintSort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'longest', label: 'Longest' },
  { value: 'filament', label: 'Most filament' },
  { value: 'name', label: 'Model name' },
]

export default async function PrintsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="print history" />
  }

  const params = await searchParams
  const filter = FILTERS.find((option) => option.key === params.filter) ?? FILTERS[0]!
  const page = Math.max(Number(params.page ?? 1) || 1, 1)
  const sort = pickSort(params.sort, SORTS, 'newest')

  const db = getDb()
  const canRate = can({ id: user?.id ?? '', role: user?.role ?? null }, 'print:log')
  const [prints, stats, unrated] = await Promise.all([
    listPrints(db, {
      status: filter.status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      sort,
    }),
    printStats(db),
    canRate && page === 1 ? unratedPrints(db, 10) : Promise.resolve([]),
  ])

  const hasMore = prints.length === PAGE_SIZE
  // Every link keeps the sort; switching filter starts again from page one.
  const href = (filterKey: string, target = 1): Route => {
    const query = new URLSearchParams({ filter: filterKey })
    if (target > 1) query.set('page', String(target))
    if (sort !== 'newest') query.set('sort', sort)
    return `/prints?${query}` as Route
  }
  const link = (target: number) => href(filter.key, target)
  // Newest-first pages run back in time; any other order just runs on.
  const [backLabel, onLabel] =
    sort === 'newest'
      ? ['Newer', 'Older']
      : sort === 'oldest'
        ? ['Older', 'Newer']
        : ['Previous', 'Next']

  return (
    <>
      {prints.some((print) => print.status === 'in_progress') && (
        <AutoRefresh intervalMs={RUNNING_REFRESH_MS} />
      )}
      <PageHeader
        title="Print history"
        description={
          stats.total === 0
            ? 'Every print you log appears here.'
            : summarise(
                stats.total,
                stats.successRate,
                stats.totalFilamentG,
                stats.totalDurationMin,
              )
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/prints/stats">
              <BarChart3 />
              Success rates
            </Link>
          </Button>
        }
      />

      <UnratedPrints
        prints={unrated.map((print) => ({
          ...print,
          finishedAt: print.finishedAt?.toISOString() ?? null,
        }))}
      />

      <FilterTabs
        options={FILTERS.map((option) => ({ ...option, href: href(option.key) }))}
        current={filter.key}
        trailing={
          <UrlSortControl options={SORTS} value={sort} defaultValue="newest" count={stats.total} />
        }
      />

      {prints.length === 0 ? (
        /*
         * Three different empty states, because they mean different things:
         * nothing logged at all, nothing matching this filter, and a page
         * number past the end. Saying "no prints logged yet" while the header
         * counts one is just wrong.
         */
        <EmptyState
          icon={<History />}
          title={
            page > 1
              ? 'Nothing on this page'
              : stats.total === 0
                ? 'No prints logged yet'
                : `No ${filter.label.toLowerCase()} to show`
          }
          description={
            page > 1
              ? 'Go back a page.'
              : stats.total === 0
                ? 'Open a model and log a print once it comes off the plate. Settings that worked are worth keeping.'
                : 'Nothing in the history matches this filter.'
          }
          action={
            <Button asChild variant="secondary">
              <Link href={page > 1 ? link(page - 1) : stats.total === 0 ? '/models' : href('all')}>
                {page > 1
                  ? 'Previous page'
                  : stats.total === 0
                    ? 'Browse models'
                    : 'Show everything'}
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <PrintTimeline
            prints={prints.map((print) => ({
              id: print.id,
              filamentUsage: print.filamentUsage,
              modelName: print.modelName,
              modelPublicId: print.modelPublicId,
              filename: print.filename,
              userName: print.userName,
              printerName: print.printerName,
              material: print.material,
              colorHex: print.colorHex,
              layerHeightMm: print.layerHeightMm,
              nozzleMm: print.nozzleMm,
              nozzleType: print.nozzleType,
              filamentBrand: print.filamentBrand,
              infillPercent: print.infillPercent,
              slicerProfile: print.slicerProfile,
              status: print.status,
              durationMin: print.durationMin,
              filamentUsedG: print.filamentUsedG,
              rating: print.rating,
              notes: print.notes,
              hasPhoto: print.hasPhoto,
              at: (print.startedAt ?? print.createdAt).toISOString(),
            }))}
          />
        </Card>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-4 flex items-center justify-between">
          {page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={link(page - 1)}>{backLabel}</Link>
            </Button>
          ) : (
            <span />
          )}
          {hasMore && (
            <Button asChild variant="secondary" size="sm">
              <Link href={link(page + 1)}>{onLabel}</Link>
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function summarise(
  total: number,
  successRate: number | null,
  filamentG: number,
  durationMin: number,
): string {
  const parts = [`${total} print${total === 1 ? '' : 's'} logged`]
  // Null, not zero: nothing has settled yet, so there is no rate to quote.
  if (successRate != null) parts.push(`${Math.round(successRate * 100)}% success`)
  if (filamentG > 0) parts.push(`${formatGrams(filamentG)} filament`)
  if (durationMin > 0) parts.push(`${Math.round(durationMin / 60)} hours on the plate`)
  return parts.join(' · ')
}
