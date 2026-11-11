import { describe, expect, it } from 'vitest';
import {
  buildPublishPlan,
  canPublish,
  moveId,
  publishBlockers,
  sortOrdersFrom,
  validatePair,
  type GalleryItem,
} from '../src/index.js';

const make = (over: Partial<GalleryItem> & { id: string }): GalleryItem => ({
  projectId: 'proj-1',
  serviceId: 'standard-cleaning',
  kind: 'before',
  reviewStatus: 'approved',
  ownershipConfirmed: true,
  peopleStatus: 'none_visible',
  caption: { en: 'Caption', es: 'Leyenda' },
  captionApproved: { en: true, es: true },
  alt: { en: 'Alt', es: 'Alt ES' },
  altApproved: { en: true, es: true },
  visible: true,
  deleted: false,
  sortOrder: 1,
  ...over,
});

describe('publish rules', () => {
  it('publishes an approved, visible, owned, fully captioned photo', () => {
    expect(canPublish(make({ id: 'a' }))).toBe(true);
  });

  it('blocks a photo that is not approved', () => {
    expect(publishBlockers(make({ id: 'a', reviewStatus: 'pending' }))).toContain('not_approved');
  });

  it('blocks a photo whose ownership is not confirmed', () => {
    expect(publishBlockers(make({ id: 'a', ownershipConfirmed: false }))).toContain('ownership_unconfirmed');
  });

  it('blocks identifiable people until permission is recorded', () => {
    expect(publishBlockers(make({ id: 'a', peopleStatus: 'unknown' }))).toContain('people_unknown');
    expect(canPublish(make({ id: 'a', peopleStatus: 'permission_on_file' }))).toBe(true);
  });

  it('requires both caption and alt text, approved in each language', () => {
    const blockers = publishBlockers(make({ id: 'a', caption: { en: 'x', es: '' }, captionApproved: { en: true, es: false } }));
    expect(blockers).toContain('caption_missing');
    expect(publishBlockers(make({ id: 'a', alt: { en: 'x', es: 'y' }, altApproved: { en: true, es: false } }))).toContain('alt_not_approved');
  });

  it('never publishes deleted or hidden photos', () => {
    expect(publishBlockers(make({ id: 'a', deleted: true }))).toContain('deleted');
    expect(publishBlockers(make({ id: 'a', visible: false }))).toContain('hidden');
  });
});

describe('Before/After pairing', () => {
  const before = make({ id: 'b', kind: 'before' });
  const after = make({ id: 'a', kind: 'after' });

  it('accepts a before and after photo in the same project and service', () => {
    expect(validatePair(before, after, [])).toEqual([]);
  });

  it('rejects wrong kinds, mismatched project or service, and items already paired', () => {
    expect(validatePair(after, before, [])).toContain('wrong_kind');
    expect(validatePair(before, make({ id: 'x', kind: 'after', projectId: 'other' }), [])).toContain('different_project');
    expect(validatePair(before, make({ id: 'x', kind: 'after', serviceId: 'deep-cleaning' }), [])).toContain('different_service');
    expect(validatePair(before, after, [{ id: 'p0', beforeId: 'b', afterId: 'zz' }])).toContain('already_paired');
    expect(validatePair(before, make({ id: 'x', kind: 'after', projectId: null }), [])).toContain('missing_project_or_service');
  });

  it('publishes a pair as one unit only when both photos publish', () => {
    const plan = buildPublishPlan([before, after], [{ id: 'p1', beforeId: 'b', afterId: 'a' }]);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.type).toBe('pair');
  });

  it('hides the whole pair and does not show the remaining photo if one photo is blocked', () => {
    const blocked = make({ id: 'a', kind: 'after', visible: false });
    const plan = buildPublishPlan([before, blocked], [{ id: 'p1', beforeId: 'b', afterId: 'a' }]);
    expect(plan).toHaveLength(0);
  });
});

describe('ordering and unlimited count', () => {
  it('publishes any number of photos, in sort order, pairs included', () => {
    const items = Array.from({ length: 250 }, (_, i) => make({ id: `r${i}`, kind: 'regular', sortOrder: 250 - i }));
    const plan = buildPublishPlan(items, []);
    expect(plan).toHaveLength(250);
    expect(plan[0]?.type === 'single' && plan[0].item.id).toBe('r249');
  });

  it('moves an item up or down and clamps at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('turns an ordered list into 1..n sort orders', () => {
    expect(sortOrdersFrom(['x', 'y'])).toEqual({ x: 1, y: 2 });
  });
});
