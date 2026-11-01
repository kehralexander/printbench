'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Route } from 'next'
import { Check, FolderTree, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EditableNameRow } from '@/components/ui/editable-name-row'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SortControl } from '@/components/ui/sort-control'
import { compareDesc, compareText, type SortOption } from '@/lib/sort'
import { create, remove, rename } from './actions'

/**
 * Collections, shown as a tree.
 *
 * Nesting exists because a Kickstarter pledge is genuinely a collection of
 * collections — "Wave 2" inside "Dragon Kickstarter" — and flattening that
 * loses the only structure the creator gave you.
 */

export interface CollectionView {
  id: string
  name: string
  slug: string
  caption: string | null
  parentId: string | null
  modelCount: number
  previewFileId: string | null
  createdAt: Date
}

type CollectionSort = 'name' | 'models' | 'recent'

const SORT_OPTIONS: SortOption<CollectionSort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'models', label: 'Most models' },
  { value: 'recent', label: 'Newest' },
]

// Applied within each level of the tree: a child never sorts out from under its parent.
const COMPARE: Record<CollectionSort, (a: CollectionView, b: CollectionView) => number> = {
  name: (a, b) => compareText(a.name, b.name),
  models: (a, b) => b.modelCount - a.modelCount || compareText(a.name, b.name),
  recent: (a, b) => compareDesc(a.createdAt, b.createdAt) || compareText(a.name, b.name),
}

export function CollectionList({
  title,
  description,
  collections,
  canEdit,
}: {
  /** The page header is rendered here so "New collection" can sit in its actions. */
  title: string
  description: string
  collections: CollectionView[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [sort, setSort] = useState<CollectionSort>('name')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Children keyed by parent, so the tree can be walked without re-scanning.
  const byParent = useMemo(() => {
    const map = new Map<string | null, CollectionView[]>()
    for (const collection of collections) {
      const siblings = map.get(collection.parentId) ?? []
      siblings.push(collection)
      map.set(collection.parentId, siblings)
    }
    for (const siblings of map.values()) siblings.sort(COMPARE[sort])
    return map
  }, [collections, sort])

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error ?? 'That did not work.')
        return
      }
      setAdding(false)
      setEditing(null)
      setDraftName('')
      router.refresh()
    })
  }

  function renderTree(parent: string | null, depth: number): React.ReactNode {
    const children = byParent.get(parent) ?? []
    if (children.length === 0) return null

    return children.map((collection) => {
      // Computed once: calling renderTree in both the test and the body walks
      // the whole subtree twice at every level.
      const nested = renderTree(collection.id, depth + 1)

      return (
        <li key={collection.id}>
          <div
            className="flex items-center gap-3 px-4 py-2.5"
            style={{ paddingLeft: `${16 + depth * 20}px` }}
          >
            {collection.previewFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${collection.previewFileId}/thumb`}
                alt=""
                className="size-8 shrink-0 rounded bg-[var(--color-surface-2)] object-cover"
              />
            ) : (
              <FolderTree className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
            )}

            {editing === collection.id ? (
              <EditableNameRow
                initial={collection.name}
                label={`Name of ${collection.name}`}
                pending={pending}
                onSave={(name) => run(() => rename(collection.id, name))}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/collections/${collection.slug}` as Route}
                    // block: truncate needs a block box to clip and ellipsise —
                    // left inline, a long name simply ran under the count and
                    // off the edge of the card.
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {collection.name}
                  </Link>
                  {collection.caption && (
                    <p className="truncate text-xs text-[var(--color-ink-faint)]">
                      {collection.caption}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
                  {collection.modelCount}
                </span>

                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Add a collection inside ${collection.name}`}
                      onClick={() => {
                        setAdding(true)
                        setParentId(collection.id)
                        setDraftName('')
                      }}
                    >
                      <Plus />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Rename ${collection.name}`}
                      onClick={() => {
                        setEditing(collection.id)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${collection.name}`}
                      className="hover:text-[var(--color-danger)]"
                      onClick={() => {
                        if (
                          confirm(
                            `Remove "${collection.name}"? The models stay where they are, and anything nested inside moves up a level.`,
                          )
                        ) {
                          run(() => remove(collection.id))
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {nested && (
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {nested}
            </ul>
          )}
        </li>
      )
    })
  }

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          canEdit &&
          !adding && (
            <Button
              onClick={() => {
                setAdding(true)
                setParentId(null)
                setDraftName('')
              }}
            >
              <Plus />
              New collection
            </Button>
          )
        }
      />
      <div className="space-y-4">
        {adding && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 p-3">
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') run(() => create({ name: draftName, parentId }))
                  if (e.key === 'Escape') setAdding(false)
                }}
                placeholder={parentId ? 'Name of the nested collection' : 'Name of the collection'}
                className="h-9 max-w-72"
              />
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => create({ name: draftName, parentId }))}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Check />}
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              {parentId && (
                <span className="text-xs text-[var(--color-ink-faint)]">
                  inside {collections.find((c) => c.id === parentId)?.name}
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Directly above the list it orders, below the "new" form. */}
        <ListToolbar
          className="mb-0"
          sort={
            <SortControl
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
              count={collections.length}
            />
          }
        />

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        {collections.length === 0 ? (
          !adding && (
            <EmptyState
              icon={<FolderTree />}
              title="No collections yet"
              description="Create one, then add models to it from their pages."
            />
          )
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-[var(--color-border)]">{renderTree(null, 0)}</ul>
          </Card>
        )}
      </div>
    </>
  )
}
