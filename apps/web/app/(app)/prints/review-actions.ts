'use server'

import { revalidatePath } from 'next/cache'
import { PolicyError, ReviewError, assertCan, dismissReview, reviewPrint } from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

async function reviewer() {
  const user = await requireUser()
  assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'print:log')
  return user
}

function revalidate() {
  revalidatePath('/')
  revalidatePath('/prints')
}

/** Stars, an optional line, and "it failed after all", for a print the printer logged. */
export async function ratePrint(
  printId: string,
  review: { rating: number; note?: string | null; failed?: boolean },
): Promise<Result> {
  try {
    const user = await reviewer()
    await reviewPrint(getDb(), printId, review)
    await audit(
      user,
      'print.rated',
      { type: 'print', id: printId },
      {
        rating: review.rating,
        ...(review.failed && { failed: true }),
      },
    )
    revalidate()
    return { ok: true }
  } catch (error) {
    if (error instanceof ReviewError) return { ok: false, error: error.message }
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    console.error('[review]', error)
    return { ok: false, error: 'Could not save that.' }
  }
}

/** Not worth rating: stop asking about this one. */
export async function skipReview(printId: string): Promise<Result> {
  try {
    await reviewer()
    await dismissReview(getDb(), printId)
    revalidate()
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not dismiss that.' }
  }
}
