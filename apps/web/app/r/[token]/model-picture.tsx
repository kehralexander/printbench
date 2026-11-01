'use client'

import { useEffect } from 'react'
import { Box } from 'lucide-react'
import { useProjection } from '@/components/printer/live-progress'

export interface PictureLive {
  progress: number
  remainingSec: number | null
  ageSec: number
  ticking: boolean
}

/**
 * The model's picture, and while it prints, the picture printing: a faded copy
 * underneath and the full one revealed from the bottom up as far as the print
 * has got, ticking with the progress bar below it. The tab's title carries the
 * percentage too, for a page left open in the background.
 *
 * Without a thumbnail the placeholder fills up the same way.
 */
export function ModelPicture({
  src,
  title,
  live,
}: {
  src: string | null
  title: string
  live: PictureLive | null
}) {
  const projected = useProjection(
    {
      progress: live?.progress ?? null,
      remainingSec: live?.remainingSec ?? null,
      elapsedSec: null,
    },
    live?.ageSec ?? 0,
    live?.ticking ?? false,
  )
  const progress = live ? projected.progress : null
  const percent = progress == null ? null : Math.floor(progress * 100)

  useEffect(() => {
    if (percent == null) return
    const previous = document.title
    const wanted = `${percent}% · ${title}`
    const apply = () => {
      if (document.title !== wanted) document.title = wanted
    }
    apply()
    // Next streams the page's metadata in after hydration and on every
    // refresh, putting its own title back; take it over again each time.
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      document.title = previous
    }
  }, [percent, title])

  // Hidden above the line that has been printed so far.
  const reveal = progress == null ? undefined : `inset(${(1 - progress) * 100}% 0 0 0)`
  const glide = 'transition-[clip-path] duration-1000 ease-linear motion-reduce:transition-none'

  return (
    <div className="relative mb-6 size-40 overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface-2)]">
      {src ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className={
              reveal
                ? 'absolute inset-0 size-full object-cover opacity-30 grayscale'
                : 'absolute inset-0 size-full object-cover'
            }
          />
          {reveal && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              className={`absolute inset-0 size-full object-cover ${glide}`}
              style={{ clipPath: reveal }}
            />
          )}
        </>
      ) : (
        <>
          {reveal && (
            <span
              className={`absolute inset-0 bg-[var(--color-accent-soft)] ${glide}`}
              style={{ clipPath: reveal }}
            />
          )}
          <Box className="absolute inset-0 m-auto size-10 text-[var(--color-ink-faint)]" />
        </>
      )}
      {percent != null && (
        <span className="absolute right-2 bottom-2 rounded-full bg-[var(--color-surface)]/85 px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm">
          {percent}%
        </span>
      )}
    </div>
  )
}
