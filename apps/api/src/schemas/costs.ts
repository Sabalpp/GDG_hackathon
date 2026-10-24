import { z } from 'zod';

export const modificationTypes = ['move-furniture', 'resize-demo-door', 'move-demo-partition'] as const;
const money = z.number().finite().nonnegative().max(1_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'USD amounts must have at most two decimal places');
const text = z.string().trim().min(1).max(4000);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const range = { lowUsd: money, highUsd: money };
const ordered = (value: { lowUsd: number; highUsd: number }) => value.lowUsd <= value.highUsd;
export const costCatalogItemSchema = z.strictObject({
  type: z.enum(modificationTypes), title: text, ...range, basis: text,
  requiresProfessionalReview: z.boolean(), status: z.literal('illustrative').default('illustrative'),
}).refine(ordered, 'Cost range must be ordered');
export const costCatalogSchema = z.strictObject({
  updatedAt: z.iso.date(), currency: z.literal('USD'), status: z.literal('illustrative'),
  limitations: z.array(text).min(1).max(100), items: z.array(costCatalogItemSchema).length(3),
}).refine(({ items }) => new Set(items.map((item) => item.type)).size === modificationTypes.length, 'Catalog must contain each supported type exactly once');
export const catalogResponseSchema = z.strictObject({
  items: costCatalogSchema.shape.items, updatedAt: costCatalogSchema.shape.updatedAt,
  limitations: costCatalogSchema.shape.limitations,
});

// Unknown future types are valid work, but cannot receive a fabricated price.
// This is a costing boundary, not permission to execute a modification.
export const costModificationSchema = z.strictObject({
  id, type: z.string().trim().min(1).max(128), targetElementId: id,
  params: z.record(z.string().max(128), z.union([z.string().max(4000), z.number().finite()])),
  requiresProfessionalReview: z.boolean(),
});
export const costModificationsSchema = z.array(costModificationSchema).max(1000)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Modification IDs must be unique');
export const costLineSchema = z.strictObject({
  modificationId: id, title: text, ...range, basis: text, status: z.literal('illustrative'),
}).refine(ordered, 'Cost range must be ordered');
const totalSchema = z.strictObject({ ...range, status: z.literal('illustrative') }).refine(ordered);
export const costEstimateSchema = z.strictObject({
  status: z.literal('illustrative'), currency: z.literal('USD'), catalogUpdatedAt: z.iso.date(),
  costs: z.array(costLineSchema).max(1000), knownSubtotal: totalSchema,
  total: totalSchema.nullable(), complete: z.boolean(),
  professionalEstimates: z.array(z.strictObject({ modificationId: id, reason: text })).max(1000),
  unpricedWork: z.array(z.strictObject({ modificationId: id, type: text, requiresProfessionalEstimate: z.literal(true) })).max(1000),
  limitations: z.array(text).min(1).max(100),
}).refine((value) => value.complete === (value.unpricedWork.length === 0) && value.complete === (value.total !== null), 'Incomplete estimates cannot have a total');
export type CostCatalog = z.infer<typeof costCatalogSchema>;
export type CostEstimate = z.infer<typeof costEstimateSchema>;
