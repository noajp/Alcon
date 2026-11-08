// Approval-card presentations for the write commands a person decides
// on most, keyed by the tool / command names the built-in connectors
// use. A command's own `present` block (connectorManifest.ts) outranks
// this overlay; a call with neither renders through the fallback in
// integrationTools.ts (a humanized title, the plain field flattening).
//
// Presentation only: enforcement never reads this file, so a key the
// server has renamed simply misses and the fallback renders — degraded,
// never wrong. The labels are data, like command descriptions, and are
// not translated by the i18n layer.

import type { CommandPresent } from "./connectorManifest.ts";

/** The overlay for known tools, keyed by MCP tool name / command name. */
const OVERLAY: Record<string, CommandPresent> = {
  create_pull_request: {
    title: "Create a pull request",
    fields: [
      { arg: "owner", label: "Repository owner" },
      { arg: "repo", label: "Repository" },
      { arg: "title", label: "Title" },
      { arg: "base", label: "Base" },
      { arg: "head", label: "Head" },
    ],
    preview: "body",
  },
  create_or_update_file: {
    title: "Create or update a file",
    fields: [
      { arg: "owner", label: "Repository owner" },
      { arg: "repo", label: "Repository" },
      { arg: "path", label: "File" },
      { arg: "branch", label: "Branch" },
    ],
    // A whole file can ride in this argument; the display caps it hard.
    preview: "content",
  },
  create_issue: {
    title: "Create an issue",
    fields: [
      { arg: "owner", label: "Repository owner" },
      { arg: "repo", label: "Repository" },
      { arg: "title", label: "Title" },
    ],
    preview: "body",
  },
  add_issue_comment: {
    title: "Comment on an issue",
    fields: [
      { arg: "owner", label: "Repository owner" },
      { arg: "repo", label: "Repository" },
      { arg: "issue_number", label: "Issue" },
    ],
    preview: "body",
  },
  merge_pull_request: {
    title: "Merge a pull request",
    fields: [
      { arg: "owner", label: "Repository owner" },
      { arg: "repo", label: "Repository" },
      { arg: "pullNumber", label: "Pull request" },
      { arg: "merge_method", label: "Method" },
    ],
  },
};

/** The argument names a mail/message-shaped call is recognized by. */
const ADDRESS_ARGS = ["to", "recipient"] as const;
const PREVIEW_ARGS = ["body", "text", "message"] as const;

/**
 * Pure. The generic send/post shape, matched on argument names only: a
 * call addressed to someone reads with a To (and a Subject when it has
 * one), and its body/text/message is the content the decision turns on.
 * Null when the call is not addressed to anyone — an ordinary write
 * keeps the plain fallback rather than borrowing a mail reading.
 */
function genericPresentation(input: Record<string, unknown>): CommandPresent | null {
  const to = ADDRESS_ARGS.find((a) => input[a] !== undefined && input[a] !== null);
  const subject = input.subject !== undefined && input.subject !== null ? "subject" : null;
  if (!to && !subject) return null;
  const fields: { arg: string; label: string }[] = [];
  if (to) fields.push({ arg: to, label: "To" });
  if (subject) fields.push({ arg: subject, label: "Subject" });
  const preview = PREVIEW_ARGS.find((a) => input[a] !== undefined && input[a] !== null);
  return { fields, ...(preview ? { preview } : {}) };
}

/**
 * Pure. The overlay presentation for one call: the named entry for any
 * of its keys (the MCP tool name first, then the command's own names),
 * else the generic shape its arguments make, else null.
 */
export function overlayPresentation(
  keys: readonly (string | null | undefined)[],
  input: Record<string, unknown>,
): CommandPresent | null {
  for (const k of keys) {
    if (k && OVERLAY[k]) return OVERLAY[k];
  }
  return genericPresentation(input);
}
