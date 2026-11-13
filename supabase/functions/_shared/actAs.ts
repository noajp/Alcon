// A session for a person, issued on the server, so work that person set up
// (an automation) runs with their authority while nobody has Clayware open.
// RLS, budgets and approvals then apply exactly as if they had clicked.
//
// It goes through Supabase Auth's own flow: the service role generates a
// one-time magic-link token (no email is sent) and exchanges it at once for a
// session. Only service-role code can call this; callers must have decided
// beforehand that the person consented (they own the automation).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ActingSession { userId: string; email: string | null; jwt: string; db: SupabaseClient }

export async function sessionFor(admin: SupabaseClient, url: string, anonKey: string, userId: string): Promise<ActingSession> {
  const { data: found, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (userError || !email) throw new Error(`could not act as ${userId}: no user or no email`);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) throw new Error(`could not act as ${userId}: ${linkError?.message ?? "no token"}`);
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  const jwt = verified?.session?.access_token;
  if (verifyError || !jwt) throw new Error(`could not act as ${userId}: ${verifyError?.message ?? "no session"}`);
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, email, jwt, db };
}
