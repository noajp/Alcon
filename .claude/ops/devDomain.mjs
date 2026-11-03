//
// The Domain the dev loop works in.
//
// It lives in the database (dev_control.domain_id) rather than in each script,
// so moving the dev work to another Domain is one row, not a hunt through the
// ops folder for a uuid that went stale with the Domain it named.
//
// Usage:
//   import { devDomainId } from './devDomain.mjs'
//   const domain = await devDomainId(url, serviceKey)

export async function devDomainId(url, key) {
  const res = await fetch(`${url}/rest/v1/dev_control?id=eq.1&select=domain_id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`dev_control: ${res.status} ${await res.text()}`)
  const [row] = await res.json()
  if (!row?.domain_id) throw new Error('dev_control.domain_id is not set — set it to the dev Domain')
  return row.domain_id
}
