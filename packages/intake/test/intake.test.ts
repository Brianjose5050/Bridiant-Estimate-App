import { describe, expect, it } from 'vitest';
import { estimateRequestSchema, submitEstimateRequest, createReference, MemoryRequestStore, type RequestStore, type StoredRequest } from '../src/index.js';

const valid = (over: Record<string, unknown> = {}) => ({
  locale: 'en',
  services: ['standard-cleaning'],
  homeType: 'house',
  bedrooms: '3',
  bathrooms: '2',
  frequency: 'monthly',
  moveDate: null,
  name: 'Test Customer',
  phone: '555-010-1234',
  email: '',
  zip: '',
  notes: '',
  consent: true,
  website: '',
  idempotencyKey: 'key-0000000000000001',
  ...over,
});

describe('estimate request validation (short residential form)', () => {
  it('accepts a complete Standard Cleaning request', () => {
    expect(estimateRequestSchema.safeParse(valid()).success).toBe(true);
  });

  it('requires a phone or an email', () => {
    const result = estimateRequestSchema.safeParse(valid({ phone: '', email: '' }));
    expect(result.success).toBe(false);
  });

  it('requires a frequency for Standard Cleaning (conditional question)', () => {
    const result = estimateRequestSchema.safeParse(valid({ frequency: null }));
    expect(result.success).toBe(false);
    const oneTime = estimateRequestSchema.safeParse(valid({ services: ['deep-cleaning'], frequency: null }));
    expect(oneTime.success).toBe(true);
  });

  it('asks for a move date only for move services', () => {
    expect(estimateRequestSchema.safeParse(valid({ moveDate: '2026-05-01' })).success).toBe(false);
    expect(estimateRequestSchema.safeParse(valid({ services: ['move-in-cleaning'], frequency: null, moveDate: '2026-05-01' })).success).toBe(true);
  });

  it('requires consent and rejects unknown services', () => {
    expect(estimateRequestSchema.safeParse(valid({ consent: false })).success).toBe(false);
    expect(estimateRequestSchema.safeParse(valid({ services: ['office-cleaning'] })).success).toBe(false);
  });

  it('rejects a filled honeypot field', () => {
    expect(estimateRequestSchema.safeParse(valid({ website: 'spam' })).success).toBe(false);
  });
});

describe('submission: success only after a confirmed save', () => {
  it('returns a reference after the store saves', async () => {
    const store = new MemoryRequestStore();
    const result = await submitEstimateRequest(valid(), { store });
    expect(result.status).toBe('received');
    if (result.status === 'received') expect(result.reference).toMatch(/^BFG-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(store.size).toBe(1);
  });

  it('returns the same reference for a repeated submission (no duplicates)', async () => {
    const store = new MemoryRequestStore();
    const first = await submitEstimateRequest(valid(), { store });
    const second = await submitEstimateRequest(valid(), { store });
    expect(second).toEqual(first);
    expect(store.size).toBe(1);
  });

  it('reports unavailable, never received, when the store fails', async () => {
    const failing: RequestStore = {
      findByIdempotencyKey: async () => null,
      save: async () => {
        throw new Error('database paused');
      },
    };
    const result = await submitEstimateRequest(valid(), { store: failing });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('returns invalid with field codes and stores nothing', async () => {
    const store = new MemoryRequestStore();
    const result = await submitEstimateRequest(valid({ name: '' }), { store });
    expect(result.status).toBe('invalid');
    expect(store.size).toBe(0);
  });

  it('stores no honeypot field and no raw contact data beyond the request', async () => {
    const store = new MemoryRequestStore();
    let saved: StoredRequest | null = null;
    const spy: RequestStore = {
      findByIdempotencyKey: (k) => store.findByIdempotencyKey(k),
      save: async (record) => {
        saved = record;
        await store.save(record);
      },
    };
    await submitEstimateRequest(valid(), { store: spy });
    expect(saved).not.toBeNull();
    expect(JSON.stringify(saved)).not.toContain('"website"');
  });
});

describe('reference generation', () => {
  it('produces a six-character reference from the given random source', () => {
    expect(createReference(() => 0)).toBe('BFG-000000');
    expect(createReference(() => 0.999999)).toMatch(/^BFG-Z{6}$/);
  });
});
