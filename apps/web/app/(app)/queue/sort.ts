import type { RequestSort } from '@pb/core'
import type { SortOption } from '@/lib/sort'

/**
 * How the queue can be looked at. Manual is the queue's own order — the one
 * dragging changes and the printers follow; the rest only change the view.
 */
export const QUEUE_SORTS: readonly SortOption<RequestSort>[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'due', label: 'Due date' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'requester', label: 'Requester' },
]
