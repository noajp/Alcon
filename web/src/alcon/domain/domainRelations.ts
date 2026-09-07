import type { AlconObject, Domain, Strategy } from '@/types/database';

export interface InitiativeRelation {
  initiative: Pick<Strategy, 'id' | 'name' | 'description' | 'status'>;
  objectIds: string[];
}

/** Only visible endpoints participate; repeated multi-home links count once. */
export function initiativesForObjects(
  objectIds: readonly string[],
  initiatives: InitiativeRelation['initiative'][],
  links: { strategy_id: string; object_id: string }[],
): InitiativeRelation[] {
  const scope = new Set(objectIds);
  return initiatives.map(initiative => ({
    initiative,
    objectIds: [...new Set(links.filter(link => link.strategy_id === initiative.id && scope.has(link.object_id)).map(link => link.object_id))],
  })).filter(relation => relation.objectIds.length > 0)
    .sort((a, b) => a.initiative.name.localeCompare(b.initiative.name));
}

export function domainsForObjects(
  objects: Pick<AlconObject, 'id' | 'name' | 'domain_id'>[],
  domains: Pick<Domain, 'id' | 'name' | 'description'>[],
  links: { domain_id: string; object_id: string }[],
) {
  return domains.map(domain => ({
    domain,
    objects: objects.filter(object => object.domain_id === domain.id || links.some(link => link.domain_id === domain.id && link.object_id === object.id)),
  })).filter(relation => relation.objects.length > 0)
    .sort((a, b) => a.domain.name.localeCompare(b.domain.name));
}
