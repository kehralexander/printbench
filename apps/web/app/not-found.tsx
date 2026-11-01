import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { PrintBenchLogo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Every unknown address and every `notFound()` lands here — including the
 * public share and request-status links, which have no app shell around them,
 * so this page carries its own logo rather than relying on a layout.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <Link href="/" className="self-center">
        <PrintBenchLogo className="text-xl" />
      </Link>
      <EmptyState
        icon={<SearchX />}
        title="Nothing here"
        description="This link is wrong, has expired or was switched off by whoever shared it."
        action={
          <Button asChild variant="secondary">
            <Link href="/">Go to PrintBench</Link>
          </Button>
        }
      />
    </main>
  )
}
