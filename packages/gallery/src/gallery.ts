export type PhotoKind = 'before' | 'after' | 'regular';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type PeopleStatus = 'none_visible' | 'permission_on_file' | 'unknown';

export interface GalleryItem {
  id: string;
  projectId: string | null;
  serviceId: string | null;
  kind: PhotoKind;
  reviewStatus: ReviewStatus;
  /** Owner confirmed ownership or permission for the photo. */
  ownershipConfirmed: boolean;
  /** Identifiable people require permission on file before publishing. */
  peopleStatus: PeopleStatus;
  caption: { en: string; es: string };
  captionApproved: { en: boolean; es: boolean };
  alt: { en: string; es: string };
  altApproved: { en: boolean; es: boolean };
  visible: boolean;
  deleted: boolean;
  sortOrder: number;
}

export interface GalleryPair {
  id: string;
  beforeId: string;
  afterId: string;
}

export type PublishBlocker =
  | 'not_approved'
  | 'hidden'
  | 'deleted'
  | 'ownership_unconfirmed'
  | 'people_unknown'
  | 'caption_missing'
  | 'caption_not_approved'
  | 'alt_missing'
  | 'alt_not_approved';

/** Lists every reason an item cannot publish. Empty array means it can publish. */
export function publishBlockers(item: GalleryItem): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (item.deleted) blockers.push('deleted');
  if (item.reviewStatus !== 'approved') blockers.push('not_approved');
  if (!item.visible) blockers.push('hidden');
  if (!item.ownershipConfirmed) blockers.push('ownership_unconfirmed');
  if (item.peopleStatus === 'unknown') blockers.push('people_unknown');
  for (const locale of ['en', 'es'] as const) {
    if (item.caption[locale].trim() === '') blockers.push('caption_missing');
    else if (!item.captionApproved[locale]) blockers.push('caption_not_approved');
    if (item.alt[locale].trim() === '') blockers.push('alt_missing');
    else if (!item.altApproved[locale]) blockers.push('alt_not_approved');
  }
  return [...new Set(blockers)];
}

export function canPublish(item: GalleryItem): boolean {
  return publishBlockers(item).length === 0;
}

export type PairProblem =
  | 'same_item'
  | 'wrong_kind'
  | 'already_paired'
  | 'different_project'
  | 'different_service'
  | 'missing_project_or_service';

/** Checks whether two items can form a Before/After pair. */
export function validatePair(
  before: GalleryItem,
  after: GalleryItem,
  existingPairs: GalleryPair[],
): PairProblem[] {
  const problems: PairProblem[] = [];
  if (before.id === after.id) problems.push('same_item');
  if (before.kind !== 'before' || after.kind !== 'after') problems.push('wrong_kind');
  const paired = existingPairs.some(
    (p) => [p.beforeId, p.afterId].some((id) => id === before.id || id === after.id),
  );
  if (paired) problems.push('already_paired');
  if (before.projectId === null || before.serviceId === null || after.projectId === null || after.serviceId === null) {
    problems.push('missing_project_or_service');
  } else {
    if (before.projectId !== after.projectId) problems.push('different_project');
    if (before.serviceId !== after.serviceId) problems.push('different_service');
  }
  return problems;
}

export type PublishUnit =
  | { type: 'pair'; pairId: string; before: GalleryItem; after: GalleryItem; sortOrder: number }
  | { type: 'single'; item: GalleryItem; sortOrder: number };

/**
 * Builds the publish plan. Rules:
 * - A pair publishes only if BOTH photos can publish. Otherwise the pair is hidden as a whole.
 * - A broken pair's remaining photo is NOT shown automatically.
 * - Unpaired items publish as singles if they can publish.
 * - Units are ordered by sortOrder.
 */
export function buildPublishPlan(items: GalleryItem[], pairs: GalleryPair[]): PublishUnit[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pairedIds = new Set<string>();
  const units: PublishUnit[] = [];

  for (const pair of pairs) {
    pairedIds.add(pair.beforeId);
    pairedIds.add(pair.afterId);
    const before = byId.get(pair.beforeId);
    const after = byId.get(pair.afterId);
    if (!before || !after) continue;
    if (canPublish(before) && canPublish(after)) {
      units.push({
        type: 'pair',
        pairId: pair.id,
        before,
        after,
        sortOrder: Math.min(before.sortOrder, after.sortOrder),
      });
    }
  }

  for (const item of items) {
    if (pairedIds.has(item.id)) continue;
    if (canPublish(item)) units.push({ type: 'single', item, sortOrder: item.sortOrder });
  }

  return units.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Moves one unit up or down within an ordered list of IDs. Pure; returns a new array. */
export function moveId(orderedIds: string[], id: string, delta: -1 | 1): string[] {
  const from = orderedIds.indexOf(id);
  if (from === -1) return orderedIds;
  const to = Math.min(orderedIds.length - 1, Math.max(0, from + delta));
  if (to === from) return orderedIds;
  const next = [...orderedIds];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Converts an ordered ID list into sortOrder values 1..n. */
export function sortOrdersFrom(orderedIds: string[]): Record<string, number> {
  return Object.fromEntries(orderedIds.map((id, index) => [id, index + 1]));
}
