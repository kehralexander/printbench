'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { reorderQueue } from './actions'
import { flattenGroups, groupRows, type RowGroup } from './grouping'
import { RequestGroup } from './request-group'
import { RequestRow, type QueueRow, type RowContext, type RowDrag } from './request-row'

type Dragging = { kind: 'group'; key: string } | { kind: 'part'; id: string; group: string }

/**
 * The queue's rows, grouped by model or one by one, in an order that can be
 * changed by dragging (or with the arrow keys on a handle). A group moves as a
 * whole, and its parts move within it. The new order is saved as soon as
 * something is dropped and decides what the printer tracker picks next, too —
 * a group's parts are saved next to each other, in the order shown.
 */
export function QueueList({
  rows,
  context,
  sortable,
  grouped,
  onPrinterCard: printingIds,
  showRequester,
}: {
  rows: QueueRow[]
  context: RowContext
  /** Only the open queue, and only for whoever works it. */
  sortable: boolean
  /** Requests for the same model and person as one card. */
  grouped: boolean
  /** Requests with a card of their own at the top: left out, or shown slim in their group. */
  onPrinterCard: string[]
  showRequester: boolean
}) {
  const router = useRouter()
  const onPrinterCard = new Set(printingIds)
  const ids = rows.map((row) => row.id)
  const key = ids.join()
  const [order, setOrder] = useState(ids)
  const [seen, setSeen] = useState(key)
  // A refresh brought a different queue: start from it.
  if (seen !== key) {
    setSeen(key)
    setOrder(ids)
  }
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const byId = new Map(rows.map((row) => [row.id, row]))

  const groups = groupRows(
    order.map((id) => byId.get(id)).filter((row): row is QueueRow => row != null),
    grouped,
  )

  function save(next: string[]) {
    if (next.join() === key) return
    setError(null)
    startTransition(async () => {
      const result = await reorderQueue(next)
      if (!result.ok) {
        setError(result.error)
        setOrder(ids)
        return
      }
      router.refresh()
    })
  }

  function moved<T>(list: T[], from: number, to: number): T[] {
    if (from < 0 || to < 0 || to >= list.length || from === to) return list
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    return next
  }

  function moveGroup(groupKey: string, to: number): string[] {
    const from = groups.findIndex((group) => group.key === groupKey)
    return flattenGroups(moved(groups, from, to))
  }

  function movePart(groupKey: string, id: string, to: number): string[] {
    return flattenGroups(
      groups.map((group) => {
        if (group.key !== groupKey) return group
        const from = group.rows.findIndex((row) => row.id === id)
        return { ...group, rows: moved(group.rows, from, to) }
      }),
    )
  }

  function groupDrag(group: RowGroup<QueueRow>, index: number): RowDrag | undefined {
    if (!sortable || groups.length < 2) return undefined
    return {
      dragging: dragging?.kind === 'group' && dragging.key === group.key,
      disabled: pending,
      onDragStart: () => setDragging({ kind: 'group', key: group.key }),
      onDragEnter: () => {
        if (dragging?.kind === 'group' && dragging.key !== group.key) {
          setOrder(moveGroup(dragging.key, index))
        }
      },
      onDragEnd: () => {
        setDragging(null)
        save(order)
      },
      onMove: (delta) => {
        const next = moveGroup(group.key, index + delta)
        setOrder(next)
        save(next)
      },
    }
  }

  function partDrag(group: RowGroup<QueueRow>) {
    return (id: string): RowDrag | undefined => {
      if (!sortable || group.rows.length < 2) return undefined
      const index = group.rows.findIndex((row) => row.id === id)
      return {
        dragging: dragging?.kind === 'part' && dragging.id === id,
        disabled: pending,
        onDragStart: () => setDragging({ kind: 'part', id, group: group.key }),
        onDragEnter: () => {
          if (dragging?.kind === 'part' && dragging.group === group.key && dragging.id !== id) {
            setOrder(movePart(group.key, dragging.id, index))
          }
        },
        onDragEnd: () => {
          setDragging(null)
          save(order)
        },
        onMove: (delta) => {
          const next = movePart(group.key, id, index + delta)
          setOrder(next)
          save(next)
        },
      }
    }
  }

  /*
   * A group of one is just a row. Runs of them share a card, so a queue of
   * unrelated requests still reads as one list rather than a stack of cards.
   * One with a printing card of its own is left out here entirely.
   */
  const blocks: (
    | { kind: 'rows'; items: { group: RowGroup<QueueRow>; index: number }[] }
    | {
        kind: 'group'
        group: RowGroup<QueueRow>
        index: number
      }
  )[] = []
  groups.forEach((group, index) => {
    if (group.rows.length > 1) {
      blocks.push({ kind: 'group', group, index })
      return
    }
    if (onPrinterCard.has(group.rows[0]!.id)) return
    const last = blocks.at(-1)
    if (last?.kind === 'rows') last.items.push({ group, index })
    else blocks.push({ kind: 'rows', items: [{ group, index }] })
  })

  return (
    <>
      {error && <p className="mb-2 text-sm text-[var(--color-danger)]">{error}</p>}
      <div className="space-y-3">
        {blocks.map((block) =>
          block.kind === 'group' ? (
            <RequestGroup
              key={block.group.key}
              group={block.group}
              context={context}
              onPrinterCard={onPrinterCard}
              showRequester={showRequester}
              drag={groupDrag(block.group, block.index)}
              partDrag={partDrag(block.group)}
            />
          ) : (
            <Card key={block.items[0]!.group.key} className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-border)]">
                {block.items.map(({ group, index }) => (
                  <RequestRow
                    key={group.key}
                    request={group.rows[0]!}
                    context={context}
                    showRequester={showRequester}
                    drag={groupDrag(group, index)}
                  />
                ))}
              </ul>
            </Card>
          ),
        )}
      </div>
    </>
  )
}
