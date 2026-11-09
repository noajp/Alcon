// The Gmail connection's manifest: the read pair (gmail_search /
// gmail_read) translated from Sim's gmail tools into this engine's
// manifest declarations (Sim prototype P1; design
// ~/workspace/dev/alcon-sim-prototype-design.md §3, teardown §6).
//
// The translation, not a port: Sim's ToolConfigs are declarative HTTP
// (a request builder, params, outputs), so what crosses over is the
// shape of the two calls, re-expressed in the manifest grammar —
// Sim's code stays behind. What the manifest adds that Sim has no
// equivalent for is Athena's side of the bargain: the commands are
// declared reads under the manifest's own defaults, and gmail_read
// names the gmail_message response transform (manifestTransforms.ts)
// that reads a message resource as its headers and plain-text body.
//
// The manifest ships bundled with the first-party `gmail` preset: a
// row created from the preset carries it from birth (the web twin
// below is what the browser writes), because the routes to a manifest
// a drafter writes do not exist for this connection — G4 cannot draft
// an OAuth service, and a draft may never name a transform
// (connectorDraft.ts refuses both). The connection's own gates stay
// the G4 ones in spirit: the owner's sign-in is the consent, and the
// connection test proves the credential at the profile's account
// check (googleOAuth.ts GOOGLE_GMAIL_PROFILE), which an unauthenticated
// call cannot pass — the negative control holds by construction.
//
// THE TWIN: web/src/AIP/connectors/gmailManifest.ts holds the same
// content for the browser, which cannot import this module. The two
// are written identically and tests/gmailManifest.test.ts pins them
// equal — canonical JSON, and the structure / permission hashes a
// review would compare — so the manifest the preset bundles is the
// manifest this side declares, byte for byte in every way that binds.

/** The Gmail read pair, as stored on a gmail integration row. */
export const GMAIL_MANIFEST: Record<string, unknown> = {
  version: 1,
  defaults: { read: "allow", write: "ask" },
  commands: [
    {
      name: "gmail_search",
      action: "gmail_search",
      effect: "read",
      permission: "allow",
      description: "Search the connected Gmail mailbox with Gmail search syntax (from:, to:, subject:, in:inbox, is:unread, after:/before: and free words). The answer lists the matching messages as ids and thread ids only — read one with gmail_read to see its sender, subject and body. Keep maxResults small unless more are truly needed.",
      input: {
        q: { type: "string", description: "The search query, in Gmail search syntax (the API's q parameter)." },
        maxResults: { type: "number", description: "The most messages to list. When omitted, the service's own page size applies (up to 100)." },
      },
      required: ["q"],
      http: { method: "GET", path: "/messages", query: ["q", "maxResults"], body: [] },
    },
    {
      name: "gmail_read",
      action: "gmail_read",
      effect: "read",
      permission: "allow",
      description: "Read one message from the connected Gmail mailbox by the id gmail_search returned: its From, To, Subject and Date headers, its labels and its plain-text body. Attachments are counted, never downloaded.",
      input: {
        id: { type: "string", description: "The message id (the id in gmail_search's answer)." },
        format: { type: "string", description: "Optional: \"metadata\" returns only the headers; the default, \"full\", returns the whole message." },
      },
      required: ["id"],
      http: { method: "GET", path: "/messages/{id}", query: ["format"], body: [] },
      transform: "gmail_message",
    },
  ],
};
