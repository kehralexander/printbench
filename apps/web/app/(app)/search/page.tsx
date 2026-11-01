import { redirect } from 'next/navigation'
import type { Route } from 'next'

/**
 * Search moved into the models page; old bookmarks and links land there with
 * the same query and filters.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item)
    }
  }
  const query = params.toString()
  redirect((query ? `/models?${query}` : '/models') as Route)
}
