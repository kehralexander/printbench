import * as React from 'react'
import { Badge } from '@/components/ui/badge'

/** The heading block every sign-in, setup and invitation page opens with. */
export function AuthHeader({
  eyebrow,
  icon,
  title,
  description,
}: {
  /** A short pill above the title, e.g. "First run". */
  eyebrow?: React.ReactNode
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
}) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <Badge tone="accent" className="mb-4 [&_svg]:size-3.5">
          {icon}
          {eyebrow}
        </Badge>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>}
    </div>
  )
}
