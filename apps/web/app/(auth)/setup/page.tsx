import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { needsFirstRunSetup } from '@/lib/setup'
import { AuthHeader } from '@/components/auth/auth-header'
import { SetupForm } from './setup-form'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  // Closes permanently once any account exists — otherwise anyone reaching this
  // URL on a public instance could grant themselves admin.
  if (!(await needsFirstRunSetup())) redirect('/login')

  return (
    <>
      <AuthHeader
        eyebrow="First run"
        icon={<ShieldCheck />}
        title="Create your admin account"
        description="This is the only time this page is available. Once an account exists it closes for good, and further users are added from Settings."
      />
      <SetupForm />

      <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
        Moving from another PrintBench?{' '}
        <Link
          href="/setup/restore"
          className="font-medium text-[var(--color-accent)] hover:underline"
        >
          Restore from a backup
        </Link>
      </p>
    </>
  )
}
