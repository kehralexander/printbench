import { ROLES, type Role } from './roles'

/**
 * Who an SSO sign-in is, as far as PrintBench is concerned: whether they may
 * come in at all, and with which role.
 *
 * Driven by the identity provider's groups claim, so access is managed where
 * the rest of the household or team is managed, not account by account here:
 *
 *   OIDC_ADMIN_GROUPS    groups whose members are admins
 *   OIDC_MEMBER_GROUPS   groups whose members are members
 *   OIDC_ALLOWED_GROUPS  when set, anyone in none of these (nor the two above)
 *                        is refused; everyone allowed and in neither role
 *                        group is a viewer
 *   OIDC_GROUPS_CLAIM    the claim holding the groups, `groups` by default
 *
 * Lists are comma separated and compared case-insensitively.
 */
export interface GroupMapping {
  claim: string
  admin: string[]
  member: string[]
  /** Empty means everyone the provider lets through is allowed. */
  allowed: string[]
}

export function groupMappingFromEnv(env: NodeJS.ProcessEnv = process.env): GroupMapping {
  return {
    claim: env.OIDC_GROUPS_CLAIM?.trim() || 'groups',
    admin: groupList(env.OIDC_ADMIN_GROUPS),
    member: groupList(env.OIDC_MEMBER_GROUPS),
    allowed: groupList(env.OIDC_ALLOWED_GROUPS),
  }
}

function groupList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean)
}

/** Whether roles come from the provider at all; otherwise they are managed by hand. */
export function mapsRoles(mapping: GroupMapping): boolean {
  return mapping.admin.length > 0 || mapping.member.length > 0
}

/**
 * The groups in a profile, however the provider spells them: a list, or one
 * comma- or space-separated string. Keycloak-style paths (`/printing/admins`)
 * also match on their last segment.
 */
export function groupsFromClaims(claims: Record<string, unknown>, claim: string): string[] {
  const raw = claims[claim]
  const values = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : []
  const groups = new Set<string>()
  for (const value of values) {
    const group = value.trim().toLowerCase()
    if (!group) continue
    groups.add(group)
    const last = group.split('/').filter(Boolean).pop()
    if (last) groups.add(last)
  }
  return [...groups]
}

export type SsoVerdict = { allowed: false } | { allowed: true; role: Role }

export function ssoVerdict(groups: string[], mapping: GroupMapping): SsoVerdict {
  const inAny = (list: string[]) => list.some((group) => groups.includes(group))
  const role: Role = inAny(mapping.admin)
    ? ROLES.admin
    : inAny(mapping.member)
      ? ROLES.member
      : ROLES.viewer
  if (mapping.allowed.length > 0 && role === ROLES.viewer && !inAny(mapping.allowed)) {
    return { allowed: false }
  }
  return { allowed: true, role }
}

/** The error code the login page turns into "you are not in an allowed group". */
export const SSO_NOT_ALLOWED = 'sso_not_allowed'
