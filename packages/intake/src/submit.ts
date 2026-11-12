import { estimateRequestSchema, type EstimateRequest } from './schema.js';

/**
 * Durable store for estimate requests. A save that throws means the request
 * was NOT stored, and the customer must be told so. Never report success without a
 * confirmed save.
 */
export interface RequestStore {
  findByIdempotencyKey(key: string): Promise<StoredRequest | null>;
  save(record: StoredRequest): Promise<void>;
}

export interface StoredRequest {
  reference: string;
  createdAt: string;
  idempotencyKey: string;
  request: Omit<EstimateRequest, 'website'>;
  status: 'new';
}

export type SubmitResult =
  | { status: 'received'; reference: string }
  | { status: 'invalid'; issues: { field: string; code: string }[] }
  | { status: 'unavailable' };

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Reference such as BFG-7K2M9Q. Random, not derived from the customer's data. */
export function createReference(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += CROCKFORD[Math.floor(random() * CROCKFORD.length)];
  }
  return `BFG-${out}`;
}

/**
 * Validates and stores an estimate request. Returns 'received' only after the store
 * confirms the save. Repeated submissions with the same idempotency key return the
 * original reference and create no duplicate.
 */
export async function submitEstimateRequest(
  raw: unknown,
  deps: { store: RequestStore; now?: () => Date; random?: () => number },
): Promise<SubmitResult> {
  // Honeypot first: a filled hidden field gets a generic answer that names no field.
  if (raw && typeof raw === 'object' && String((raw as { website?: unknown }).website ?? '') !== '') {
    return { status: 'invalid', issues: [{ field: 'form', code: 'invalid' }] };
  }
  const parsed = estimateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        code: issue.message,
      })),
    };
  }

  const data = parsed.data;
  // Honeypot filled: treat as invalid without saying why.
  if (data.website !== '') {
    return { status: 'invalid', issues: [{ field: 'form', code: 'invalid' }] };
  }

  try {
    const existing = await deps.store.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return { status: 'received', reference: existing.reference };

    const { website: _honeypot, ...request } = data;
    void _honeypot;
    const record: StoredRequest = {
      reference: createReference(deps.random),
      createdAt: (deps.now ? deps.now() : new Date()).toISOString(),
      idempotencyKey: data.idempotencyKey,
      request,
      status: 'new',
    };
    await deps.store.save(record);
    return { status: 'received', reference: record.reference };
  } catch {
    // Storage failed. The request is not stored, so the customer is told so.
    return { status: 'unavailable' };
  }
}

/** In-memory store for tests and local development only. Not durable. */
export class MemoryRequestStore implements RequestStore {
  private readonly rows = new Map<string, StoredRequest>();

  async findByIdempotencyKey(key: string): Promise<StoredRequest | null> {
    return this.rows.get(key) ?? null;
  }

  async save(record: StoredRequest): Promise<void> {
    this.rows.set(record.idempotencyKey, record);
  }

  get size(): number {
    return this.rows.size;
  }
}
