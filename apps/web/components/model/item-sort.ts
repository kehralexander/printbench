import type { SortOrder } from '@pb/core'
import type { SortOption } from '@/lib/sort'

/**
 * Orders for the items of one creator or tag. A plain module rather than part
 * of a client component, so the server pages, the creator's client sections and
 * its "Show more" route all share one list.
 */
export type ItemSort = Extract<SortOrder, 'name' | 'recent' | 'largest'>

export const ITEM_SORT_OPTIONS: SortOption<ItemSort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Newest' },
  { value: 'largest', label: 'Largest' },
]

export const DEFAULT_ITEM_SORT: ItemSort = 'name'
