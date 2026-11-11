import { z } from 'zod';

/** Canonical service IDs (English slugs). Routes use localized slugs; IDs do not change. */
export const SERVICE_IDS = [
  'standard-cleaning',
  'deep-cleaning',
  'move-in-cleaning',
  'move-out-cleaning',
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

/*
 * Form answers are PROPOSED options for the owner to confirm (S7, S8).
 * They are not business facts and are not published until approved.
 */
export const HOME_TYPES = ['house', 'apartment', 'townhouse', 'other'] as const;
export const BEDROOM_OPTIONS = ['1', '2', '3', '4', '5-plus'] as const;
export const BATHROOM_OPTIONS = ['1', '2', '3', '4-plus'] as const;
export const FREQUENCIES = ['one-time', 'weekly', 'biweekly', 'monthly'] as const;

const phoneDigits = (value: string): number => value.replace(/\D/g, '').length;

export const estimateRequestSchema = z
  .object({
    locale: z.enum(['en', 'es']),
    services: z.array(z.enum(SERVICE_IDS)).min(1).max(4),
    homeType: z.enum(HOME_TYPES),
    bedrooms: z.enum(BEDROOM_OPTIONS),
    bathrooms: z.enum(BATHROOM_OPTIONS),
    frequency: z.enum(FREQUENCIES).nullable(),
    moveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    name: z.string().trim().min(1).max(80),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => v === '' || (phoneDigits(v) >= 10 && phoneDigits(v) <= 15), 'phone')
      .transform((v) => (v === '' ? null : v)),
    email: z
      .string()
      .trim()
      .max(120)
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'email')
      .transform((v) => (v === '' ? null : v)),
    zip: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{5}$/.test(v), 'zip')
      .transform((v) => (v === '' ? null : v)),
    notes: z.string().trim().max(500).transform((v) => (v === '' ? null : v)),
    consent: z.literal(true),
    /** Honeypot. Must stay empty. Humans never fill it. */
    website: z.string().max(0).optional().default(''),
    idempotencyKey: z.string().min(16).max(64),
  })
  .superRefine((data, ctx) => {
    if (data.phone === null && data.email === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'contact_required' });
    }
    // Conditional question: a recurring frequency is required for Standard Cleaning.
    if (data.services.includes('standard-cleaning') && data.frequency === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['frequency'], message: 'frequency_required' });
    }
    // Move date is only asked for move services; if sent for other services it is ignored.
    if (data.moveDate !== null && !data.services.some((s) => s === 'move-in-cleaning' || s === 'move-out-cleaning')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['moveDate'], message: 'move_date_not_applicable' });
    }
  });

export type EstimateRequest = z.infer<typeof estimateRequestSchema>;
