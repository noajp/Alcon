'use client';

import type { Integration } from '@/types/database';
import type { DirectoryEntry } from '@/hooks/customizeData';
import { customPresetFor, presetById, type IntegrationPreset } from './catalog';
import { IntegrationDetailDialog } from './IntegrationDetailDialog';

// The connection dialog, openable from anywhere — the Connectors tab, and
// the harness install walk, which walks a harness's missing connectors
// through this same dialog one at a time. What is opened is a value, not
// component state of one panel: a preset (its existing connection, if any),
// one connection, or a registry server to add as a custom MCP connection.

export type OpenedConnection = {
  preset: IntegrationPreset;
  integration: Integration | null;
  initial?: { name: string; endpoint: string; auth: 'none' | 'bearer' | 'header'; authHeader: string | null };
};

/** A fixed preset opens its existing connection; a custom one always starts a new one. */
export function openedForPreset(preset: IntegrationPreset, integrations: Integration[]): OpenedConnection {
  const existing = preset.custom ? null : integrations.find((i) => i.preset === preset.id) ?? null;
  return { preset, integration: existing };
}

export function openedForIntegration(integration: Integration): OpenedConnection {
  return { preset: presetById(integration.preset) ?? customPresetFor(integration.kind), integration };
}

export function openedForRegistryEntry(entry: DirectoryEntry): OpenedConnection {
  return {
    preset: customPresetFor('mcp'), integration: null,
    initial: { name: entry.title, endpoint: entry.endpoint, auth: entry.auth, authHeader: entry.authHeader },
  };
}

export function ConnectDialogHost(props: {
  spaceId: string; opened: OpenedConnection; integrations: Integration[];
  canEdit: boolean; onClose: () => void; onCreated: (created: Integration) => void;
}) {
  const { opened, integrations } = props;
  // Keep the open dialog on the live row (test results, optimistic edits);
  // while a disconnect is in flight the row is gone from the list, so the
  // dialog holds the row it opened with.
  const live = opened.integration ? integrations.find((i) => i.id === opened.integration!.id) ?? opened.integration : null;
  return (
    <IntegrationDetailDialog
      key={opened.integration?.id ?? opened.preset.id}
      spaceId={props.spaceId}
      preset={opened.preset}
      integration={live}
      canEdit={props.canEdit}
      initial={opened.initial}
      onClose={props.onClose}
      onCreated={props.onCreated}
    />
  );
}
