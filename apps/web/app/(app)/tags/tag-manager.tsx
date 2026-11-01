'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Route } from 'next'
import { Combine, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Swatch } from '@/components/ui/swatch'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { EditableNameRow } from '@/components/ui/editable-name-row'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SortControl } from '@/components/ui/sort-control'
import { DEFAULT_SWATCH } from '@/lib/swatch'
import { compareText, type SortOption } from '@/lib/sort'
import { merge, recolour, remove, rename } from './actions'

/**
 * The tag list, with the management that keeps it usable.
 *
 * Merge is the important one. Tags arrive from filenames, sidecars and typing,
 * so a library reliably ends up with "dragon", "Dragon" and "dragons" meaning
 * the same thing — and a tag list nobody can tidy stops being worth filtering
 * by.
 */

export interface TagView {
  id: string
  name: string
  slug: string
  color: string | null
  modelCount: number
}

type TagSort = 'used' | 'name' | 'unused'

const SORT_OPTIONS: SortOption<TagSort>[] = [
  { value: 'used', label: 'Most used' },
  { value: 'name', label: 'Name' },
  // Unused tags are the ones worth tidying, so they get their own order.
  { value: 'unused', label: 'Unused first' },
]

const COMPARE: Record<TagSort, (a: TagView, b: TagView) => number> = {
  used: (a, b) => b.modelCount - a.modelCount || compareText(a.name, b.name),
  name: (a, b) => compareText(a.name, b.name),
  unused: (a, b) => a.modelCount - b.modelCount || compareText(a.name, b.name),
}

export function TagManager({ tags, canEdit }: { tags: TagView[]; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [sort, setSort] = useState<TagSort>('used')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const sorted = useMemo(() => [...tags].sort(COMPARE[sort]), [tags, sort])

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error ?? 'That did not work.')
        return
      }
      setEditing(null)
      setMerging(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <ListToolbar
        className="mb-0"
        sort={
          <SortControl
            options={SORT_OPTIONS}
            value={sort}
            onChange={setSort}
            count={sorted.length}
          />
        }
      />

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--color-border)]">
          {sorted.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              {canEdit ? (
                <input
                  type="color"
                  aria-label={`Colour for ${tag.name}`}
                  value={tag.color ?? DEFAULT_SWATCH}
                  onChange={(e) => run(() => recolour(tag.id, e.target.value))}
                  className="size-6 shrink-0 cursor-pointer rounded-full border border-[var(--color-border)] bg-transparent p-0"
                />
              ) : (
                <Swatch color={tag.color} />
              )}

              {editing === tag.id ? (
                <EditableNameRow
                  initial={tag.name}
                  label={`Name of ${tag.name}`}
                  pending={pending}
                  onSave={(name) => run(() => rename(tag.id, name))}
                  onCancel={() => setEditing(null)}
                  className="max-w-56"
                />
              ) : (
                <>
                  <Link
                    href={`/tags/${tag.slug}` as Route}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {tag.name}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
                    {tag.modelCount}
                  </span>

                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rename ${tag.name}`}
                        onClick={() => {
                          setEditing(tag.id)
                          setMerging(null)
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Merge ${tag.name} into another tag`}
                        onClick={() => {
                          setMerging(merging === tag.id ? null : tag.id)
                          setTarget('')
                        }}
                      >
                        <Combine />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${tag.name}`}
                        className="hover:text-[var(--color-danger)]"
                        onClick={() => {
                          if (
                            confirm(
                              `Remove "${tag.name}" from ${tag.modelCount} model${
                                tag.modelCount === 1 ? '' : 's'
                              }? The models themselves are untouched.`,
                            )
                          ) {
                            run(() => remove(tag.id))
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </>
              )}

              {merging === tag.id && (
                <div className="flex w-full items-center gap-2 pt-1">
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                    Move everything to
                  </span>
                  <Select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="h-8 max-w-56"
                  >
                    <option value="">Choose a tag…</option>
                    {tags
                      .filter((other) => other.id !== tag.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={pending || !target}
                    onClick={() => run(() => merge(tag.id, target))}
                  >
                    Merge
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMerging(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
