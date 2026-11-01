import type { Route } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

/**
 * The filter row of the audit trail and the logs: a couple of selects, a
 * search box, Filter and Clear. A plain GET form, so a filtered view is a URL
 * that can be bookmarked or pasted into a bug report.
 */
export function FilterBar({
  selects,
  search,
  keep = {},
  clearHref,
}: {
  selects: {
    name: string
    label: string
    value: string
    options: readonly { value: string; label: string }[]
  }[]
  search: { label: string; placeholder: string; value: string }
  /** Params the form would otherwise drop, such as the sort. */
  keep?: Record<string, string>
  /** Where Clear goes; no Clear button when nothing is filtered. */
  clearHref?: string
}) {
  return (
    <form method="get" className="flex w-full flex-wrap items-end gap-2">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {selects.map((select) => (
        <div key={select.name} className="w-44">
          <Select name={select.name} defaultValue={select.value} aria-label={select.label}>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <div className="min-w-48 flex-1">
        <Input
          name="q"
          type="search"
          defaultValue={search.value}
          placeholder={search.placeholder}
          aria-label={search.label}
        />
      </div>
      <Button type="submit" variant="secondary">
        Filter
      </Button>
      {clearHref && (
        <Button asChild variant="ghost">
          <Link href={clearHref as Route}>Clear</Link>
        </Button>
      )}
    </form>
  )
}

/**
 * The way back and forth through a long history: back towards the start on
 * the left, onwards on the right, the same buttons on every Diagnostics page.
 */
export function Pager({
  previous,
  next,
  status,
}: {
  previous?: { href: string; label: string }
  next?: { href: string; label: string }
  status?: string
}) {
  if (!previous && !next) return null
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pages">
      {previous ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={previous.href as Route}>{previous.label}</Link>
        </Button>
      ) : (
        <span />
      )}
      {status && <span className="text-[var(--color-ink-muted)]">{status}</span>}
      {next ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={next.href as Route}>{next.label}</Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  )
}
