// The Gmail connection's manifest: the read pair (gmail_search /
// gmail_read), translated from Sim's gmail tools into the manifest
// declarations the engine enforces (Sim prototype P1; design
// ~/workspace/dev/alcon-sim-prototype-design.md §3), and the two
// writes P2 adds beside them (design §4): gmail_send — Sim's
// gmail_send v2, its body assembled by the named gmail_mime builder,
// its approval presentation translated from Sim's
// assistant.reviewFields, verified by reading the created message
// back, irreversible by declaration — and gmail_modify_labels, the
// processed-mark a polling flow leaves (design §4.6).
//
// The `gmail` preset bundles this into the row at creation
// (buildIntegrationRow in catalog.ts): the manifest is first-party
// equipment, reviewed in code, because no drafting route can produce
// it — G4 cannot draft an OAuth service, and a draft may never name
// a response transform (gmail_read names gmail_message) or a body
// builder (gmail_send names gmail_mime). The owner's sign-in is the
// consent gate, and the connection test proves the credential at the
// Gmail profile's account check.
//
// THE TWIN: supabase/functions/_shared/gmailManifest.ts holds the
// same content for the server, which the browser cannot import. The
// two are written identically and tests/gmailManifest.test.ts pins
// them equal — canonical JSON, and the structure / permission hashes
// a review would compare.

import type { Json } from '@/types/database';

/** The Gmail manifest, as stored on a gmail integration row: the
 *  read pair (P1) and the send / label writes (P2). */
export const GMAIL_MANIFEST: Json = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    {
      name: 'gmail_search',
      action: 'gmail_search',
      effect: 'read',
      permission: 'allow',
      description: 'Search the connected Gmail mailbox with Gmail search syntax (from:, to:, subject:, in:inbox, is:unread, after:/before: and free words). The answer lists the matching messages as ids and thread ids only — read one with gmail_read to see its sender, subject and body. Keep maxResults small unless more are truly needed.',
      input: {
        q: { type: 'string', description: 'The search query, in Gmail search syntax (the API\'s q parameter).' },
        maxResults: { type: 'number', description: 'The most messages to list. When omitted, the service\'s own page size applies (up to 100).' },
      },
      required: ['q'],
      http: { method: 'GET', path: '/messages', query: ['q', 'maxResults'], body: [] },
    },
    {
      name: 'gmail_read',
      action: 'gmail_read',
      effect: 'read',
      permission: 'allow',
      description: 'Read one message from the connected Gmail mailbox by the id gmail_search returned: its From, To, Subject and Date headers, its labels and its plain-text body. Attachments are counted, never downloaded.',
      input: {
        id: { type: 'string', description: 'The message id (the id in gmail_search\'s answer).' },
        format: { type: 'string', description: 'Optional: "metadata" returns only the headers; the default, "full", returns the whole message.' },
      },
      required: ['id'],
      http: { method: 'GET', path: '/messages/{id}', query: ['format'], body: [] },
      transform: 'gmail_message',
    },
    {
      name: 'gmail_send',
      action: 'gmail_send',
      effect: 'write',
      permission: 'ask',
      description: 'Send an email from the connected Gmail account, as a new message or as a reply in a thread. To reply, pass the threadId, the replyToMessageId (the id), and the messageIdHeader and references from gmail_read\'s answer for the message being answered — the reply is threaded by those headers. The message itself is assembled by the named gmail_mime body builder. A sent message cannot be unsent; the send is verified by reading the created message back.',
      input: {
        to: { type: 'string', description: 'The recipient\'s email address.' },
        cc: { type: 'string', description: 'Cc recipients, comma-separated.' },
        bcc: { type: 'string', description: 'Bcc recipients, comma-separated.' },
        subject: { type: 'string', description: 'The subject line.' },
        body: { type: 'string', description: 'The message body.' },
        contentType: { type: 'string', description: '"text" (the default) or "html".' },
        threadId: { type: 'string', description: 'The thread to send in: pass the threadId gmail_read returned to reply within that thread.' },
        replyToMessageId: { type: 'string', description: 'The id of the message being replied to (the id gmail_read returned).' },
        messageIdHeader: { type: 'string', description: 'The Message-ID header of the message being replied to (messageIdHeader in gmail_read\'s answer); threads the reply.' },
        references: { type: 'string', description: 'The References header of the message being replied to (references in gmail_read\'s answer); threads the reply.' },
      },
      required: ['to', 'body'],
      http: { method: 'POST', path: '/messages/send', query: [], body: [], bodyFrom: 'gmail_mime' },
      present: {
        title: 'Send email',
        fields: [
          { arg: 'to', label: 'To' },
          { arg: 'cc', label: 'Cc' },
          { arg: 'bcc', label: 'Bcc' },
          { arg: 'threadId', label: 'Thread' },
          { arg: 'replyToMessageId', label: 'Reply to' },
          { arg: 'subject', label: 'Subject' },
        ],
        preview: 'body',
      },
      verify: { command: 'gmail_read', expect: { threadId: 'threadId' }, delay_ms: 1000 },
      reversibility: 'none',
    },
    {
      name: 'gmail_modify_labels',
      action: 'gmail_modify_labels',
      effect: 'write',
      permission: 'ask',
      description: 'Add or remove labels on one message in the connected Gmail mailbox — the processed-mark a polling flow leaves behind (removing UNREAD marks a message read). Pass at least one of addLabelIds and removeLabelIds. Labels are reversible, and the change is verified by reading the message back.',
      input: {
        id: { type: 'string', description: 'The message id (the id in gmail_search\'s or gmail_read\'s answer).' },
        addLabelIds: { type: 'array', items: { type: 'string' }, description: 'Label ids to add, e.g. ["Label_7"] or ["STARRED"].' },
        removeLabelIds: { type: 'array', items: { type: 'string' }, description: 'Label ids to remove, e.g. ["UNREAD"] or ["INBOX"].' },
      },
      required: ['id'],
      http: { method: 'POST', path: '/messages/{id}/modify', query: [], body: ['addLabelIds', 'removeLabelIds'] },
      verify: { command: 'gmail_read', expect: { threadId: 'threadId' } },
      reversibility: 'contained',
    },
  ],
};
