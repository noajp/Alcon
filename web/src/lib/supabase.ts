import { createClient } from '@supabase/supabase-js'

// Defensive: never allow empty/whitespace strings through. These dummy values keep
// the module evaluable at build-time (SSG of /_not-found etc. imports this indirectly)
// even before env vars are wired up. Runtime auth will fail gracefully.
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabaseUrl =
  typeof rawUrl === 'string' && rawUrl.trim().length > 0
    ? rawUrl.trim()
    : 'https://placeholder.supabase.co'

const supabaseAnonKey =
  typeof rawKey === 'string' && rawKey.trim().length > 0
    ? rawKey.trim()
    : 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)



/**
 * The signed-in user's id without a network round trip.
 *
 * `auth.getUser()` re-validates the JWT against GoTrue on every call, and
 * auth-js serialises those calls behind a navigator lock — so N callers on
 * boot cost N sequential round trips before any of their real queries can
 * start. The session in local storage already carries the user id; reading it
 * is local and instant. RLS still verifies the token on every data request,
 * so nothing is trusted that the server does not also check.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}
