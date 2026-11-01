'use client'

import { useOptimistic, useTransition } from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { toggleLiked } from '../../lists/actions'

/**
 * The heart.
 *
 * Optimistic, because a like is a throwaway gesture and waiting a round trip
 * to see it register makes it feel broken. If the server disagrees the state
 * snaps back when the transition settles.
 */
export function LikeButton({ publicId, liked: initial }: { publicId: string; liked: boolean }) {
  const [pending, startTransition] = useTransition()
  const [liked, setLiked] = useOptimistic(initial)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={liked}
      aria-label={liked ? 'Remove from liked' : 'Add to liked'}
      title={liked ? 'Liked' : 'Like'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setLiked(!liked)
          await toggleLiked(publicId)
        })
      }
    >
      <Heart
        className={cn(
          'transition-colors',
          liked && 'fill-[var(--color-danger)] text-[var(--color-danger)]',
        )}
      />
    </Button>
  )
}
