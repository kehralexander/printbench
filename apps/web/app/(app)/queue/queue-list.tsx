'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FilamentOption } from '@/lib/filament-options'
import { reorderQueue } from './actions'
import { RequestRow, type QueueRow, type RowDrag, type SendTarget } from './request-row'

/**
 * The queue's rows, in an order that can be changed by dragging a row (or
 * with the arrow keys on its handle). The new order is saved as soon as the
 * row is dropped and decides what the printer tracker picks next, too.
 */
export function QueueList({
  rows,
  canRun,
  filaments,
  sendTargets,
  sortable,
}: {
  rows: QueueRow[]
  canRun: boolean
  filaments: FilamentOption[]
  sendTargets: SendTarget[]
  /** Only the open queue, and only for whoever works it. */
  sortable: boolean
}) {
  const router = useRouter()
  const ids = rows.map((row) => row.id)
  const key = ids.join()
  const [order, setOrder] = useState(ids)
  const [seen, setSeen] = useState(key)
  // A refresh brought a different queue: start from it.
  if (seen !== key) {
    setSeen(key)
    setOrder(ids)
  }
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const byId = new Map(rows.map((row) => [row.id, row]))

  function moved(current: string[], id: string, to: number): string[] {
    const from = current.indexOf(id)
    if (from < 0 || to < 0 || to >= current.length || from === to) return current
    const next = [...current]
    next.splice(from, 1)
    next.splice(to, 0, id)
    return next
  }

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

  function dragFor(id: string, index: number): RowDrag | undefined {
    if (!sortable) return undefined
    return {
      dragging: dragging === id,
      disabled: pending,
      onDragStart: () => setDragging(id),
      onDragEnter: () => {
        if (dragging && dragging !== id) setOrder((current) => moved(current, dragging, index))
      },
      onDragEnd: () => {
        setDragging(null)
        save(order)
      },
      onMove: (delta) => {
        const next = moved(order, id, index + delta)
        setOrder(next)
        save(next)
      },
    }
  }

  return (
    <>
      {error && <p className="mb-2 text-sm text-[var(--color-danger)]">{error}</p>}
      <ul className="divide-y divide-[var(--color-border)]">
        {order.map((id, index) => {
          const row = byId.get(id)
          if (!row) return null
          return (
            <RequestRow
              key={id}
              request={row}
              canRun={canRun}
              filaments={filaments}
              sendTargets={sendTargets}
              drag={dragFor(id, index)}
            />
          )
        })}
      </ul>
    </>
  )
}
