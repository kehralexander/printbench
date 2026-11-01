import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionUser, OIDC_PROVIDER_ID, SSO_NOT_ALLOWED, ssoProviderName } from '@pb/auth'
import { getSetting } from '@pb/core'
import { getDb } from '@pb/db'
import { needsFirstRunSetup } from '@/lib/setup'
import { AuthHeader } from '@/components/auth/auth-header'
import { LoginForm } from './login-form'
import { SsoButton } from './sso-button'

export const dynamic = 'force-dynamic'

/** Error codes better-auth appends when an SSO callback is refused. */
function ssoErrorMessage(code: string | undefined, provider: string): string | null {
  if (!code) return null
  if (code === 'signup_disabled') {
    return `Your ${provider} account has no PrintBench account yet. Ask an admin to invite you.`
  }
  if (code === SSO_NOT_ALLOWED) {
    return `Your ${provider} account is not in a group allowed to use PrintBench. Ask an admin to add you.`
  }
  return `Signing in with ${provider} did not work (${code}).`
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; password?: string }>
}) {
  // A brand-new instance has no account to sign in to; send them to setup.
  if (await needsFirstRunSetup()) redirect('/setup')
  if (await getSessionUser()) redirect('/')

  const params = await searchParams
  const sso = ssoProviderName()
  const ssoError = sso ? ssoErrorMessage(params.error, sso) : null
  // ?password=1 keeps the form reachable, so a broken identity provider cannot lock admins out.
  const passwordHidden =
    Boolean(sso) && (await getSetting(getDb(), 'hidePasswordLogin')) && params.password !== '1'

  return (
    <>
      <AuthHeader title="Welcome back" description="Sign in to browse your print library." />
      {sso && (
        <div className={passwordHidden ? 'space-y-2' : 'mb-6 space-y-2'}>
          <SsoButton providerId={OIDC_PROVIDER_ID} name={sso} />
          {ssoError && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {ssoError}
            </p>
          )}
        </div>
      )}
      {!passwordHidden && (
        <>
          <LoginForm />
          <p className="mt-4 text-sm">
            <Link href="/forgot-password" className="text-[var(--color-accent)] hover:underline">
              Forgot password?
            </Link>
          </p>
        </>
      )}
      <p className="mt-6 text-xs text-[var(--color-ink-faint)]">
        No account? Ask an admin to invite you.
      </p>
      {passwordHidden && (
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
          Admins can still{' '}
          <Link href="/login?password=1" className="hover:underline">
            sign in with a password
          </Link>
          .
        </p>
      )}
    </>
  )
}
