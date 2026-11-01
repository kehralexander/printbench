import * as React from 'react'

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  title: string
  description?: React.ReactNode
  /** A small label above the title, e.g. "Shared with you". */
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  /** A secondary line under the description — a finish time, a call-out link. */
  children?: React.ReactNode
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      {/* flex-1 with a basis: a long description wraps beside the actions
          instead of pushing them onto a line of their own. */}
      <div className="min-w-0 flex-1 basis-72">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>}
        {children && <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{children}</div>}
      </div>
      {/*
        The action row wraps rather than holding one line: on a phone a model
        page can carry seven buttons, and shrink-0 would push them off the
        right edge instead of letting them fall onto a second row.
      */}
      {actions && (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}
