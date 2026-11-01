import { describe, expect, it } from 'vitest'
import { groupMappingFromEnv, groupsFromClaims, mapsRoles, ssoVerdict } from './oidc-provisioning'

const mapping = groupMappingFromEnv({
  OIDC_ADMIN_GROUPS: 'PrintBench Admins',
  OIDC_MEMBER_GROUPS: 'makers, family',
  OIDC_ALLOWED_GROUPS: 'guests',
})

describe('SSO groups to roles', () => {
  it('reads the groups however the provider spells them', () => {
    expect(groupsFromClaims({ groups: ['Makers', 'other'] }, 'groups')).toEqual(['makers', 'other'])
    expect(groupsFromClaims({ roles: 'makers,guests' }, 'roles')).toEqual(['makers', 'guests'])
    expect(groupsFromClaims({ groups: ['/home/family'] }, 'groups')).toEqual([
      '/home/family',
      'family',
    ])
    expect(groupsFromClaims({}, 'groups')).toEqual([])
  })

  it('gives the highest role any group grants', () => {
    expect(ssoVerdict(['printbench admins', 'makers'], mapping)).toEqual({
      allowed: true,
      role: 'admin',
    })
    expect(ssoVerdict(['family'], mapping)).toEqual({ allowed: true, role: 'member' })
    expect(ssoVerdict(['guests'], mapping)).toEqual({ allowed: true, role: 'viewer' })
  })

  it('refuses anyone in none of the allowed groups', () => {
    expect(ssoVerdict(['strangers'], mapping)).toEqual({ allowed: false })
    expect(ssoVerdict([], mapping)).toEqual({ allowed: false })
  })

  it('lets everyone in as a viewer, and leaves roles alone, without any mapping', () => {
    const none = groupMappingFromEnv({})
    expect(mapsRoles(none)).toBe(false)
    expect(mapsRoles(mapping)).toBe(true)
    expect(ssoVerdict([], none)).toEqual({ allowed: true, role: 'viewer' })
  })
})
