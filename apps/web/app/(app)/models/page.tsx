import Link from 'next/link'
import type { Route } from 'next'
import {
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Search as SearchIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { searchModels, type SearchResult, type SortOrder } from '@pb/core'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { ModelGrid } from '@/components/model/model-grid'
import { SearchBox } from './search-box'
import { FacetPanel } from './facet-panel'
import { parseSearchParams, buildHref, type ParsedSearchParams, type RawParams } from './params'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Models' }

const NUMBER = new Intl.NumberFormat('en-GB')
const PAGE_SIZE = 48

/**
 * The library: every model, with search and filters over it.
 *
 * Browsing and searching are one page — an empty search box is simply the
 * whole library A–Z. Every part of the view lives in the URL, so it can be
 * bookmarked, shared and navigated back to, and results render on the server
 * rather than behind a spinner.
 *
 * Paging is by cursor wherever the order allows it (see `searchModels`), so
 * deep pages in a big library cost no more than the first. Only a typed
 * query in best-match order falls back to numbered offsets.
 */
export default async function ModelsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams
  const params = parseSearchParams(raw)
  const page = Math.max(1, params.page)

  const result = await searchModels(getDb(), {
    query: params.q,
    libraryIds: params.library,
    creatorIds: params.creator,
    tagIds: params.tag,
    licenses: params.license,
    extensions: params.format,
    presupported: params.presupported,
    neverPrinted: params.neverPrinted,
    missingPreview: params.missingPreview,
    minSize: params.minSize,
    isPackage: params.type === 'package' ? true : params.type === 'model' ? false : undefined,
    sort: params.sort as SortOrder,
    limit: PAGE_SIZE,
    // With a cursor the page number is only a label; a cursor that turns out
    // not to be one should land on the first page, not page × 48 in.
    offset: params.after || params.before ? 0 : (page - 1) * PAGE_SIZE,
    after: params.after,
    before: params.before,
  })

  const activeFilters = countActiveFilters(params)
  const narrowed = Boolean(params.q) || activeFilters > 0
  // Paged past the end — the library changed under a cursor — rather than
  // nothing matching.
  const stale = result.hits.length === 0 && result.total > 0

  if (!narrowed && result.total === 0) {
    return (
      <>
        <PageHeader title="Models" />
        <EmptyState
          icon={<HardDrive />}
          title="Nothing indexed yet"
          description="Add a library and run a scan, and your models will appear here."
          action={
            <Button asChild>
              <Link href="/admin/libraries">Go to libraries</Link>
            </Button>
          }
        />
      </>
    )
  }

  const resultLabel =
    params.type === 'package'
      ? result.total === 1
        ? 'package'
        : 'packages'
      : params.type === 'model'
        ? result.total === 1
          ? 'model'
          : 'models'
        : result.total === 1
          ? 'item'
          : 'items'

  const emptyFilterTitle =
    params.type === 'package'
      ? 'No packages match these filters'
      : params.type === 'model'
        ? 'No models match these filters'
        : 'No items match these filters'

  return (
    <>
      <PageHeader
        title="Models"
        description={
          narrowed
            ? `${NUMBER.format(result.total)} ${resultLabel}`
            : `${NUMBER.format(result.total)} in your library`
        }
      />

      <SearchBox initialQuery={params.q} params={raw} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Beside the grid on a wide screen; folded away above it on a narrow
            one, so the models are not pushed below a screenful of filters. */}
        <div className="hidden lg:block">
          <FacetPanel facets={result.facets} params={params} raw={raw} />
        </div>
        <details className="rounded-[var(--radius-card)] border border-[var(--color-border)] px-4 py-3 lg:hidden">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-[var(--color-ink-muted)]" />
            Filters
            {activeFilters > 0 && (
              <span className="text-[var(--color-accent)]">· {activeFilters} on</span>
            )}
          </summary>
          <div className="mt-4">
            <FacetPanel facets={result.facets} params={params} raw={raw} />
          </div>
        </details>

        <div className="min-w-0">
          {result.hits.length === 0 ? (
            <EmptyState
              icon={params.q ? <SearchIcon /> : <SlidersHorizontal />}
              title={
                stale
                  ? 'Nothing on this page'
                  : params.q
                    ? `Nothing matches "${params.q}"`
                    : emptyFilterTitle
              }
              description={
                stale
                  ? 'The library changed since this page was loaded.'
                  : params.q
                    ? 'Try fewer words, or check the spelling. Search tolerates small typos, and you can exclude a term with a minus, like: dragon -blue'
                    : 'Loosen or clear the filters to see more.'
              }
              action={
                <Button asChild variant="secondary">
                  {stale ? (
                    <Link href={buildHref(raw, {})}>Back to the start</Link>
                  ) : (
                    <Link href="/models">Clear everything</Link>
                  )}
                </Button>
              }
            />
          ) : (
            <>
              <ModelGrid models={result.hits} />

              <Pagination raw={raw} page={page} result={result} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Previous / next, and where you are.
 *
 * Cursor paging can only step, not jump; the page number rides along in the
 * URL purely to be shown. Stepping back to the first page drops the cursor,
 * so the first page always has the same plain URL.
 */
function Pagination({ raw, page, result }: { raw: RawParams; page: number; result: SearchResult }) {
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  let current = page
  let previous: Route | null
  let next: Route | null

  if (result.cursors) {
    // No way back means this is the start, whatever the URL claimed.
    if (!result.cursors.previous) current = 1
    previous = !result.cursors.previous
      ? null
      : current <= 2
        ? buildHref(raw, {})
        : buildHref(raw, {
            page: String(current - 1),
            before: result.cursors.previous,
            after: null,
          })
    next = result.cursors.next
      ? buildHref(raw, { page: String(current + 1), after: result.cursors.next, before: null })
      : null
  } else {
    previous = page > 1 ? buildHref(raw, { page: String(page - 1) }) : null
    next = page < totalPages ? buildHref(raw, { page: String(page + 1) }) : null
  }

  if (!previous && !next) return null
  return (
    <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Pagination">
      <PageLink href={previous}>
        <ChevronLeft />
        Previous
      </PageLink>
      <span className="text-sm text-[var(--color-ink-muted)]">
        Page {NUMBER.format(Math.min(current, totalPages))} of {NUMBER.format(totalPages)}
      </span>
      <PageLink href={next}>
        Next
        <ChevronRight />
      </PageLink>
    </nav>
  )
}

function PageLink({ href, children }: { href: Route | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <Button variant="secondary" size="sm" disabled>
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  )
}

function countActiveFilters(params: ParsedSearchParams): number {
  return (
    params.library.length +
    params.creator.length +
    params.tag.length +
    params.license.length +
    params.format.length +
    [
      params.presupported,
      params.neverPrinted,
      params.missingPreview,
      params.minSize !== undefined,
      params.type !== undefined,
    ].filter(Boolean).length
  )
}
