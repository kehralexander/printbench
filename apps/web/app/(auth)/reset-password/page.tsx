import { validatePasswordReset } from '@pb/auth'
import { getDb } from '@pb/db'
import { AuthHeader } from '@/components/auth/auth-header'
import { BackToSignIn } from '@/components/auth/back-to-sign-in'
import { ResetPasswordForm } from './reset-form'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Reset password',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  let valid = false
  if (typeof token === 'string') {
    try {
      await validatePasswordReset(getDb(), token)
      valid = true
    } catch {
      /* Invalid and expired tokens reveal no account details. */
    }
  }
  return (
    <>
      {valid && token ? (
        <>
          <AuthHeader
            title="Reset your password"
            description="Choose a new password for your PrintBench account."
          />
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <>
          <AuthHeader
            title="This link cannot be used"
            description="This reset link is invalid or has expired. Ask an admin for a new link."
          />
          <BackToSignIn />
        </>
      )}
    </>
  )
}
