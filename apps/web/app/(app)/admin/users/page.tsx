import { headers } from 'next/headers'
import { asc, desc, sql } from 'drizzle-orm'
import { getSessionUser } from '@pb/auth'
import { can, listPendingInvites } from '@pb/core'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LocalTime } from '@/components/ui/local-time'
import { UrlSortControl } from '@/components/ui/sort-control'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { NotPermitted } from '@/components/shell/not-permitted'
import { pickSort, type SortOption } from '@/lib/sort'
import { RoleSelect } from './role-select'
import { UserActions } from './user-actions'
import { AddPeopleActions, PendingInvites } from './add-people'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Users' }

type UserSort = 'joined' | 'name' | 'email' | 'role'
const SORTS: readonly SortOption<UserSort>[] = [
  { value: 'joined', label: 'Joined' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'role', label: 'Role' },
]

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  /*
   * Enforced server-side; the sidebar hiding this link is only cosmetic.
   * Rendered as a refusal rather than thrown, so an unauthorized visit is a
   * legible screen instead of a 500. The action behind the role selector
   * re-checks independently.
   */
  const admin = await getSessionUser()
  if (!can({ id: admin?.id ?? '', role: admin?.role ?? null }, 'user:manage')) {
    return <NotPermitted what="user management" />
  }

  const sort = pickSort((await searchParams).sort, SORTS, 'joined')
  const db = getDb()

  const order = {
    joined: [desc(schema.user.createdAt)],
    name: [sql`lower(${schema.user.name})`, asc(schema.user.createdAt)],
    email: [sql`lower(${schema.user.email})`],
    // Most powerful first, then by name within a role.
    role: [
      sql`CASE ${schema.user.role} WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END`,
      sql`lower(${schema.user.name})`,
    ],
  }[sort]

  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      banned: schema.user.banned,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(...order)

  const pending = await listPendingInvites(db)

  /*
   * The origin an invitation link should carry, taken from the request rather
   * than from configuration: whoever is reading this page reached it somehow,
   * and that host is the one their colleague will also be able to reach. A
   * configured APP_URL is frequently the container's idea of itself.
   */
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  const origin = forwardedHost
    ? `${protocol}://${forwardedHost}`
    : (process.env.APP_URL ?? 'http://localhost:3000')

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can reach this instance, and what they may do."
        actions={<AddPeopleActions origin={origin} />}
      />

      {pending.length > 0 && (
        <div className="mb-6">
          <PendingInvites
            origin={origin}
            invites={pending.map((entry) => ({
              id: entry.id,
              token: entry.token,
              email: entry.email,
              role: entry.role,
              expiresAt: entry.expiresAt.toISOString(),
              invitedByName: entry.invitedByName,
            }))}
          />
        </div>
      )}

      <ListToolbar
        sort={
          <UrlSortControl options={SORTS} value={sort} defaultValue="joined" count={users.length} />
        }
      />

      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH className="hidden sm:table-cell">Joined</TH>
              <TH>Role</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {users.map((row) => (
              <TR key={row.id}>
                <TD>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.id === admin!.id && <Badge tone="accent">You</Badge>}
                    {row.banned && <Badge tone="danger">Suspended</Badge>}
                  </div>
                  {/* An address has no break opportunity, and a long one would
                    otherwise set the width of the whole table: offer one after
                    the @, and let break-words split a very long half. */}
                  <span className="break-words text-xs text-[var(--color-ink-faint)]">
                    {row.email.split('@')[0]}
                    {row.email.includes('@') && (
                      <>
                        @<wbr />
                        {row.email.split('@').slice(1).join('@')}
                      </>
                    )}
                  </span>
                </TD>
                <TD className="hidden text-[var(--color-ink-muted)] sm:table-cell">
                  <LocalTime value={row.createdAt.toISOString()} />
                </TD>
                <TD>
                  <RoleSelect
                    userId={row.id}
                    role={row.role}
                    // Removing your own admin rights can lock everyone out of
                    // the instance, so the control is disabled for yourself.
                    disabled={row.id === admin!.id}
                  />
                </TD>
                <TD className="text-right">
                  {/*
                    Nothing offered for your own account: suspending or
                    deleting yourself is a lockout with no way back through
                    the UI, and the server refuses both regardless. Your own
                    password is changed from Settings.
                  */}
                  {row.id !== admin!.id && (
                    <UserActions
                      userId={row.id}
                      name={row.name}
                      email={row.email}
                      suspended={row.banned}
                    />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
        Viewers browse and download. Members also add and edit models, tags and print history.
        Admins additionally manage libraries, users and settings.
      </p>
    </>
  )
}
