/**
 * Carries a printer reading forward in time, so a page refreshed every few
 * seconds still moves in between: elapsed counts up, remaining counts down,
 * and progress closes the remaining gap at the pace the estimate implies.
 *
 * Only ever an estimate of the next real reading. It stops after
 * MAX_DRIFT_SEC — a reading that old is stale, not something to keep
 * extrapolating — and never shows a running print as finished; only the
 * printer gets to say that.
 */

/** As long as the server keeps calling a printer status live. */
export const MAX_DRIFT_SEC = 120

/** The highest a projection goes; 100% is left to the printer to report. */
const PROJECTED_CEILING = 0.999

export interface Reading {
  /** 0..1 */
  progress: number | null
  elapsedSec: number | null
  remainingSec: number | null
}

export function projectReading(reading: Reading, sinceSec: number): Reading {
  const drift = Math.min(Math.max(sinceSec, 0), MAX_DRIFT_SEC)
  if (drift === 0) return reading
  const { progress, elapsedSec, remainingSec } = reading
  return {
    progress:
      progress != null && remainingSec != null && remainingSec > 0
        ? Math.max(
            progress,
            Math.min(
              progress + (1 - progress) * Math.min(drift / remainingSec, 1),
              PROJECTED_CEILING,
            ),
          )
        : progress,
    elapsedSec: elapsedSec != null ? elapsedSec + drift : null,
    remainingSec: remainingSec != null ? Math.max(0, remainingSec - drift) : null,
  }
}
