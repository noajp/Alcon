// Mints a LiveKit access token for a voice channel.
//
// Request:  { channelId: string, displayName?: string }
// Response: { token: string, url: string }
//
// Auth: requires the caller's Supabase JWT (forwarded via the
// supabase-js functions.invoke client). The handler re-instantiates
// a Supabase client with the user's JWT and reads `channels` under
// RLS, so the token is only minted if the user actually owns the
// room that contains this channel.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  if (!apiKey || !apiSecret || !livekitUrl) {
    return jsonResponse({ error: "LiveKit env vars not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return jsonResponse({ error: "Supabase env vars missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { channelId?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const channelId = body.channelId;
  if (!channelId) return jsonResponse({ error: "channelId is required" }, 400);

  // RLS will filter — if the user doesn't own the parent room, we get nothing.
  const { data: channel, error: chanErr } = await supabase
    .from("channels")
    .select("id, kind")
    .eq("id", channelId)
    .maybeSingle();
  if (chanErr) return jsonResponse({ error: chanErr.message }, 500);
  if (!channel) return jsonResponse({ error: "Channel not found or no access" }, 403);
  if (channel.kind !== "voice") return jsonResponse({ error: "Channel is not voice" }, 400);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: userData.user.id,
    name: body.displayName ?? userData.user.email ?? "Guest",
    ttl: 60 * 60 * 6, // 6 hours
  });
  at.addGrant({
    roomJoin: true,
    room: `channel-${channelId}`,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return jsonResponse({ token, url: livekitUrl });
});
