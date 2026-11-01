import { AuthHeader } from '@/components/auth/auth-header'
import { BackToSignIn } from '@/components/auth/back-to-sign-in'

export const metadata = { title: 'Forgot password' }

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeader
        title="Forgot your password?"
        description="Ask a PrintBench admin for a password reset link. They can create one in Users. You choose your new password yourself; the admin never needs to know it."
      />
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-ink-muted)]">
          If you are the only admin and cannot sign in, the server owner can create a reset link
          using PrintBench’s recovery command. No email delivery is required.
        </p>
        <BackToSignIn />
      </div>
    </>
  )
}
