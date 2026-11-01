import { UserPlus } from 'lucide-react'
import { inviteByToken } from '@pb/core'
import { getDb } from '@pb/db'
import { AuthHeader } from '@/components/auth/auth-header'
import { BackToSignIn } from '@/components/auth/back-to-sign-in'
import { InviteForm } from './invite-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Accept invitation' }

const ROLE_BLURB: Record<string, string> = {
  admin: 'You will be an admin: everything below, plus libraries, users and settings.',
  member: 'You will be a member: browse and download, and add or edit models, tags and prints.',
  viewer: 'You will be a viewer: browse, search and download everything in the library.',
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invitation = await inviteByToken(getDb(), token)

  /*
   * One refusal for every reason — unknown, revoked, spent, expired. Telling
   * someone which would confirm to anyone guessing tokens that they had found
   * a real one.
   */
  if (!invitation) {
    return (
      <>
        <AuthHeader
          // The same badge as a working invitation: the title says what changed.
          eyebrow="Invitation"
          icon={<UserPlus />}
          title="This link cannot be used"
          description="It may have expired, been used already, or been cancelled. Ask whoever invited you for a fresh one."
        />
        <BackToSignIn />
      </>
    )
  }

  return (
    <>
      <AuthHeader
        eyebrow="Invitation"
        icon={<UserPlus />}
        title="Set up your account"
        description={ROLE_BLURB[invitation.role] ?? 'Choose a password and you are in.'}
      />
      <InviteForm token={token} email={invitation.email} />
    </>
  )
}
