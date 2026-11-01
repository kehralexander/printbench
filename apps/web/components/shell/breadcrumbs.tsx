import Link from 'next/link'
import type { Route } from 'next'
import { ChevronRight } from 'lucide-react'

/**
 * The trail above a page's header: where this page sits and the way back up.
 * The current page is not repeated here — the header's title already says it.
 */
export function Breadcrumbs({ items }: { items: { label: string; href: string }[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex min-w-0 flex-wrap items-center gap-1 text-sm text-[var(--color-ink-muted)]"
    >
      {items.map((item, index) => (
        <span key={item.href} className="flex min-w-0 items-center gap-1">
          {index > 0 && (
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
          )}
          <Link href={item.href as Route} className="truncate hover:text-[var(--color-ink)]">
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}
