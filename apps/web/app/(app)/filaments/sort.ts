import type { SortOption } from '@/lib/sort'

/** Orders for the built-in filament library, sorted in the browser. */
export type LibrarySort = 'name' | 'most' | 'least' | 'material' | 'recent'

export const LIBRARY_SORTS: readonly SortOption<LibrarySort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'most', label: 'Remaining (most)' },
  { value: 'least', label: 'Remaining (least)' },
  { value: 'material', label: 'Material' },
  { value: 'recent', label: 'Recently added' },
]

/** Orders for the Spoolman inventory, kept in `?sort=`. */
export type SpoolmanSort = 'name' | 'most' | 'least'

export const SPOOLMAN_SORTS: readonly SortOption<SpoolmanSort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'most', label: 'Most remaining' },
  { value: 'least', label: 'Least remaining' },
]
