import { createClient } from '@supabase/supabase-js'

// Fallbacks prevent the module from crashing at build time (SSG/SSR) when env vars
// are not yet configured. At runtime, missing env will cause API calls to fail,
// which is handled gracefully by the auth flow.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

