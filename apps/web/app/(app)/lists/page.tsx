import Link from 'next/link'
import { Heart } from 'lucide-react'
import { can, listLiked, type LikedSort } from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { ModelGrid } from '@/components/model/model-grid'
import { pickSort, type SortOption } from '@/lib/sort'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liked' }

const SORT_OPTIONS: SortOption<LikedSort>[] = [
  { value: 'liked', label: 'Recently liked' },
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Newest model' },
]

export default async function LikedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user || !can({ id: user.id, role: user.role ?? null }, 'like:toggle')) {
    return <NotPermitted what="liked models" />
  }

  const sort = pickSort((await searchParams).sort, SORT_OPTIONS, 'liked')
  const liked = await listLiked(getDb(), user.id, { sort })

  return (
    <>
      <PageHeader
        title="Liked"
        description={
          liked.length === 0
            ? 'Models you have hearted appear here.'
            : `${liked.length} model${liked.length === 1 ? '' : 's'}`
        }
      />

      {liked.length === 0 ? (
        <EmptyState
          icon={<Heart />}
          title="Nothing liked yet"
          description="Press the heart on any model to keep it here. Only you can see this list."
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
                defaultValue="liked"
                count={liked.length}
              />
            }
          />
          <ModelGrid models={liked} />
        </>
      )}
    </>
  )
}
