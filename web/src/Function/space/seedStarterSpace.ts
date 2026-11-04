import { createDomain, createObject, createElement } from '@/hooks/useSupabase';
import { addStrategyChild, createStrategy } from '@/hooks/strategyData';
import type { Locale } from '@/Function/i18n/locales';
import { starterContent } from './starterContent';

/** Fills a just-created Space with its starter Domain and Strategies. */
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

  // One Strategy at the top, the groups under it, the Strategies under those.
  const top = await createStrategy({ name: content.strategy.name, description: content.strategy.description, activity_space_id: spaceId }, []);
  for (const group of content.strategies) {
    const parent = await createStrategy({ name: group.name, description: group.description, activity_space_id: spaceId }, []);
    await addStrategyChild(top.id, parent.id);
    for (const strategy of group.children) {
      const child = await createStrategy(
        { name: strategy.name, description: strategy.description, activity_space_id: spaceId },
        strategy.objectKeys.flatMap((key) => objectIds.get(key) ?? []),
      );
      await addStrategyChild(parent.id, child.id);
    }
  }
}
