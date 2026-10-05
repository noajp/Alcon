import { createDomain, createObject, createElement } from '@/hooks/useSupabase';
import { createVision } from '@/ActivitySpace/strategy/vision/data';
import { createPortfolio } from '@/ActivitySpace/strategy/portfolio/data';
import { createStrategy } from '@/ActivitySpace/strategy/initiative/strategyData';
import type { Locale } from '@/Function/i18n/locales';
import { starterContent } from './starterContent';

/** Fills a just-created Space with its starter Domain and Vision. */
export async function seedStarterSpace(spaceId: string, userId: string, locale: Locale): Promise<void> {
  const content = starterContent(locale);

  const domain = await createDomain({
    name: content.domain.name,
    identifier: content.domain.identifier,
    description: content.domain.description,
    privacy: 'workspace',
    user_id: userId,
    activity_space_id: spaceId,
  });

  // In order, so Objects and Elements keep the order they are written in.
  const objectIds = new Map<string, string>();
  for (const [index, object] of content.objects.entries()) {
    const created = await createObject({
      name: object.name,
      description: object.description,
      domain_id: domain.id,
      order_index: index,
    });
    objectIds.set(object.key, created.id);
    for (const [elementIndex, element] of object.elements.entries()) {
      await createElement({
        title: element.title,
        description: element.description,
        object_id: created.id,
        order_index: elementIndex,
      });
    }
  }

  const vision = await createVision({
    activity_space_id: spaceId,
    name: content.vision.name,
    statement: content.vision.statement,
    order_index: 0,
  });
  for (const [index, portfolio] of content.portfolios.entries()) {
    const created = await createPortfolio({
      activity_space_id: spaceId,
      vision_id: vision.id,
      name: portfolio.name,
      description: portfolio.description,
      order_index: index,
    });
    for (const initiative of portfolio.initiatives) {
      await createStrategy(
        {
          name: initiative.name,
          description: initiative.description,
          vision_id: vision.id,
          portfolio_id: created.id,
        },
        initiative.objectKeys.flatMap((key) => objectIds.get(key) ?? []),
      );
    }
  }
}
