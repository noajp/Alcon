import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CallerNotice, CallerNotifier } from "./agentReportTools.ts";

// The one notification an outside caller's report sends to the person who
// connected it. The comment and status triggers leave the actor out of their
// recipients, and a caller's JWT cannot insert notifications (only the
// SECURITY DEFINER triggers and the service role write them), so — as
// run-agent does for the person who started a run — the service role writes
// it. The recipient is fixed to the authenticated caller here; nothing the
// caller sends can address anyone else.

export function callerNotifier(recipientId: string): CallerNotifier {
  return async (notice: CallerNotice) => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("notifications").insert({
      recipient_id: recipientId,
      actor_name: notice.actorName,
      kind: "status_change",
      element_id: notice.elementId,
      title: notice.title,
      body: notice.body,
    });
    if (error) console.error("caller notification failed:", error.message);
  };
}
