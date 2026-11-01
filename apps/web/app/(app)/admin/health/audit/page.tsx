import { Download, ScrollText } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import {
  AUDIT_CATEGORIES,
  auditCategory,
  auditLabel,
  listAuditEvents,
  type AuditCategory,
  type AuditEvent,
} from '@pb/core'
import { getDb } from '@pb/db'
import { diagnosticsUser } from '@/lib/diagnostics'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LocalTime } from '@/components/ui/local-time'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'
import { FilterBar, Pager } from '../filter-bar'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Audit trail' }

const PAGE_SIZE = 50

interface Params {
  category?: string
  outcome?: string
  q?: string
  page?: string
  sort?: string
}

type AuditSort = 'newest' | 'oldest'
const SORTS: readonly SortOption<AuditSort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await diagnosticsUser())) return <NotPermitted what="the audit trail" />

  const params = await searchParams
  const category =
    params.category && params.category in AUDIT_CATEGORIES
      ? (params.category as AuditCategory)
      : undefined
  const outcome =
    params.outcome === 'failure' || params.outcome === 'success' ? params.outcome : undefined
  const query = params.q?.trim().slice(0, 200) || undefined
  const page = Math.max(1, Math.floor(Number(params.page)) || 1)
  const sort = pickSort(params.sort, SORTS, 'newest')

  const { events, total } = await listAuditEvents(getDb(), {
    category,
    outcome,
    query,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    order: sort,
  })

  const filters = {
    ...(category ? { category } : {}),
    ...(outcome ? { outcome } : {}),
    ...(query ? { q: query } : {}),
  }
  const filtered = Object.keys(filters).length > 0
  // The sort survives filtering and paging; filters survive sorting.
  const keep: Record<string, string> = sort === 'newest' ? {} : { sort }
  const pageHref = (target: number) =>
    `/admin/health/audit?${new URLSearchParams({ ...filters, ...keep, page: String(target) })}`
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const [back, onwards] = sort === 'newest' ? ['Newer', 'Older'] : ['Older', 'Newer']

  return (
    <>
      <PageHeader
        title="Audit trail"
        description={
          total === 0 && !filtered
            ? 'A record of sign-ins and changes.'
            : `A record of sign-ins and changes · ${total.toLocaleString('en-GB')} event${total === 1 ? '' : 's'}${filtered ? ' matching' : ''}`
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/api/admin/audit/export?${new URLSearchParams(filters)}`} download>
              <Download />
              Export CSV
            </a>
          </Button>
        }
      />

      <ListToolbar
        sort={<UrlSortControl options={SORTS} value={sort} defaultValue="newest" count={total} />}
      >
        <FilterBar
          keep={keep}
          clearHref={
            filtered ? `/admin/health/audit${sort === 'newest' ? '' : `?sort=${sort}`}` : undefined
          }
          selects={[
            {
              name: 'category',
              label: 'Category',
              value: category ?? '',
              options: [
                { value: '', label: 'Everything' },
                ...Object.entries(AUDIT_CATEGORIES).map(([value, label]) => ({ value, label })),
              ],
            },
            {
              name: 'outcome',
              label: 'Outcome',
              value: outcome ?? '',
              options: [
                { value: '', label: 'Any outcome' },
                { value: 'success', label: 'Succeeded' },
                { value: 'failure', label: 'Failed or refused' },
              ],
            },
          ]}
          search={{
            label: 'Search the audit trail',
            placeholder: 'Search by person, item or IP address',
            value: query ?? '',
          }}
        />
      </ListToolbar>

      {events.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={filtered ? 'Nothing matches' : 'Nothing recorded yet'}
          description={
            filtered
              ? 'No events match this filter.'
              : 'Sign-ins, edits, deletions, scans and prints are recorded here from now on.'
          }
        />
      ) : (
        <Card className="divide-y divide-[var(--color-border)]">
          {events.map((event) => (
            <AuditRow key={event.id} event={event} />
          ))}
        </Card>
      )}

      {pages > 1 && (
        <Pager
          previous={page > 1 ? { href: pageHref(page - 1), label: back } : undefined}
          next={page < pages ? { href: pageHref(page + 1), label: onwards } : undefined}
          status={`Page ${page} of ${pages}`}
        />
      )}
    </>
  )
}

function actorName(event: AuditEvent): string {
  if (event.actorType === 'system') return 'PrintBench'
  if (event.actorType === 'anonymous') return event.actorName ?? 'Someone not signed in'
  return event.actorName ?? 'A deleted user'
}

/** A model that still exists can be opened; one that was just deleted cannot. */
function targetHref(event: AuditEvent): Route | null {
  if (event.targetType !== 'model' || !event.targetId) return null
  if (event.action === 'model.deleted' || event.action === 'model.files_deleted') return null
  return `/models/${event.targetId}` as Route
}

function detailEntries(detail: unknown): [string, string][] {
  if (!detail || typeof detail !== 'object') return []
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== '' && value !== 0 && value !== false)
    .map(([key, value]) => [
      // modelsAdded -> models added
      key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ])
}

function AuditRow({ event }: { event: AuditEvent }) {
  const href = targetHref(event)
  const details = detailEntries(event.detail)
  const category = auditCategory(event.action)

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <LocalTime
        value={event.occurredAt.toISOString()}
        seconds
        className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)] sm:w-44 sm:text-sm"
      />
      {/* On a phone the time is a line of its own above the event, not a
          column taking half the width. */}
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
        <p>
          <span className="font-medium">{actorName(event)}</span>{' '}
          <span className="text-[var(--color-ink-muted)]">
            {event.actorType === 'anonymous' ? '· ' : ''}
            {auditLabel(event.action)}
          </span>
          {event.targetLabel && (
            <>
              {' · '}
              {href ? (
                <Link href={href} className="font-medium hover:underline">
                  {event.targetLabel}
                </Link>
              ) : (
                <span className="font-medium">{event.targetLabel}</span>
              )}
            </>
          )}
        </p>
        {details.length > 0 && (
          <p className="mt-0.5 break-words text-xs text-[var(--color-ink-muted)]">
            {details.map(([key, value]) => `${key}: ${value}`).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {event.ip && (
          <span className="font-mono text-xs text-[var(--color-ink-faint)]">{event.ip}</span>
        )}
        {event.outcome === 'failure' && <Badge tone="danger">Failed</Badge>}
        {category && <Badge>{AUDIT_CATEGORIES[category]}</Badge>}
      </div>
    </div>
  )
}
