import Link from 'next/link'
import type { Route } from 'next'
import { CloudOff, Disc3, ExternalLink } from 'lucide-react'
import {
  SPOOLMAN_LOW_STOCK_G,
  spoolmanSpoolLink,
  type SpoolmanResult,
  type SpoolmanSpool,
} from '@pb/core'
import { Badge } from '@/components/ui/badge'
import { Swatch } from '@/components/ui/swatch'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { Progress } from '@/components/ui/progress'
import { UrlSortControl } from '@/components/ui/sort-control'
import { compareAsc, compareDesc, compareText } from '@/lib/sort'
import { SPOOLMAN_SORTS, type SpoolmanSort } from './sort'

/**
 * The filament inventory when Spoolman owns it: read-only, one card per
 * filament with its spools beneath. Every change happens in Spoolman, which is
 * also what the printer bridge reports usage to — so there is nothing here to
 * edit, and nothing that could deduct a print a second time.
 */
export function SpoolmanInventory({
  result,
  baseUrl,
  showArchived,
  sort,
}: {
  result: SpoolmanResult
  baseUrl: string
  showArchived: boolean
  sort: SpoolmanSort
}) {
  if (!result.ok) {
    return (
      <EmptyState
        icon={<CloudOff />}
        title="Spoolman is unreachable"
        description={`${result.error} The filament inventory lives in Spoolman, so there is nothing to show until it answers again.`}
        action={
          <Button asChild variant="secondary">
            <a href={baseUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open Spoolman
            </a>
          </Button>
        }
      />
    )
  }

  const archivedCount = result.spools.filter((spool) => spool.archived).length
  const spools = result.spools.filter((spool) => showArchived || !spool.archived)
  const groups = new Map<number, SpoolmanSpool[]>()
  for (const spool of spools) {
    const list = groups.get(spool.filamentId) ?? []
    list.push(spool)
    groups.set(spool.filamentId, list)
  }
  // Spools within a filament run fullest first, or emptiest first when that is
  // what you are looking for; the filaments follow their fullest/emptiest spool.
  const byRemaining = sort === 'least' ? compareAsc : compareDesc
  for (const group of groups.values()) {
    group.sort((a, b) => byRemaining(a.remainingG, b.remainingG))
  }
  const ordered = [...groups.values()].sort((a, b) =>
    sort === 'name'
      ? compareText(groupLabel(a[0]!), groupLabel(b[0]!))
      : byRemaining(a[0]!.remainingG, b[0]!.remainingG) ||
        compareText(groupLabel(a[0]!), groupLabel(b[0]!)),
  )
  const archivedHref = (show: boolean) => {
    const params = new URLSearchParams()
    if (show) params.set('archived', '1')
    if (sort !== 'name') params.set('sort', sort)
    const query = params.toString()
    return (query ? `/filaments?${query}` : '/filaments') as Route
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        className="mb-0 text-sm text-[var(--color-ink-muted)]"
        sort={
          <UrlSortControl
            options={SPOOLMAN_SORTS}
            value={sort}
            defaultValue="name"
            count={ordered.length}
          />
        }
      >
        <p>
          Read-only view of{' '}
          <a
            href={baseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] hover:underline"
          >
            Spoolman
          </a>
          . Add, edit and weigh spools there.
        </p>
        {archivedCount > 0 && (
          <Link
            href={archivedHref(!showArchived)}
            className="text-[var(--color-accent)] hover:underline"
          >
            {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
          </Link>
        )}
      </ListToolbar>

      {ordered.length === 0 ? (
        <EmptyState
          icon={<Disc3 />}
          title="No spools in Spoolman"
          description="Spools added in Spoolman appear here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ordered.map((group) => {
            const first = group[0]!
            return (
              <Card key={first.filamentId} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
                  <Swatch
                    color={first.colorHex}
                    title={first.colorHex ?? 'No colour'}
                    className="size-6"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {first.filamentName ?? 'Unnamed filament'}
                    </p>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">
                      {[first.vendor, first.material].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {group.map((spool) => (
                    <SpoolRow key={spool.id} spool={spool} />
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SpoolRow({ spool }: { spool: SpoolmanSpool }) {
  const remaining = spool.remainingG
  const fraction = remaining != null && spool.initialG ? remaining / spool.initialG : null
  const state =
    remaining == null
      ? null
      : remaining <= 0
        ? { label: 'Empty', tone: 'danger' as const }
        : remaining <= SPOOLMAN_LOW_STOCK_G
          ? { label: 'Low', tone: 'warning' as const }
          : null
  const link = spoolmanSpoolLink(spool.id)

  return (
    <li className={spool.archived ? 'space-y-2 px-4 py-3 opacity-60' : 'space-y-2 px-4 py-3'}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">#{spool.id}</span>
        {spool.location && <span className="text-[var(--color-ink-muted)]">{spool.location}</span>}
        {spool.archived && <Badge tone="neutral">Archived</Badge>}
        {state && <Badge tone={state.tone}>{state.label}</Badge>}
        <span className="ml-auto tabular-nums text-[var(--color-ink-muted)]">
          {remaining != null ? `${Math.round(remaining).toLocaleString()} g` : 'Unknown'}
          {spool.initialG ? ` of ${Math.round(spool.initialG).toLocaleString()} g` : ''}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open spool ${spool.id} in Spoolman`}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      {fraction != null && (
        <Progress
          value={fraction}
          label={`Spool ${spool.id} remaining`}
          size="sm"
          tone={state?.tone ?? 'accent'}
        />
      )}
      {spool.comment && <p className="text-xs text-[var(--color-ink-muted)]">{spool.comment}</p>}
    </li>
  )
}

function groupLabel(spool: SpoolmanSpool): string {
  return [spool.material, spool.vendor, spool.filamentName].filter(Boolean).join(' ')
}
