/**
 * Spoolman (https://github.com/Donkie/Spoolman) as the filament inventory.
 *
 * When `SPOOLMAN_URL` is set, Spoolman owns spools, stock and usage, and
 * PrintBench's own inventory is switched off. Something else — a printer
 * bridge, Moonraker, Home Assistant — reports usage to Spoolman, so this side
 * only ever reads: a second writer would deduct every print twice.
 *
 * Reads are cached briefly and fail soft. Spoolman being down costs a picker
 * its spool list and the queue its spool badges, never a page.
 */

/** Spools whose remaining weight drops to this count as running low. */
export const SPOOLMAN_LOW_STOCK_G = 100

const TIMEOUT_MS = 3000
const CACHE_MS = 60_000

export interface SpoolmanSpool {
  id: number
  filamentId: number
  filamentName: string | null
  vendor: string | null
  material: string | null
  /** "#rrggbb"; Spoolman's optional alpha is dropped. */
  colorHex: string | null
  /** Grams left, or null when Spoolman cannot know (no initial weight). */
  remainingG: number | null
  /** The spool's filament weight when full. */
  initialG: number | null
  location: string | null
  comment: string | null
  archived: boolean
  lastUsed: string | null
}

export type SpoolmanResult = { ok: true; spools: SpoolmanSpool[] } | { ok: false; error: string }

/** The configured base URL without a trailing slash, or null when not configured. */
export function spoolmanUrl(): string | null {
  const configured = process.env.SPOOLMAN_URL?.trim().replace(/\/+$/, '')
  return configured ? configured : null
}

export function spoolmanEnabled(): boolean {
  return spoolmanUrl() !== null
}

/** Spoolman's own page for a spool, for "edit it there" links. */
export function spoolmanSpoolLink(id: number): string | null {
  const base = spoolmanUrl()
  return base ? `${base}/spool/show/${id}` : null
}

let cache: { at: number; base: string; result: SpoolmanResult } | null = null

/** Every spool, archived ones included; callers filter. */
export async function listSpoolmanSpools(
  options: { fetch?: typeof fetch; now?: number } = {},
): Promise<SpoolmanResult> {
  const base = spoolmanUrl()
  if (!base) return { ok: false, error: 'Spoolman is not configured.' }

  const now = options.now ?? Date.now()
  if (cache && cache.base === base && now - cache.at < CACHE_MS) return cache.result

  const result = await fetchSpools(base, options.fetch ?? fetch)
  cache = { at: now, base, result }
  return result
}

/** Forget the cached list. For tests, and for a page that must be current. */
export function clearSpoolmanCache(): void {
  cache = null
}

async function fetchSpools(base: string, fetcher: typeof fetch): Promise<SpoolmanResult> {
  try {
    const response = await fetcher(`${base}/api/v1/spool?allow_archived=true`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, error: `Spoolman answered ${response.status}.` }
    const body: unknown = await response.json()
    if (!Array.isArray(body)) return { ok: false, error: 'Spoolman sent something unexpected.' }
    return { ok: true, spools: body.map(toSpool).filter((s): s is SpoolmanSpool => s !== null) }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Spoolman did not answer in time.'
        : 'Spoolman could not be reached.'
    console.warn(`[spoolman] ${reason} ${error instanceof Error ? error.message : ''}`)
    return { ok: false, error: reason }
  }
}

type Json = Record<string, unknown>

function toSpool(raw: unknown): SpoolmanSpool | null {
  if (!raw || typeof raw !== 'object') return null
  const spool = raw as Json
  const filament = (spool.filament ?? {}) as Json
  const vendor = (filament.vendor ?? null) as Json | null
  if (typeof spool.id !== 'number') return null

  return {
    id: spool.id,
    filamentId: typeof filament.id === 'number' ? filament.id : 0,
    filamentName: text(filament.name),
    vendor: vendor ? text(vendor.name) : null,
    material: text(filament.material),
    colorHex: color(filament.color_hex) ?? color(firstOf(filament.multi_color_hexes)),
    remainingG: grams(spool.remaining_weight),
    initialG: grams(spool.initial_weight) ?? grams(filament.weight),
    location: text(spool.location),
    comment: text(spool.comment),
    archived: spool.archived === true,
    lastUsed: text(spool.last_used),
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function grams(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

function firstOf(value: unknown): unknown {
  return typeof value === 'string' ? value.split(',')[0] : undefined
}

/** "2D3F6F" or "2D3F6FFF" (with alpha) to "#2d3f6f". */
function color(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `#${hex.slice(0, 6).toLowerCase()}` : null
}

/** "Matte Navy Blue" with its vendor and material, for lists and labels. */
export function describeSpoolmanSpool(spool: SpoolmanSpool): string {
  return [spool.material, spool.filamentName].filter(Boolean).join(' · ') || `Spool #${spool.id}`
}
