'use server'

import { revalidatePath } from 'next/cache'
import { BillingError, getSettings, respondToQuote } from '@pb/core'
import { getDb } from '@pb/db'

type Result = { ok: true } | { ok: false; error: string }

/**
 * The requester's answer to a quote. No sign-in: whoever holds the status
 * link is the person it was sent to, the same as for reading the page. The
 * core checks the quote can still be answered — not expired, not waiting for
 * a new price, not cancelled — in the same statement that records the answer.
 */
export async function answerQuote(token: string, answer: 'accept' | 'decline'): Promise<Result> {
  if (answer !== 'accept' && answer !== 'decline') return { ok: false, error: 'Unknown answer.' }
  // With pricing switched off the page shows no price, so there is nothing to answer.
  if (!(await getSettings(getDb())).pricing.enabled) {
    return { ok: false, error: 'This quote can no longer be answered.' }
  }
  try {
    await respondToQuote(getDb(), token, answer)
  } catch (error) {
    if (error instanceof BillingError) return { ok: false, error: error.message }
    throw error
  }
  revalidatePath(`/r/${token}`)
  return { ok: true }
}
