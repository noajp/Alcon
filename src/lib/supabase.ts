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

