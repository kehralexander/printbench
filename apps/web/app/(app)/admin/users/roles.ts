import { ROLE_ORDER } from '@pb/core/policy'

/** How each role reads in the UI. */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

/** Roles as offered in a picker: most powerful first. */
export const ROLE_CHOICES = [...ROLE_ORDER].reverse()
