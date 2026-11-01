'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resetQueueOrder } from './actions'

/** Drops the dragged order, so priority, due date and age decide again. */
export function ResetOrder() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Forget the dragged order: urgency, due date and age decide again"
      onClick={() =>
        startTransition(async () => {
          await resetQueueOrder()
          router.refresh()
        })
      }
    >
      <RotateCcw />
      Reset order
    </Button>
  )
}
