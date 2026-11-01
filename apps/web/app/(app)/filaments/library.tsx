'use client'
import Link from 'next/link'
import { useState } from 'react'
import type { Filament, Spool } from '@pb/core'
import { Disc3, Plus } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Swatch } from '@/components/ui/swatch'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { Progress } from '@/components/ui/progress'
import { SortControl } from '@/components/ui/sort-control'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { compareAsc, compareDesc, compareText } from '@/lib/sort'
import { SpoolForm } from './spool-form'
import { spoolSubtitle } from './spool-label'
import { LIBRARY_SORTS, type LibrarySort } from './sort'
export function StockIndicator({ spool }: { spool: Spool }) {
  const low = spool.remainingG <= spool.lowStockG
  const label =
    spool.remainingG < 0
      ? 'Needs correction'
      : spool.remainingG === 0
        ? 'Empty'
        : low
          ? 'Low stock'
          : 'In stock'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{spool.remainingG.toLocaleString()} g remaining</span>
        <span className="flex items-center gap-1.5">
          {spool.archived && <Badge tone="neutral">Archived</Badge>}
          <Badge tone={spool.remainingG <= 0 ? 'danger' : low ? 'warning' : 'neutral'}>
            {label}
          </Badge>
        </span>
      </div>
      <Progress
        value={spool.remainingG / spool.nominalWeightG}
        label="Filament remaining"
        valueText={`${spool.remainingG} grams remaining`}
        tone={spool.remainingG <= 0 ? 'danger' : low ? 'warning' : 'accent'}
      />
    </div>
  )
}
export function FilamentLibrary({
  spools,
  filaments,
  canManage,
}: {
  spools: Spool[]
  filaments: Filament[]
  canManage: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [material, setMaterial] = useState('')
  const [location, setLocation] = useState('')
  const [state, setState] = useState('active')
  const [sort, setSort] = useState<LibrarySort>('name')
  const materials = [...new Set(spools.map((s) => s.filament.material))].sort()
  const locations = [...new Set(spools.map((s) => s.location).filter(Boolean))].sort()
  const matches = spools.filter((s) => {
    const haystack = [
      s.filament.brand,
      s.filament.name,
      s.filament.material,
      s.filament.colorName,
      s.label,
    ]
      .join(' ')
      .toLowerCase()
    return (
      haystack.includes(query.toLowerCase()) &&
      (!material || s.filament.material === material) &&
      (!location || s.location === location) &&
      (state === 'archived' ? s.archived : !s.archived) &&
      (state !== 'low' || s.remainingG <= s.lowStockG) &&
      (state !== 'empty' || s.remainingG <= 0)
    )
  })
  // The server lists spools oldest first, so their position is when they were added.
  const added = new Map(spools.map((s, index) => [s.id, index]))
  const name = (s: Spool) => s.label || s.filament.name
  matches.sort((a, b) => {
    switch (sort) {
      case 'most':
        return compareDesc(a.remainingG, b.remainingG) || compareText(name(a), name(b))
      case 'least':
        return compareAsc(a.remainingG, b.remainingG) || compareText(name(a), name(b))
      case 'material':
        return (
          compareText(a.filament.material, b.filament.material) || compareText(name(a), name(b))
        )
      case 'recent':
        return compareDesc(added.get(a.id), added.get(b.id))
      default:
        return compareText(name(a), name(b))
    }
  })
  return (
    <>
      <PageHeader
        title="Filaments"
        description="Your spools, what’s left, and what you’ve printed with them."
        actions={
          // Hidden while the form is open, which closes from its own Cancel —
          // the same as adding requests to the queue or a collection.
          canManage &&
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              Add spool
            </Button>
          )
        }
      >
        {spools.length > 0 && `${spools.filter((s) => !s.archived).length} active spools`}
      </PageHeader>
      <div className="space-y-5">
        {adding && <SpoolForm filaments={filaments} onCancel={() => setAdding(false)} />}
        <ListToolbar
          sort={
            <SortControl
              options={LIBRARY_SORTS}
              value={sort}
              onChange={setSort}
              count={spools.length}
            />
          }
        >
          <Input
            aria-label="Search filaments"
            placeholder="Search brand, material, colour…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            aria-label="Filter material"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className="w-auto"
          >
            <option value="">All materials</option>
            {materials.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select
            aria-label="Filter location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-auto"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l} value={l!}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter stock"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-auto"
          >
            <option value="active">Active spools</option>
            <option value="low">Low stock</option>
            <option value="empty">Empty / needs correction</option>
            <option value="archived">Archived</option>
          </Select>
        </ListToolbar>
        {matches.length === 0 ? (
          <EmptyState
            icon={<Disc3 />}
            title={spools.length ? 'No matching spools' : 'Start your filament library'}
            description={
              spools.length
                ? 'Try a different search or filter.'
                : 'Add a roll to track its remaining weight and use it in your print logs.'
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {matches.map((s) => (
              <Card
                key={s.id}
                className="transition-colors hover:border-[var(--color-border-strong)]"
              >
                <Link href={`/filaments/${s.id}`} className="block space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <Swatch color={s.filament.colorHex} className="mt-1 size-9" />
                    <div className="min-w-0">
                      <CardTitle className="break-words">{s.label || s.filament.name}</CardTitle>
                      <p className="text-sm text-[var(--color-ink-muted)]">{spoolSubtitle(s)}</p>
                    </div>
                  </div>
                  <StockIndicator spool={s} />
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {s.location || 'No location set'} · {s.filament.diameterMm} mm ·{' '}
                    {s.nominalWeightG} g roll
                  </p>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
