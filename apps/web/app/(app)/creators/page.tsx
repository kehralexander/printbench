import Link from 'next/link'
import type { Route } from 'next'
import { Users } from 'lucide-react'
import { can, listCreators, type CreatorSort } from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SectionHeader } from '@/components/ui/section-header'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Creators' }

const SORT_OPTIONS: SortOption<CreatorSort>[] = [
  { value: 'items', label: 'Most models' },
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Recently added' },
]

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="creators" />
  }

  const sort = pickSort((await searchParams).sort, SORT_OPTIONS, 'items')
  const creators = await listCreators(getDb(), { sort })
  const withItems = creators.filter((creator) => creator.modelCount > 0 || creator.packageCount > 0)
  const empty = creators.filter((creator) => creator.modelCount === 0 && creator.packageCount === 0)

  return (
    <>
      <PageHeader
        title="Creators"
        description={
          creators.length === 0
            ? 'Whoever made your models appears here once you record them.'
            : `${withItems.length} creator${withItems.length === 1 ? '' : 's'} with items in your library`
        }
      />

      {creators.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No creators recorded yet"
          description="Open a model, press Edit, and name whoever made it. They will appear here with everything of theirs you own."
          action={
            <Button asChild variant="secondary">
              <Link href="/models">Browse models</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={SORT_OPTIONS}
                value={sort}
                defaultValue="items"
                count={withItems.length}
              />
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {withItems.map((creator) => (
              <Link
                key={creator.id}
                href={`/creators/${creator.slug}` as Route}
                // min-w-0: the name below truncates, but without this the card
                // is a grid item sized to its min-content and a long studio
                // name pushes the whole grid past the viewport.
                className="group block min-w-0"
              >
                <Card className="flex items-center gap-3 p-4 transition-shadow group-hover:shadow-[var(--shadow-card)]">
                  {creator.previewFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/files/${creator.previewFileId}/thumb`}
                      alt=""
                      className="size-12 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] object-cover"
                    />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
                      <Users className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium group-hover:text-[var(--color-accent)]">
                      {creator.name}
                    </p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {creator.modelCount.toLocaleString()} model
                      {creator.modelCount === 1 ? '' : 's'} ·{' '}
                      {creator.packageCount.toLocaleString()} package
                      {creator.packageCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {/*
           * Creators with no models or packages attributed to them still
           * exist — an item may have been removed. Worth showing quietly so
           * they can be noticed rather than silently orphaned.
           */}
          {empty.length > 0 && (
            <section className="mt-8">
              <SectionHeader
                title="Without models"
                meta="Everything attributed to them was removed or is missing from disk."
              />
              <div className="flex flex-wrap gap-1.5">
                {empty.map((creator) => (
                  <Link key={creator.id} href={`/creators/${creator.slug}` as Route}>
                    <Badge>{creator.name}</Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}
