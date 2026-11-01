import Link from 'next/link'
import type { Route } from 'next'
import { ExternalLink } from 'lucide-react'
import {
  SPOOLMAN_LOW_STOCK_G,
  spoolmanSpoolLink,
  type SpoolmanResult,
  type SpoolmanSpool,
} from '@pb/core'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

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
}: {
  result: SpoolmanResult
  baseUrl: string
  showArchived: boolean
}) {
  if (!result.ok) {
    return (
      <EmptyState
        title="Spoolman is unreachable"
        description={`${result.error} The filament inventory lives in Spoolman, so there is nothing to show until it answers again.`}
        action={
          <a
            href={baseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            Open Spoolman
          </a>
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
  const ordered = [...groups.values()].sort((a, b) =>
    groupLabel(a[0]!).localeCompare(groupLabel(b[0]!)),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-ink-muted)]">
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
            href={(showArchived ? '/filaments' : '/filaments?archived=1') as Route}
            className="text-[var(--color-accent)] hover:underline"
          >
            {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
          </Link>
        )}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
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
                  <span
                    className="size-6 shrink-0 rounded-full ring-1 ring-inset ring-[var(--color-border)]"
                    style={{ backgroundColor: first.colorHex ?? 'transparent' }}
                    title={first.colorHex ?? 'No colour'}
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
                  {group
                    .sort((a, b) => (b.remainingG ?? 0) - (a.remainingG ?? 0))
                    .map((spool) => (
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
  const percent =
    remaining != null && spool.initialG
      ? Math.max(0, Math.min(100, (remaining / spool.initialG) * 100))
      : null
  const state =
    remaining == null
      ? null
      : remaining <= 0
        ? { label: 'Empty', tone: 'danger' as const }
        : remaining <= SPOOLMAN_LOW_STOCK_G
          ? { label: 'Low', tone: 'accent' as const }
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
      {percent != null && (
        <div
          role="progressbar"
          aria-label={`Spool ${spool.id} remaining`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {spool.comment && <p className="text-xs text-[var(--color-ink-muted)]">{spool.comment}</p>}
    </li>
  )
}

function groupLabel(spool: SpoolmanSpool): string {
  return [spool.material, spool.vendor, spool.filamentName].filter(Boolean).join(' ')
}
