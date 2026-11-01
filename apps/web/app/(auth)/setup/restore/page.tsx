import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArchiveRestore } from 'lucide-react'
import { needsFirstRunSetup } from '@/lib/setup'
import { AuthHeader } from '@/components/auth/auth-header'
import { RestorePanel } from '@/components/backup/restore-panel'
import { createFirstRunRestoreTicket } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Restore from a backup' }

export default async function SetupRestorePage() {
  // Closes with the rest of setup: on an instance that already has accounts,
  // restoring is an admin's job, from Manage → Backup.
  if (!(await needsFirstRunSetup())) redirect('/login')

  return (
    <>
      <AuthHeader
        eyebrow="First run"
        icon={<ArchiveRestore />}
        title="Restore from a backup"
        description="Bring across everything from another PrintBench: accounts, libraries, tags, print history and settings. You then sign in with an account from that instance."
      />

      <RestorePanel
        getTicket={createFirstRunRestoreTicket}
        firstRun
        footer={
          <p className="pt-3 text-sm text-[var(--color-ink-muted)]">
            Starting fresh instead?{' '}
            <Link href="/setup" className="font-medium text-[var(--color-accent)] hover:underline">
              Create an admin account
            </Link>
          </p>
        }
      />
    </>
  )
}
