import { materialFamily } from './loaded-filament'
import {
  baseUrl,
  describeHttpError,
  describeNetworkError,
  type PrintHostConfig,
} from './print-hosts'

/**
 * Writing to KX-Bridge what a slot holds: the printer's material and colour,
 * the bridge's slicer profile, and the Spoolman spool the bridge books usage
 * against.
 *
 *   POST /api/ams/set_slot                 { index, type, color: [r, g, b] }
 *   POST /kx/filament/slots/{i}/profile    { vendor, name }  (empty clears)
 *   GET  /kx/spoolman/status               { configured, slot_spools: { "0": 11 } }
 *   POST /kx/spoolman/active-spool         { slot_map: { "0": 11 } }
 *
 * Nightly bridges serve the Spoolman routes under /kx/plugin/spoolman/ and
 * keep the old ones for a release. Both answer an unknown path with
 * `200 {"result": {}}`, so a route is judged by what comes back, not by the
 * status.
 */

export type BridgeWrite = { ok: true } | { ok: false; error: string }

/** Slot index (0-based) → Spoolman spool id. */
export type SpoolMap = Map<number, number>

const SPOOLMAN_ROUTES = ['/kx/spoolman', '/kx/plugin/spoolman'] as const
const TIMEOUT_MS = 10_000

function request(host: PrintHostConfig, fetchImpl: typeof fetch) {
  const base = baseUrl(host.endpoint)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (host.apiKey) headers['x-api-key'] = host.apiKey
  return async (path: string, body?: unknown): Promise<Response> =>
    fetchImpl(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
}

/**
 * The bridge's slot → spool bindings. Null `map` with an error when the
 * bridge has no Spoolman configured or cannot be read.
 */
export async function readKxSpoolMap(
  host: PrintHostConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; map: SpoolMap; route: string } | { ok: false; error: string }> {
  const call = request(host, fetchImpl)
  try {
    for (const route of SPOOLMAN_ROUTES) {
      const response = await call(`${route}/status`)
      if (response.status === 404) continue
      if (!response.ok) return { ok: false, error: await describeHttpError(response) }
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
      // An unknown route answers {"result": {}}: try the next one.
      if (!body || !('configured' in body)) continue
      if (body.configured !== true) {
        return { ok: false, error: `${host.name} has no Spoolman set up in KX-Bridge.` }
      }
      return { ok: true, map: toSpoolMap(body.slot_spools), route }
    }
    return { ok: false, error: `${host.name}'s KX-Bridge does not track Spoolman spools.` }
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, host.endpoint) }
  }
}

/**
 * Replaces every binding at once — the bridge has no per-slot write — and
 * resets its usage counters for all slots, so never call it mid-print.
 */
export async function writeKxSpoolMap(
  host: PrintHostConfig,
  route: string,
  map: SpoolMap,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; map: SpoolMap } | { ok: false; error: string }> {
  const slotMap = Object.fromEntries([...map].map(([slot, spool]) => [String(slot), spool]))
  try {
    const response = await request(host, fetchImpl)(`${route}/active-spool`, { slot_map: slotMap })
    if (!response.ok) return { ok: false, error: await describeHttpError(response) }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || !('slot_spools' in body)) {
      return { ok: false, error: `${host.name}'s KX-Bridge did not take the spool binding.` }
    }
    const saved = toSpoolMap(body.slot_spools)
    if (!sameMap(saved, map)) {
      return { ok: false, error: `${host.name}'s KX-Bridge saved other bindings than were sent.` }
    }
    return { ok: true, map: saved }
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, host.endpoint) }
  }
}

/**
 * Tells the printer what is in a slot. Its screen keeps the exact colour.
 * The bridge answers before the printer does, and a refusal shows up only as
 * the old values coming back on the next report — read the slots again to
 * know.
 */
export async function setKxSlot(
  host: PrintHostConfig,
  slotIndex: number,
  material: string,
  colorHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BridgeWrite> {
  const color = rgb(colorHex)
  if (!color) return { ok: false, error: `${colorHex} is not a colour.` }
  try {
    const response = await request(host, fetchImpl)('/api/ams/set_slot', {
      index: slotIndex,
      type: material,
      color,
    })
    if (!response.ok) return { ok: false, error: await describeHttpError(response) }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, host.endpoint) }
  }
}

export interface KxProfile {
  vendor: string
  name: string
  type: string
}

/** The bridge's slicer profiles of one material type, every vendor. */
export async function listKxProfiles(
  host: PrintHostConfig,
  type: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KxProfile[]> {
  try {
    const response = await request(
      host,
      fetchImpl,
    )(`/kx/filament/profiles?type=${encodeURIComponent(type.toUpperCase())}`)
    if (!response.ok) return []
    const body = (await response.json().catch(() => null)) as { result?: unknown } | null
    if (!Array.isArray(body?.result)) return []
    return (body.result as Record<string, unknown>[])
      .filter((p) => typeof p.vendor === 'string' && typeof p.name === 'string')
      .map((p) => ({
        vendor: p.vendor as string,
        name: p.name as string,
        type: typeof p.type === 'string' ? p.type : type,
      }))
  } catch {
    return []
  }
}

/** Sets the slot's slicer profile, or clears it when `profile` is null. */
export async function setKxSlotProfile(
  host: PrintHostConfig,
  slotIndex: number,
  profile: { vendor: string; name: string } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<BridgeWrite> {
  try {
    const response = await request(host, fetchImpl)(`/kx/filament/slots/${slotIndex}/profile`, {
      vendor: profile?.vendor ?? '',
      name: profile?.name ?? '',
    })
    if (!response.ok) return { ok: false, error: await describeHttpError(response) }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeNetworkError(error, host.endpoint) }
  }
}

/**
 * The bridge's profile for a spool: same vendor and material, and of that
 * vendor's variants the one whose words ("Matte", "Silk") the spool names —
 * "Anycubic PLA Matte" for Anycubic's Matte White. The plain profile when
 * the spool names no variant the vendor has; null for a vendor the bridge
 * does not know.
 */
export function profileForSpool(
  spool: { vendor: string | null; material: string | null; filamentName: string | null },
  profiles: readonly KxProfile[],
): KxProfile | null {
  if (!spool.vendor || !spool.material) return null
  const vendor = spool.vendor.toLowerCase()
  const family = materialFamily(spool.material)
  const said = words(`${spool.material} ${spool.filamentName ?? ''}`)
  let best: { profile: KxProfile; score: number } | null = null
  for (const profile of profiles) {
    if (profile.vendor.toLowerCase() !== vendor) continue
    if (materialFamily(profile.type) !== family) continue
    // "Anycubic PLA Matte" → ["matte"]: what sets it apart from the plain one.
    const plain = [...words(profile.vendor), family.toLowerCase()]
    const variant = words(profile.name).filter((word) => !plain.includes(word))
    if (!variant.every((word) => said.includes(word))) continue
    if (!best || variant.length > best.score) best = { profile, score: variant.length }
  }
  return best?.profile ?? null
}

/**
 * What the printer is told the slot holds: Spoolman's material, with the
 * finish when the filament's name has one Spoolman's material does not —
 * "PLA" plus "Matte White" is "PLA Matte", as the printer's own menu says.
 */
export function printerMaterial(spool: {
  material: string | null
  filamentName: string | null
}): string | null {
  if (!spool.material) return null
  const material = spool.material.trim()
  const finish = words(spool.filamentName ?? '').find((word) => FINISHES.includes(word))
  if (!finish || words(material).includes(finish)) return material
  return `${material} ${finish[0]!.toUpperCase()}${finish.slice(1)}`
}

const FINISHES = ['matte', 'silk']

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter(Boolean)
}

function toSpoolMap(value: unknown): SpoolMap {
  const map: SpoolMap = new Map()
  if (!value || typeof value !== 'object') return map
  for (const [slot, spool] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(slot)
    if (Number.isInteger(index) && index >= 0 && typeof spool === 'number' && spool > 0) {
      map.set(index, spool)
    }
  }
  return map
}

function sameMap(a: SpoolMap, b: SpoolMap): boolean {
  return a.size === b.size && [...a].every(([slot, spool]) => b.get(slot) === spool)
}

function rgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16)) as [number, number, number]
}
