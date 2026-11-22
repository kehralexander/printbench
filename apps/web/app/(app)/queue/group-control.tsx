'use client'

import { Layers } from 'lucide-react'
import { UrlSortControl } from '@/components/ui/sort-control'

export type QueueGrouping = 'model' | 'none'

const OPTIONS = [
  { value: 'model', label: 'By model' },
  { value: 'none', label: 'None' },
] as const

/** Whether the queue shows a model's parts together; kept in the `group` search param. */
export function GroupControl({ value }: { value: QueueGrouping }) {
  return (
    <UrlSortControl
      options={OPTIONS}
      value={value}
      defaultValue="model"
      param="group"
      label="Group"
      icon={Layers}
    />
  )
}
