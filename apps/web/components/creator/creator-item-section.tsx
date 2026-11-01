'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { SearchHit } from '@pb/core'
import { ModelGrid } from '@/components/model/model-grid'
import { Button } from '@/components/ui/button'
import type { ItemSort } from '@/components/model/item-sort'

interface CreatorItemSectionProps {
  creatorId: string
  type: 'model' | 'package'
  title: string
  sort: ItemSort
  initialItems: SearchHit[]
  total: number
  batchSize: number
  className?: string
}

export function CreatorItemSection({
  creatorId,
  type,
  title,
  sort,
  initialItems,
  total,
  batchSize,
  className,
}: CreatorItemSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const [items, setItems] = useState(initialItems)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasMore = items.length < total

  async function showMore() {
    if (loading || !hasMore) return

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        type,
        sort,
        offset: String(items.length),
        limit: String(batchSize),
      })

      const response = await fetch(
        `/api/creators/${encodeURIComponent(creatorId)}/items?${params.toString()}`,
      )

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const data = (await response.json()) as {
        hits: SearchHit[]
        total: number
      }

      setItems((current) => {
        const existingIds = new Set(current.map((item) => item.id))
        const additional = data.hits.filter((item) => !existingIds.has(item.id))
        return [...current, ...additional]
      })
    } catch {
      setError('Could not load more items. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={className}>
      <h2 className="mb-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="-ml-3 font-semibold text-[var(--color-ink)]"
        >
          {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          {title}
          <span className="font-normal text-[var(--color-ink-muted)]">
            {total.toLocaleString()}
          </span>
        </Button>
      </h2>

      {expanded && (
        <>
          <ModelGrid models={items} />

          {hasMore && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--color-ink-muted)]">
                Showing {items.length.toLocaleString()} of {total.toLocaleString()}.
              </span>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={showMore}
              >
                {loading ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
