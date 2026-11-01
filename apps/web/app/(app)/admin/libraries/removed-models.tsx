'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LocalTime } from '@/components/ui/local-time'
import { SortControl } from '@/components/ui/sort-control'
import { compareDesc, compareText, type SortOption } from '@/lib/sort'
import { restore } from '../../models/[publicId]/delete-actions'

/**
 * Models removed from a library, and the way back.
 *
 * This is the undo for "remove from library". Restoring only lifts the
 * exclusion — the model itself is rebuilt by the next scan from the files and
 * its sidecar, so anything typed into the app and never written to a sidecar
 * is genuinely gone. Worth saying, rather than letting "restore" imply more
 * than it does.
 */

export interface RemovedModel {
  libraryId: string
  libraryName: string
  path: string
  name: string | null
  excludedAt: string
}

type RemovedSort = 'removed' | 'name' | 'library'
const SORTS: readonly SortOption<RemovedSort>[] = [
  { value: 'removed', label: 'Recently removed' },
  { value: 'name', label: 'Name' },
  { value: 'library', label: 'Library' },
]

const COMPARE: Record<RemovedSort, (a: RemovedModel, b: RemovedModel) => number> = {
  removed: (a, b) => compareDesc(a.excludedAt, b.excludedAt),
  name: (a, b) => compareText(a.name ?? a.path, b.name ?? b.path),
  library: (a, b) =>
    compareText(a.libraryName, b.libraryName) || compareText(a.name ?? a.path, b.name ?? b.path),
}

export function RemovedModels({ removed }: { removed: RemovedModel[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [sort, setSort] = useState<RemovedSort>('removed')

  if (removed.length === 0) return null
  const sorted = [...removed].sort(COMPARE[sort])

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle>Removed models</CardTitle>
          <CardDescription>
            Forgotten, but still on disk. Restoring rebuilds a model at the next library scan using
            its files and sidecar. Notes and tags return only if they were written to a sidecar.
          </CardDescription>
        </div>
        {removed.length > 1 && <SortControl options={SORTS} value={sort} onChange={setSort} />}
      </CardHeader>
      <CardContent>
        {error && <p className="mb-2 text-xs text-[var(--color-danger)]">{error}</p>}

        <ul className="divide-y divide-[var(--color-border)]">
          {sorted.map((entry) => (
            <li key={`${entry.libraryId}:${entry.path}`} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{entry.name ?? entry.path}</p>
                <p className="truncate font-mono text-xs text-[var(--color-ink-faint)]">
                  {entry.libraryName} · {entry.path}
                </p>
              </div>
              <LocalTime
                value={entry.excludedAt}
                className="shrink-0 text-xs text-[var(--color-ink-faint)]"
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null)
                  startTransition(async () => {
                    const result = await restore(entry.libraryId, entry.path)
                    if (!result.ok) setError(result.error)
                    else router.refresh()
                  })
                }}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
