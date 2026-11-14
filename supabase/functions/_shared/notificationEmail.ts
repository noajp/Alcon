// Notifications by email (supabase/migrations/20270109090000_notification_emails.sql).
// A notification the recipient wants by email queues a row in
// notification_emails; the automations tick calls deliverNotificationEmails,
// which sends each through Resend's HTTP API.
//
// Secrets: RESEND_API_KEY (the provider), NOTIFY_EMAIL_FROM (the sender,
// e.g. "Clayware <noreply@example.com>"), APP_URL (the app's origin, for the
// link). Without the key or the sender, queued emails are marked skipped,
// not kept: switching email on later must not send a backlog of old news.

export interface NotificationEmailInput {
  kind: string;
  /** The notification's own title (written in English by most call sites). */
  title: string;
  body?: string | null;
  actorName?: string | null;
  elementTitle?: string | null;
  appUrl: string;
}

export interface RenderedEmail { subject: string; text: string; html: string }

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The email for one notification, in Japanese. Assignment reads as its own
 *  sentence; any other kind carries the notification's own title. */
export function renderNotificationEmail(n: NotificationEmailInput): RenderedEmail {
  const link = `${n.appUrl.replace(/\/+$/, "")}/?view=inbox`;
  const actor = n.actorName?.trim();
  let subject: string;
  let lead: string;
  if (n.kind === "assigned" && n.elementTitle) {
    subject = `「${n.elementTitle}」の担当になりました`;
    lead = actor
      ? `${actor} さんが、あなたを「${n.elementTitle}」の担当に加えました。`
      : `あなたが「${n.elementTitle}」の担当に加わりました。`;
  } else {
    subject = n.title;
    lead = n.title;
  }
  const detail = n.body?.trim() ? n.body.trim().slice(0, 500) : "";
  const footer = "メールで受け取る通知は、Clayware の 設定 > 通知 で変えられます。";

  const text = [lead, detail, `Clayware で開く: ${link}`, footer].filter(Boolean).join("\n\n");
  const html = `<!doctype html><html lang="ja"><body style="margin:0;padding:0;background:#f7f8f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f8;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e5e7;border-radius:8px;"><tr>
<td style="padding:28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Segoe UI','Noto Sans JP',sans-serif;color:#14161a;">
<p style="margin:0 0 20px;font-size:15px;font-weight:600;">Clayware</p>
<p style="margin:0 0 ${detail ? "12" : "24"}px;font-size:15px;line-height:1.7;">${escapeHtml(lead)}</p>
${detail ? `<p style="margin:0 0 24px;font-size:13px;line-height:1.8;color:#3a3c40;white-space:pre-wrap;">${escapeHtml(detail)}</p>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#3d5fae;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Clayware で開く</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:12px;line-height:1.8;color:#5a5a5c;">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

interface EmailEnv {
  apiKey: string | undefined;
  from: string | undefined;
  appUrl: string | undefined;
  fetch?: typeof fetch;
}

// deno-lint-ignore no-explicit-any
type Admin = any;

const BATCH = 25;

/** Sends what is queued. Returns counts for the tick's summary. */
export async function deliverNotificationEmails(admin: Admin, env: EmailEnv): Promise<{ sent: number; failed: number; skipped: number }> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  const { data: claimed, error } = await admin.rpc("claim_notification_emails", { p_limit: BATCH });
  if (error || !claimed?.length) return out;
  const doFetch = env.fetch ?? fetch;

  for (const row of claimed as { id: string; notification_id: string; recipient_id: string; attempts: number }[]) {
    const mark = (patch: Record<string, unknown>) => admin.from("notification_emails").update(patch).eq("id", row.id);
    if (!env.apiKey || !env.from || !env.appUrl) {
      await mark({ status: "skipped", last_error: "メール送信の設定（RESEND_API_KEY / NOTIFY_EMAIL_FROM / APP_URL）がない" });
      out.skipped += 1;
      continue;
    }
    try {
      const { data: n } = await admin.from("notifications")
        .select("kind, title, body, actor_id, actor_name, element_id, is_read").eq("id", row.notification_id).maybeSingle();
      // Gone, or already read in the app before the email went out: nothing to tell.
      if (!n || n.is_read) { await mark({ status: "skipped", last_error: n ? "既読" : "通知がない" }); out.skipped += 1; continue; }
      const { data: user } = await admin.auth.admin.getUserById(row.recipient_id);
      const to = user?.user?.email;
      if (!to) { await mark({ status: "skipped", last_error: "宛先のメールアドレスがない" }); out.skipped += 1; continue; }
      let elementTitle: string | null = null;
      if (n.element_id) {
        const { data: el } = await admin.from("elements").select("title").eq("id", n.element_id).maybeSingle();
        elementTitle = el?.title ?? null;
      }
      let actorName: string | null = n.actor_name ?? null;
      if (!actorName && n.actor_id) {
        const { data: p } = await admin.from("profiles").select("display_name").eq("id", n.actor_id).maybeSingle();
        actorName = p?.display_name ?? null;
      }
      const email = renderNotificationEmail({ kind: n.kind, title: n.title, body: n.body, actorName, elementTitle, appUrl: env.appUrl });
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.apiKey}`, "idempotency-key": row.id },
        body: JSON.stringify({ from: env.from, to: [to], subject: email.subject, text: email.text, html: email.html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await mark({ status: "sent", sent_at: new Date().toISOString(), last_error: null });
      out.sent += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // claim_notification_emails stops retrying after three attempts.
      await mark({ status: row.attempts >= 3 ? "failed" : "pending", last_error: message.slice(0, 500) });
      out.failed += 1;
    }
  }
  return out;
}
