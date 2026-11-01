import { cn } from '@/lib/cn'

/**
 * A colour dot: filaments, printer slots, requests and tags all draw theirs
 * with this one.
 *
 * The edge is a mid grey, not the theme's border colour: a border tuned to
 * the background vanishes exactly when the swatch matches it — black filament
 * in dark mode, white in light. Grey stays visible against both. No colour
 * draws an empty dashed ring rather than nothing.
 */
export function Swatch({
  color,
  title,
  label,
  className,
}: {
  color: string | null | undefined
  title?: string
  /** For a swatch that is the only thing saying which colour; otherwise hidden from readers. */
  label?: string
  /** Size, and any spacing; defaults to a small dot. */
  className?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={title}
      className={cn(
        'inline-block size-3 shrink-0 rounded-full',
        !color && 'border border-dashed border-[var(--color-border-strong)]',
        className,
      )}
      style={
        color
          ? { backgroundColor: color, boxShadow: 'inset 0 0 0 1px rgb(140 140 140)' }
          : undefined
      }
    />
  )
}
