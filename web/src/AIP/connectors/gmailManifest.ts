// The Gmail connection's manifest: the read pair (gmail_search /
// gmail_read), translated from Sim's gmail tools into the manifest
// declarations the engine enforces (Sim prototype P1; design
// ~/workspace/dev/alcon-sim-prototype-design.md §3).
//
// The `gmail` preset bundles this into the row at creation
// (buildIntegrationRow in catalog.ts): the manifest is first-party
// equipment, reviewed in code, because no drafting route can produce
// it — G4 cannot draft an OAuth service, and a draft may never name
// a response transform (gmail_read names gmail_message). The owner's
// sign-in is the consent gate, and the connection test proves the
// credential at the Gmail profile's account check.
//
// THE TWIN: supabase/functions/_shared/gmailManifest.ts holds the
// same content for the server, which the browser cannot import. The
// two are written identically and tests/gmailManifest.test.ts pins
// them equal — canonical JSON, and the structure / permission hashes
// a review would compare.

import type { Json } from '@/types/database';

/** The Gmail read pair, as stored on a gmail integration row. */
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
  ],
};
