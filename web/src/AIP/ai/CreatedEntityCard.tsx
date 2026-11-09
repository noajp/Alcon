'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { DisplayIdChip } from '@/Function/shared/element/DisplayIdChip';
import { openInApp } from '@/Function/shared/appNavigation';
import { CARD_HOVER, statusLabel } from '@/shared/designTokens';
import { VIEW_REGISTRY } from '@/Frame/viewRegistry';
import { useElementById } from '@/hooks/elementData';
import { useObjectById } from '@/hooks/useObjectArchive';
import { useStrategies } from '@/hooks/strategyData';
import type { ElementStatus } from '@/types/database';
import { CHART_CARD_CLASS } from './chartColors';
import { flattenCreated } from './copilotSteps';
import type { CreatedEntity, ToolEvent } from './useAlconCopilot';

// Cards for what a chat turn created in Alcon — Elements, Objects and
// Strategies the turn's creation tools made, drawn from the tool
// events' created records (server-side truth), never from parsing the
// answer's prose: a mentioned entity stays a sentence, a created one
// gets a card. One component family on the chat charts' island surface
// — deliberately not the board's ElementCard (drag, inline editing,
// menus: wrong weight for a chat column) and not a Planner draft card
// (a thing that does not exist yet — the opposite state).
//
// Each card reads its row live by id through the reads the app already
// has; the created snapshot is the fallback while that read loads, and
// the card's text if the row has since been deleted — then it renders
// muted and is not a link: the record says what was made, it does not
// pretend it still exists.

/** How many cards a turn's block shows before the expander — a
 *  50-Element turn must not become a 50-card wall. */
const CREATED_CARD_CAP = 12;

/** The floating island every created card sits on, with the card
 *  hover discipline (border brightens, background stays). A card that
 *  opens is a button wearing the shell; one that cannot (its row is
 *  gone) is a plain muted panel in the same shape. */
function CardShell({ onOpen, muted, children }: {
  onOpen?: () => void;
  muted?: boolean;
  children: ReactNode;
}) {
  const face = `${CHART_CARD_CLASS} flex w-full items-center gap-2 px-2.5 py-2 text-left`;
  if (!onOpen) {
    return <div className={`${face} ${muted ? 'opacity-60' : ''}`}>{children}</div>;
  }
  return (
    <button type="button" onClick={onOpen} className={`${face} ${CARD_HOVER}`}>
      {children}
    </button>
  );
}

function ElementCreatedCard({ entity }: { entity: CreatedEntity }) {
  const { t } = useI18n();
  const { element, settled } = useElementById(entity.id);
  const objectId = element?.object_id ?? entity.objectId ?? null;
  const { object } = useObjectById(objectId);
  const gone = settled && !element;
  const status = element?.status ?? entity.status ?? undefined;
  return (
    <CardShell muted={gone}
      onOpen={gone ? undefined : () => openInApp('domain-elements', {
        elementId: entity.id,
        ...(objectId ? { objectId } : {}),
      })}>
      <ElementIcon size={15} className="shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] text-foreground">{element?.title ?? entity.title}</span>
          <DisplayIdChip id={element?.display_id ?? entity.displayId} size="xs" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {status && <ElementProgressMark status={status as ElementStatus} progress={element?.progress ?? 0} size={13} />}
          {status && <span className="shrink-0">{statusLabel(status)}</span>}
          {object?.name && <span className="min-w-0 truncate">· {object.name}</span>}
          {gone && <span className="shrink-0">{t('Deleted')}</span>}
        </span>
      </span>
    </CardShell>
  );
}

function ObjectCreatedCard({ entity }: { entity: CreatedEntity }) {
  const { t } = useI18n();
  const { object, settled } = useObjectById(entity.id);
  const gone = settled && !object;
  return (
    <CardShell muted={gone}
      onOpen={gone ? undefined : () => openInApp('objects', { objectId: entity.id })}>
      <ObjectIcon size={15} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{object?.name ?? entity.title}</span>
      {object?.prefix && (
        <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{object.prefix}</span>
      )}
      {gone && <span className="shrink-0 text-[11.5px] text-muted-foreground">{t('Deleted')}</span>}
    </CardShell>
  );
}

function StrategyCreatedCard({ entity }: { entity: CreatedEntity }) {
  const { t } = useI18n();
  const { data, loading } = useStrategies();
  const live = data.find((s) => s.id === entity.id);
  const gone = !loading && !live;
  const Glyph = VIEW_REGISTRY.strategy.icon;
  return (
    <CardShell muted={gone}
      onOpen={gone ? undefined : () => openInApp('strategy', { strategyId: entity.id })}>
      {Glyph && (
        <span className="shrink-0 text-muted-foreground"><Glyph size={15} /></span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{live?.name ?? entity.title}</span>
      {gone && <span className="shrink-0 text-[11.5px] text-muted-foreground">{t('Deleted')}</span>}
    </CardShell>
  );
}

/** One created entity's card, its body per kind. */
export function CreatedEntityCard({ entity }: { entity: CreatedEntity }) {
  switch (entity.kind) {
    case 'object':
      return <ObjectCreatedCard entity={entity} />;
    case 'strategy':
      return <StrategyCreatedCard entity={entity} />;
    default:
      return <ElementCreatedCard entity={entity} />;
  }
}

/**
 * The block of cards under a turn's answer: everything the turn
 * created, flattened from its tool events in order. Renders while the
 * turn streams too — the block grows as creations land and freezes as
 * it stands when the turn settles or is stopped. No header: the cards
 * speak for themselves, and the steps line above already counts the
 * work. Beyond the cap, one expander (the PlanCard precedent).
 */
export function CreatedEntities({ events }: { events: readonly ToolEvent[] }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const created = flattenCreated(events);
  if (!created.length) return null;
  const shown = showAll ? created : created.slice(0, CREATED_CARD_CAP);
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((entity) => (
        <CreatedEntityCard key={`${entity.kind}:${entity.id}`} entity={entity} />
      ))}
      {created.length > CREATED_CARD_CAP && (
        <button type="button" onClick={() => setShowAll((v) => !v)}
          className="self-start text-[12px] text-muted-foreground transition-colors hover:text-foreground">
          {showAll ? t('Show fewer') : t('Show all {count}', { count: created.length })}
        </button>
      )}
    </div>
  );
}
