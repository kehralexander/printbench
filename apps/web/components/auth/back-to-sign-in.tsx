import Link from 'next/link'

/** The way out of every auth side page, styled the same everywhere. */
export function BackToSignIn() {
  return (
    <Link href="/login" className="inline-block text-sm text-[var(--color-accent)] hover:underline">
      Back to sign in
    </Link>
  )
}
